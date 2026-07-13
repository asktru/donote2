import { computed, ref } from 'vue';

import { todayDailyKey } from '@/core/dates';
import { appendLine, appendUnderAudioMemo } from '@/core/memoNote';
import { apiUpload } from '@/lib/api';
import { donoteDesktop } from '@/lib/desktop';
import type { MemoRecord, WorkspaceDb } from '@/stores/db';
import { openWorkspaceDb } from '@/stores/db';
import {
    createNote,
    getNote,
    openCalendarNote,
    updateNoteContent,
    workspaceConfig,
} from '@/stores/workspace';

/**
 * Voice memos: recorded (mic + system audio in the desktop shell), queued
 * in IndexedDB so offline recordings survive reloads, then uploaded for
 * transcription and appended to the daily note of the recording day.
 *
 * Long recordings (meetings can run hours) rotate the recorder every
 * SEGMENT_MS: each segment is persisted immediately — a crash loses at
 * most the current segment — and uploads independently under provider
 * size limits. The group's transcripts are stitched in part order into
 * a single bullet once every part is transcribed.
 */

/** Upper time bound on a segment — mostly a fallback for near-silent audio;
 *  the byte budget below rotates first for normal speech. */
const SEGMENT_MS = 10 * 60 * 1000;
/**
 * Rotate a segment once it reaches this many bytes so every upload stays
 * well under a conservative web-server body limit (nginx defaults to 1 MB).
 * This keeps recordings uploadable without raising server upload limits.
 */
const MAX_SEGMENT_BYTES = 800 * 1024;
/** Voice-optimized bitrate: ~800 KB ≈ 3.4 minutes of speech per segment. */
const AUDIO_BITS_PER_SECOND = 32000;
/** Recordings at least this long prompt for a transcript destination. */
const LONG_RECORDING_SEC = 10 * 60;

interface ActiveRecording {
    recorder: MediaRecorder;
    chunks: Blob[];
    /** Bytes captured in the current segment; drives size-based rotation. */
    bytes: number;
    /** The mixed stream the recorder consumes; reused across segments. */
    stream: MediaStream;
    streams: MediaStream[];
    audioContext: AudioContext | null;
    groupId: string;
    part: number;
    segmentStartedAt: number;
    segmentTimer: ReturnType<typeof setTimeout> | null;
    dateKey: string;
    startedAt: number;
    /** True when system audio is mixed in alongside the microphone. */
    systemAudio: boolean;
}

let active: ActiveRecording | null = null;
/** Guards against re-entrant rotation (size trigger racing the time timer). */
let rotating = false;
let db: WorkspaceDb | null = null;
let uploaderTimer: ReturnType<typeof setInterval> | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let booted = false;
const uploadsInFlight = new Set<string>();

export const isRecording = ref(false);
export const recordingSeconds = ref(0);
export const recordingHasSystemAudio = ref(false);
export const memoQueue = ref<MemoRecord[]>([]);
/**
 * Set after stopping a long (multi-segment) recording: the UI asks where
 * the transcript should go. Finalization holds until the user answers or
 * the app reloads (then the daily-note default applies).
 */
export const pendingDestination = ref<{
    groupId: string;
    durationSec: number;
} | null>(null);
const heldGroups = new Set<string>();

export interface MemoGroup {
    groupId: string;
    createdAt: string;
    durationSec: number;
    partsDone: number;
    partsKnown: number;
    finished: boolean;
    status: 'pending' | 'uploading' | 'failed';
    error: string | null;
}

/** One sidebar row per recording, however many parts it has. */
export const memoGroups = computed<MemoGroup[]>(() => {
    const groups = new Map<string, MemoRecord[]>();

    for (const memo of memoQueue.value) {
        const list = groups.get(memo.groupId) ?? [];
        list.push(memo);
        groups.set(memo.groupId, list);
    }

    return [...groups.values()].map((parts) => {
        const sorted = [...parts].sort((a, b) => a.part - b.part);
        const failed = sorted.find((memo) => memo.status === 'failed');

        return {
            groupId: sorted[0].groupId,
            createdAt: sorted[0].createdAt,
            durationSec: sorted.reduce((sum, m) => sum + m.durationSec, 0),
            partsDone: sorted.filter((memo) => memo.status === 'done').length,
            partsKnown: sorted[0].partsTotal ?? sorted.length,
            finished: sorted[0].partsTotal !== null,
            status: sorted.some((memo) => memo.status === 'uploading')
                ? 'uploading'
                : failed
                  ? 'failed'
                  : 'pending',
            error: failed?.error ?? null,
        };
    });
});

export const activeMemoCount = computed(
    () => memoGroups.value.length + (isRecording.value ? 1 : 0),
);

function workspaceDb(): WorkspaceDb | null {
    if (db === null) {
        const config = workspaceConfig();

        if (config) {
            db = openWorkspaceDb(config.teamSlug, config.userId);
        }
    }

    return db;
}

async function refreshQueue(): Promise<void> {
    const database = workspaceDb();

    if (database) {
        memoQueue.value = await database.memos.orderBy('createdAt').toArray();
    }
}

/** Mic always; in the desktop shell we also mix in system audio so calls
 *  (Meet, Preply, …) capture every participant, not just the mic. */
async function captureStreams(): Promise<{
    stream: MediaStream;
    streams: MediaStream[];
    audioContext: AudioContext | null;
    systemAudio: boolean;
}> {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });

    if (donoteDesktop === null) {
        return {
            stream: mic,
            streams: [mic],
            audioContext: null,
            systemAudio: false,
        };
    }

    try {
        const display = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
        });

        // Only the loopback audio is wanted; drop the screen video track.
        display.getVideoTracks().forEach((track) => track.stop());

        if (display.getAudioTracks().length === 0) {
            return {
                stream: mic,
                streams: [mic],
                audioContext: null,
                systemAudio: false,
            };
        }

        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        audioContext.createMediaStreamSource(mic).connect(destination);
        audioContext.createMediaStreamSource(display).connect(destination);

        return {
            stream: destination.stream,
            streams: [mic, display],
            audioContext,
            systemAudio: true,
        };
    } catch {
        // Screen-recording permission refused or unavailable — mic only.
        return {
            stream: mic,
            streams: [mic],
            audioContext: null,
            systemAudio: false,
        };
    }
}

/** Chromium records webm/opus; iOS WebKit only does mp4 (AAC). */
function recordingMimeType(): string | undefined {
    for (const candidate of [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
    ]) {
        if (MediaRecorder.isTypeSupported(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

function containerOf(mimeType: string): { mime: string; extension: string } {
    return mimeType.startsWith('audio/mp4')
        ? { mime: 'audio/mp4', extension: 'm4a' }
        : { mime: 'audio/webm', extension: 'webm' };
}

function makeRecorder(stream: MediaStream): MediaRecorder {
    return new MediaRecorder(stream, {
        mimeType: recordingMimeType(),
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
}

function attachRecorder(current: ActiveRecording): void {
    current.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            current.chunks.push(event.data);
            current.bytes += event.data.size;

            // Close the segment as soon as it's big enough to keep every
            // upload under the server's body limit.
            if (current.bytes >= MAX_SEGMENT_BYTES && !rotating) {
                void rotateSegment();
            }
        }
    };

    current.recorder.start(5000);
}

/** Stop the current recorder and return the segment's blob. */
function collectSegment(current: ActiveRecording): Promise<Blob> {
    const { mime } = containerOf(current.recorder.mimeType || 'audio/webm');

    return new Promise((resolve) => {
        current.recorder.onstop = () => {
            resolve(new Blob(current.chunks, { type: mime }));
        };

        current.recorder.stop();
    });
}

async function persistPart(
    current: ActiveRecording,
    blob: Blob,
): Promise<void> {
    const database = workspaceDb();

    if (!database) {
        return;
    }

    await database.memos.put({
        id: crypto.randomUUID(),
        groupId: current.groupId,
        part: current.part,
        partsTotal: null,
        dateKey: current.dateKey,
        blob,
        mimeType: blob.type || 'audio/webm',
        durationSec: Math.round((Date.now() - current.segmentStartedAt) / 1000),
        status: 'pending',
        transcript: null,
        error: null,
        attempts: 0,
        createdAt: new Date(current.segmentStartedAt).toISOString(),
    });

    await refreshQueue();
}

/** Close the current segment and keep recording into the next one. */
async function rotateSegment(): Promise<void> {
    const current = active;

    if (current === null || rotating) {
        return;
    }

    rotating = true;

    // Clear the time-based timer: a byte-triggered rotation may have arrived
    // first, and we don't want its old timer firing a second rotation.
    if (current.segmentTimer !== null) {
        clearTimeout(current.segmentTimer);
        current.segmentTimer = null;
    }

    try {
        const blob = await collectSegment(current);
        await persistPart(current, blob);

        current.part += 1;
        current.chunks = [];
        current.bytes = 0;
        current.segmentStartedAt = Date.now();
        current.recorder = makeRecorder(current.stream);
        attachRecorder(current);
        current.segmentTimer = setTimeout(() => void rotateSegment(), SEGMENT_MS);
    } finally {
        rotating = false;
    }

    void processQueue();
}

export async function startRecording(): Promise<void> {
    if (active !== null) {
        return;
    }

    const capture = await captureStreams();

    active = {
        recorder: makeRecorder(capture.stream),
        chunks: [],
        bytes: 0,
        stream: capture.stream,
        streams: capture.streams,
        audioContext: capture.audioContext,
        groupId: crypto.randomUUID(),
        part: 0,
        segmentStartedAt: Date.now(),
        segmentTimer: null,
        dateKey: todayDailyKey(),
        startedAt: Date.now(),
        systemAudio: capture.systemAudio,
    };

    attachRecorder(active);
    active.segmentTimer = setTimeout(() => void rotateSegment(), SEGMENT_MS);

    isRecording.value = true;
    recordingHasSystemAudio.value = capture.systemAudio;
    recordingSeconds.value = 0;
    elapsedTimer = setInterval(() => {
        recordingSeconds.value += 1;
    }, 1000);
}

function teardownRecording(): ActiveRecording | null {
    const current = active;
    active = null;
    isRecording.value = false;
    recordingHasSystemAudio.value = false;

    if (elapsedTimer !== null) {
        clearInterval(elapsedTimer);
        elapsedTimer = null;
    }

    if (current) {
        if (current.segmentTimer !== null) {
            clearTimeout(current.segmentTimer);
        }

        current.streams.forEach((stream) =>
            stream.getTracks().forEach((track) => track.stop()),
        );
        void current.audioContext?.close();
    }

    return current;
}

/** Stop, persist the final part, and queue the group for transcription. */
export async function stopRecording(): Promise<void> {
    const current = active;

    if (current === null) {
        return;
    }

    if (current.segmentTimer !== null) {
        clearTimeout(current.segmentTimer);
        current.segmentTimer = null;
    }

    const blob = await collectSegment(current);
    await persistPart(current, blob);
    teardownRecording();

    const database = workspaceDb();

    if (database) {
        // Recording is complete — stamp the part count on every part so
        // the group can finalize once all transcripts are in.
        const parts = await database.memos
            .where('groupId')
            .equals(current.groupId)
            .toArray();

        for (const part of parts) {
            await database.memos.update(part.id, {
                partsTotal: current.part + 1,
            });
        }

        await refreshQueue();
    }

    const durationSec = Math.round((Date.now() - current.startedAt) / 1000);

    if (durationSec >= LONG_RECORDING_SEC) {
        // Long recording — let the user pick where the transcript goes.
        // Gated on real duration, not part count: segments now rotate by
        // size, so a short memo can span several parts.
        heldGroups.add(current.groupId);
        pendingDestination.value = {
            groupId: current.groupId,
            durationSec,
        };
    }

    void processQueue();
}

/** Resolve the destination question for a long recording. */
export async function chooseDestination(
    groupId: string,
    destination: 'daily' | 'note',
): Promise<void> {
    pendingDestination.value = null;
    heldGroups.delete(groupId);

    const database = workspaceDb();

    if (database) {
        const parts = await database.memos
            .where('groupId')
            .equals(groupId)
            .toArray();

        for (const part of parts) {
            await database.memos.update(part.id, { destination });
        }
    }

    await finalizeGroup(groupId);
}

/** Keyboard-friendly start/stop switch. */
export async function toggleRecording(): Promise<void> {
    if (isRecording.value) {
        await stopRecording();
    } else {
        await startRecording();
    }
}

/** Discard the in-progress recording, including already-saved parts. */
export async function discardRecording(): Promise<void> {
    const current = active;

    if (current) {
        current.recorder.onstop = null;
        current.recorder.stop();
    }

    teardownRecording();

    const database = workspaceDb();

    if (current && database) {
        await database.memos.where('groupId').equals(current.groupId).delete();
        await refreshQueue();
    }
}

/** Remove a queued recording (stuck upload, unwanted memo). */
export async function cancelMemoGroup(groupId: string): Promise<void> {
    const database = workspaceDb();

    if (database) {
        await database.memos.where('groupId').equals(groupId).delete();
        await refreshQueue();
    }
}

async function appendTranscript(
    firstPart: MemoRecord,
    text: string,
): Promise<void> {
    const note = await openCalendarNote('daily', firstPart.dateKey);
    const current = getNote(note.id) ?? note;
    const time = new Date(firstPart.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });

    await updateNoteContent(
        note.id,
        appendUnderAudioMemo(current.content, `${time} — ${text}`),
    );
}

/** Append a wiki link for a freshly created note to today's daily note. */
export async function appendLinkToTodayNote(title: string): Promise<void> {
    const note = await openCalendarNote('daily', todayDailyKey());
    const current = getNote(note.id) ?? note;

    await updateNoteContent(
        note.id,
        appendLine(current.content, `- [[${title}]]`),
    );
}

/** When every part is transcribed, stitch them in order and file once. */
async function finalizeGroup(groupId: string): Promise<void> {
    const database = workspaceDb();

    if (!database || heldGroups.has(groupId)) {
        return;
    }

    const parts = await database.memos
        .where('groupId')
        .equals(groupId)
        .toArray();

    if (
        parts.length === 0 ||
        parts[0].partsTotal === null ||
        parts.length < parts[0].partsTotal ||
        parts.some((part) => part.status !== 'done')
    ) {
        return;
    }

    const ordered = [...parts].sort((a, b) => a.part - b.part);
    const text = ordered
        .map((part) => part.transcript ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

    const first = ordered[0];

    if (first.destination === 'note') {
        const time = new Date(first.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });
        const title = `Audio memo ${first.dateKey} ${time}`;
        const paragraphs = ordered
            .map((part) => part.transcript?.trim() ?? '')
            .filter((paragraph) => paragraph !== '')
            .join('\n\n');

        await createNote({
            title,
            content: paragraphs === '' ? '(empty transcription)' : paragraphs,
        });
        await appendTranscript(first, `[[${title}]]`);
    } else {
        await appendTranscript(
            first,
            text === '' ? '(empty transcription)' : text,
        );
    }

    await database.memos.where('groupId').equals(groupId).delete();
    await refreshQueue();
}

async function uploadMemo(memo: MemoRecord): Promise<void> {
    const config = workspaceConfig();
    const database = workspaceDb();

    if (!config || !database) {
        return;
    }

    uploadsInFlight.add(memo.id);
    await database.memos.update(memo.id, { status: 'uploading', error: null });
    await refreshQueue();

    try {
        const form = new FormData();
        form.append(
            'audio',
            new File(
                [memo.blob],
                `memo-${memo.id}.${containerOf(memo.mimeType).extension}`,
                { type: memo.mimeType },
            ),
        );

        const { text } = await apiUpload<{ text: string }>(
            `/api/${config.teamSlug}/memos/transcriptions`,
            form,
        );

        await database.memos.update(memo.id, {
            status: 'done',
            transcript: text,
        });
        await finalizeGroup(memo.groupId);
    } catch (error) {
        await database.memos.update(memo.id, {
            status: 'failed',
            error: error instanceof Error ? error.message : 'upload failed',
            attempts: memo.attempts + 1,
        });
    } finally {
        uploadsInFlight.delete(memo.id);
        await refreshQueue();
    }
}

/** Try every queued part; called on start, on reconnect, and periodically. */
export async function processQueue(): Promise<void> {
    if (!navigator.onLine) {
        return;
    }

    const database = workspaceDb();

    if (!database) {
        return;
    }

    const queued = await database.memos.orderBy('createdAt').toArray();

    for (const memo of queued) {
        if (memo.status !== 'done' && !uploadsInFlight.has(memo.id)) {
            await uploadMemo(memo);
        } else if (memo.status === 'done') {
            // A group can be left un-finalized if the app closed between
            // the last part's upload and the note append.
            await finalizeGroup(memo.groupId);
        }
    }
}

/**
 * A reload/quit mid-recording leaves parts with partsTotal null; nothing
 * is recording now, so close those groups at whatever was captured.
 */
async function adoptOrphanedGroups(): Promise<void> {
    const database = workspaceDb();

    if (!database) {
        return;
    }

    const all = await database.memos.toArray();
    const openGroups = new Map<string, number>();

    for (const memo of all) {
        if (memo.partsTotal === null) {
            openGroups.set(
                memo.groupId,
                Math.max(openGroups.get(memo.groupId) ?? 0, memo.part + 1),
            );
        }
    }

    for (const [groupId, total] of openGroups) {
        const parts = await database.memos
            .where('groupId')
            .equals(groupId)
            .toArray();

        for (const part of parts) {
            await database.memos.update(part.id, { partsTotal: total });
        }
    }
}

/**
 * A real page unload (reload / quit) should stop and persist an active
 * recording so captured audio isn't lost. An in-app navigation must NOT:
 * the recorder lives at module scope and keeps running across Inertia page
 * visits, which is what makes recording persistent everywhere in the app.
 */
function handlePageHide(): void {
    if (active !== null) {
        active.recorder.onstop = null;
        active.recorder.stop();
        teardownRecording();
    }
}

/**
 * Boot the memo engine once per session: recover orphaned groups, resume
 * uploads, and keep the recorder alive across page navigations. Safe to call
 * from every page's onMounted — subsequent calls are no-ops.
 */
export function startMemoUploader(): void {
    if (booted) {
        return;
    }

    booted = true;

    void adoptOrphanedGroups().then(refreshQueue).then(processQueue);

    window.addEventListener('online', () => void processQueue());
    window.addEventListener('pagehide', handlePageHide);

    if (uploaderTimer === null) {
        uploaderTimer = setInterval(() => void processQueue(), 30000);
    }
}
