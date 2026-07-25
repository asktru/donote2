import { computed, ref } from 'vue';

import { dateKeyFor, todayDailyKey } from '@/core/dates';
import { appendLine, appendUnderHeading, safeDailyKey } from '@/core/memoNote';
import { apiUpload } from '@/lib/api';
import { donoteDesktop } from '@/lib/desktop';
import { nativeRecorder, readSegmentBlob } from '@/lib/nativeRecorder';
import type {
    NativeSegmentEvent,
    NativeStoppedEvent,
} from '@/lib/nativeRecorder';
import type { MemoRecord, WorkspaceDb } from '@/stores/db';
import { openWorkspaceDb } from '@/stores/db';
import {
    createNote,
    getNote,
    openCalendarNote,
    titleIndex,
    updateNoteContent,
    workspaceConfig,
} from '@/stores/workspace';

/**
 * Voice memos: recorded (mic + system audio in the desktop shell), queued
 * in IndexedDB so offline recordings survive reloads, then uploaded for
 * transcription.
 *
 * Long recordings (meetings can run hours) rotate the recorder every
 * SEGMENT_MS: each segment is persisted immediately — a crash loses at
 * most the current segment — and uploads independently under provider
 * size limits. Once every part is transcribed the group is filed into its
 * own note in the Transcripts folder, linked from the daily note's
 * "## Audio Memos" heading. The audio blob is retired only after that note
 * is durably saved (pushed to the server), so a filing hiccup can never lose
 * the recording; the transcript text is kept on the queue until purged.
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
/** Transcripts are filed as their own notes in this folder. */
const TRANSCRIPTS_FOLDER = 'Transcripts';

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
/**
 * The in-flight native (iOS) recording. Capture and rotation live in
 * AudioRecorderPlugin; this only tracks identity for queue bookkeeping.
 */
let nativeSession: {
    groupId: string;
    dateKey: string;
    startedAt: number;
} | null = null;
/** Serializes native segment/stopped events so parts persist in order. */
let nativeChain: Promise<void> = Promise.resolve();
let db: WorkspaceDb | null = null;
let uploaderTimer: ReturnType<typeof setInterval> | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let booted = false;
const uploadsInFlight = new Set<string>();

export const isRecording = ref(false);
export const recordingSeconds = ref(0);
export const recordingHasSystemAudio = ref(false);
export const memoQueue = ref<MemoRecord[]>([]);

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

    return (
        [...groups.values()]
            // A fully filed group is done and retained silently — off the sidebar.
            .filter((parts) => parts.some((memo) => memo.status !== 'filed'))
            .map((parts) => {
                const sorted = [...parts].sort((a, b) => a.part - b.part);
                const failed = sorted.find((memo) => memo.status === 'failed');

                return {
                    groupId: sorted[0].groupId,
                    createdAt: sorted[0].createdAt,
                    durationSec: sorted.reduce(
                        (sum, m) => sum + m.durationSec,
                        0,
                    ),
                    partsDone: sorted.filter((memo) => memo.status === 'done')
                        .length,
                    partsKnown: sorted[0].partsTotal ?? sorted.length,
                    finished: sorted[0].partsTotal !== null,
                    status: sorted.some((memo) => memo.status === 'uploading')
                        ? 'uploading'
                        : failed
                          ? 'failed'
                          : 'pending',
                    error: failed?.error ?? null,
                };
            })
    );
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
        current.segmentTimer = setTimeout(
            () => void rotateSegment(),
            SEGMENT_MS,
        );
    } finally {
        rotating = false;
    }

    void processQueue();
}

/* ------------------------------------------------------------------ */
/* Native iOS capture (AudioRecorderPlugin)                            */
/* ------------------------------------------------------------------ */

/** A part can arrive twice — retained event + foreground sweep. Keep one. */
async function nativePartExists(
    database: WorkspaceDb,
    groupId: string,
    part: number,
): Promise<boolean> {
    const existing = await database.memos
        .where('groupId')
        .equals(groupId)
        .and((memo) => memo.part === part)
        .first();

    return existing !== undefined;
}

/** Fold a finished native segment file into the same offline memo queue. */
async function persistNativeSegment(event: NativeSegmentEvent): Promise<void> {
    const database = workspaceDb();

    if (!database || !nativeRecorder) {
        return;
    }

    if (await nativePartExists(database, event.groupId, event.part)) {
        await nativeRecorder.removeSegment({ path: event.path });

        return;
    }

    const blob = await readSegmentBlob(event.path);
    const session =
        nativeSession?.groupId === event.groupId ? nativeSession : null;

    await database.memos.put({
        id: crypto.randomUUID(),
        groupId: event.groupId,
        part: event.part,
        partsTotal: null,
        dateKey: session?.dateKey ?? todayDailyKey(),
        blob,
        mimeType: event.mimeType || 'audio/mp4',
        durationSec: event.durationSec,
        status: 'pending',
        transcript: null,
        error: null,
        attempts: 0,
        createdAt: new Date(
            Date.now() - event.durationSec * 1000,
        ).toISOString(),
    });

    await nativeRecorder.removeSegment({ path: event.path });
    await refreshQueue();
}

/**
 * The recording finished — whether via the in-app button, the Live
 * Activity's Stop, or an unrecoverable interruption. Runs after all segment
 * events on the serialized chain, so every part is already persisted.
 */
async function handleNativeStopped(event: NativeStoppedEvent): Promise<void> {
    nativeSession = null;
    isRecording.value = false;
    recordingHasSystemAudio.value = false;

    if (elapsedTimer !== null) {
        clearInterval(elapsedTimer);
        elapsedTimer = null;
    }

    const database = workspaceDb();

    if (database) {
        const parts = await database.memos
            .where('groupId')
            .equals(event.groupId)
            .toArray();

        for (const part of parts) {
            await database.memos.update(part.id, { partsTotal: event.parts });
        }

        await refreshQueue();
    }

    void processQueue();
}

function registerNativeRecorderEvents(): void {
    if (!nativeRecorder) {
        return;
    }

    void nativeRecorder.addListener('segment', (event) => {
        nativeChain = nativeChain
            .then(() => persistNativeSegment(event))
            .catch((error) =>
                console.warn(
                    '[donote] native segment persist failed:',
                    error instanceof Error ? error.message : String(error),
                ),
            );
    });

    void nativeRecorder.addListener('stopped', (event) => {
        nativeChain = nativeChain
            .then(() => handleNativeStopped(event))
            .catch((error) =>
                console.warn(
                    '[donote] native stop handling failed:',
                    error instanceof Error ? error.message : String(error),
                ),
            );
    });

    // The web view is suspended while the app is backgrounded: JS timers
    // freeze, and anything that happened out there (a Live Activity stop,
    // rotated segments) may never have been delivered. Reconcile against
    // native truth on every foreground — after any retained events, which
    // consume ahead of this on the same chain.
    const scheduleSync = () => {
        nativeChain = nativeChain
            .then(syncNativeRecorder)
            .catch((error) =>
                console.warn(
                    '[donote] native recorder sync failed:',
                    error instanceof Error ? error.message : String(error),
                ),
            );
    };

    // The plugin emits 'foreground' from UIApplication.didBecomeActive —
    // the DOM visibilitychange event is NOT a reliable resume signal inside
    // WKWebView, which is exactly how Live Activity stops went missing.
    void nativeRecorder.addListener('foreground', scheduleSync);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            scheduleSync();
        }
    });
}

/**
 * Reconcile JS state with the native recorder: resume a still-running
 * session (relaunch mid-recording), or — when the recording was stopped
 * outside the web view (Live Activity Stop while suspended) — clear the
 * stale "recording" UI and rescue any segments whose events never arrived.
 */
async function syncNativeRecorder(): Promise<void> {
    if (!nativeRecorder) {
        return;
    }

    let status: { recording: boolean; startedAt?: number; groupId?: string };

    try {
        status = await nativeRecorder.isRecording();
    } catch {
        return; // Older native shell without the recorder plugin.
    }

    if (status.recording && status.groupId && status.startedAt) {
        nativeSession = {
            groupId: status.groupId,
            dateKey: dateKeyFor('daily', new Date(status.startedAt)),
            startedAt: status.startedAt,
        };
        isRecording.value = true;
        recordingSeconds.value = Math.round(
            (Date.now() - status.startedAt) / 1000,
        );

        if (elapsedTimer === null) {
            elapsedTimer = setInterval(() => {
                recordingSeconds.value += 1;
            }, 1000);
        }

        return;
    }

    // Not recording natively. If JS still thinks it is, the stop happened
    // while we were suspended — the 'stopped' event may or may not have
    // been retained; the sweep below recovers the parts either way.
    if (nativeSession !== null) {
        nativeSession = null;
        isRecording.value = false;

        if (elapsedTimer !== null) {
            clearInterval(elapsedTimer);
            elapsedTimer = null;
        }
    }

    await adoptNativePending();
    await adoptOrphanedGroups();
    await refreshQueue();
    void processQueue();
}

/** Segment files a killed app left in the native container — rescue them. */
async function adoptNativePending(): Promise<void> {
    if (!nativeRecorder) {
        return;
    }

    try {
        const { items } = await nativeRecorder.pendingSegments();
        const database = workspaceDb();

        if (!database || items.length === 0) {
            return;
        }

        for (const item of items) {
            try {
                if (await nativePartExists(database, item.groupId, item.part)) {
                    await nativeRecorder.removeSegment({ path: item.path });
                    continue;
                }

                const blob = await readSegmentBlob(item.path);

                await database.memos.put({
                    id: crypto.randomUUID(),
                    groupId: item.groupId,
                    part: item.part,
                    partsTotal: null,
                    dateKey: dateKeyFor('daily', new Date(item.createdAt)),
                    blob,
                    mimeType: 'audio/mp4',
                    // 32 kbps AAC ≈ 4 KB/s — close enough for display.
                    durationSec: Math.round(item.sizeBytes / 4000),
                    status: 'pending',
                    transcript: null,
                    error: null,
                    attempts: 0,
                    createdAt: item.createdAt,
                });

                await nativeRecorder.removeSegment({ path: item.path });
            } catch (error) {
                console.warn('[donote] orphaned segment rescue failed', error);
            }
        }

        await refreshQueue();
    } catch {
        // Older native shell without the recorder plugin.
    }
}

export async function startRecording(): Promise<void> {
    // iOS records natively: capture survives backgrounding/locking, and the
    // plugin runs the Live Activity. Segments come back via events.
    if (nativeRecorder !== null) {
        if (nativeSession !== null || isRecording.value) {
            return;
        }

        const { groupId, startedAt } = await nativeRecorder.start();

        nativeSession = { groupId, dateKey: todayDailyKey(), startedAt };
        isRecording.value = true;
        recordingHasSystemAudio.value = false;
        recordingSeconds.value = 0;
        elapsedTimer = setInterval(() => {
            recordingSeconds.value += 1;
        }, 1000);

        return;
    }

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
    if (nativeRecorder !== null && nativeSession !== null) {
        // Bookkeeping (partsTotal, destination prompt, uploads) runs in the
        // 'stopped' event handler — the same path the Live Activity's Stop
        // button and interruption endings take.
        await nativeRecorder.stop();

        return;
    }

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

    void processQueue();
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
    if (nativeRecorder !== null && nativeSession !== null) {
        const groupId = nativeSession.groupId;
        nativeSession = null;
        isRecording.value = false;

        if (elapsedTimer !== null) {
            clearInterval(elapsedTimer);
            elapsedTimer = null;
        }

        await nativeRecorder.discard();

        const database = workspaceDb();

        if (database) {
            await database.memos.where('groupId').equals(groupId).delete();
            await refreshQueue();
        }

        return;
    }

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

/** Append a wiki link for a freshly created note to today's daily note. */
export async function appendLinkToTodayNote(title: string): Promise<void> {
    const note = await openCalendarNote('daily', todayDailyKey());
    const current = getNote(note.id) ?? note;

    await updateNoteContent(
        note.id,
        appendLine(current.content, `- [[${title}]]`),
    );
}

/** The transcript note's title, e.g. "Audio memo 2026-07-25 07:03:27". */
function transcriptTitle(first: MemoRecord): string {
    const started = new Date(first.createdAt);
    const pad = (n: number): string => String(n).padStart(2, '0');
    const date = safeDailyKey(first.dateKey, todayDailyKey());
    const time = `${pad(started.getHours())}:${pad(started.getMinutes())}:${pad(
        started.getSeconds(),
    )}`;

    return `Audio memo ${date} ${time}`;
}

/**
 * File a completed recording into its own note in the Transcripts folder and
 * link it from the daily note's "## Audio Memos" heading. Retire the audio
 * only once that note is durably saved (pushed to the server).
 *
 * Transcripts live in pipeline-owned notes so they can never collide with the
 * user's edits: the daily-note link can be replaced with a summary, or the
 * transcript post-processed, and the recorder neither re-adds nor loses
 * anything. The link is written exactly once (at creation); it is never
 * re-healed. Idempotent and safe to call repeatedly.
 */
async function fileGroup(groupId: string): Promise<void> {
    const database = workspaceDb();

    if (!database) {
        return;
    }

    const parts = await database.memos
        .where('groupId')
        .equals(groupId)
        .toArray();

    if (parts.length === 0) {
        return;
    }

    const ordered = [...parts].sort((a, b) => a.part - b.part);
    const first = ordered[0];

    // Act only once the group is complete and every part is transcribed.
    if (
        first.partsTotal === null ||
        parts.length < first.partsTotal ||
        parts.some((part) => part.status !== 'done' && part.status !== 'filed')
    ) {
        return;
    }

    // Already filed and retired.
    if (parts.every((part) => part.status === 'filed')) {
        return;
    }

    const dateKey = safeDailyKey(first.dateKey, todayDailyKey());
    const title = transcriptTitle(first);

    // Locate the transcript note: by the id we recorded, else by title (covers
    // a crash that lost the id before it was stamped on the parts).
    let note = first.noteId !== undefined ? getNote(first.noteId) : undefined;

    if (note === undefined) {
        note = titleIndex.value.get(title.trim().toLowerCase());
    }

    // Create it once, and link it from the daily note a single time.
    if (note === undefined) {
        const paragraphs =
            ordered
                .map((part) => part.transcript?.trim() ?? '')
                .filter((paragraph) => paragraph !== '')
                .join('\n\n') || '(empty transcription)';

        note = await createNote({
            title,
            folder: TRANSCRIPTS_FOLDER,
            content: paragraphs,
        });

        const daily = await openCalendarNote('daily', dateKey);
        const dailyCurrent = getNote(daily.id) ?? daily;
        await updateNoteContent(
            daily.id,
            appendUnderHeading(
                dailyCurrent.content,
                'Audio Memos',
                `- [[${title}]]`,
            ),
        );
    }

    const noteId = note.id;

    // Stamp the note id on every part so retries never create a duplicate.
    for (const part of parts) {
        if (part.noteId !== noteId) {
            await database.memos.update(part.id, { noteId });
        }
    }

    // Retire the audio only once the transcript note is durably saved (pushed
    // to the server, so dirty has cleared) — or if the user has deleted it.
    // The transcript text stays on the parts as a further backup until purge.
    const saved = getNote(noteId);
    const confirmed = saved === undefined || saved.dirty === 0;

    if (confirmed) {
        const emptyBlob = new Blob([]);

        for (const part of parts) {
            if (part.status !== 'filed') {
                await database.memos.update(part.id, {
                    status: 'filed',
                    blob: emptyBlob,
                });
            }
        }
    }

    await refreshQueue();
}

const FILED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Drop filed memos once they're old enough that the note edit has synced. */
async function purgeFiledMemos(): Promise<void> {
    const database = workspaceDb();

    if (!database) {
        return;
    }

    const cutoff = Date.now() - FILED_TTL_MS;
    const filed = await database.memos
        .where('status')
        .equals('filed')
        .toArray();

    for (const memo of filed) {
        if (Date.parse(memo.createdAt) < cutoff) {
            await database.memos.delete(memo.id);
        }
    }
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
            // Never let a stalled transcription wedge the queue forever — the
            // hung part is what tempts a risky app relaunch. Fail and retry.
            { timeoutMs: 4 * 60 * 1000 },
        );

        await database.memos.update(memo.id, {
            status: 'done',
            transcript: text,
        });
        await fileGroup(memo.groupId);
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

    // Upload anything not yet transcribed. `filed` is retired; `done` is
    // handled by the reconciliation pass below.
    for (const memo of queued) {
        if (
            (memo.status === 'pending' ||
                memo.status === 'uploading' ||
                memo.status === 'failed') &&
            !uploadsInFlight.has(memo.id)
        ) {
            await uploadMemo(memo);
        }
    }

    // Reconcile every group: file completed ones, and re-heal any whose
    // transcript went missing from its note (e.g. a sync overwrote it).
    const groupIds = new Set(
        (await database.memos.toArray()).map((memo) => memo.groupId),
    );

    for (const groupId of groupIds) {
        await fileGroup(groupId);
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
        // A native recording that survived a web-view reload is still open —
        // its parts get partsTotal from the 'stopped' event, not from here.
        if (memo.groupId === nativeSession?.groupId) {
            continue;
        }

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
    // Native recordings live outside the web view and survive reloads — the
    // resumed page picks the session back up via resumeNativeRecordingState.
    if (nativeSession !== null) {
        return;
    }

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

    registerNativeRecorderEvents();

    // Reconcile with the native recorder BEFORE closing orphaned groups:
    // a still-running recording's open parts must not be finalized, and a
    // recording stopped while suspended needs its segments swept in.
    void syncNativeRecorder()
        .then(adoptOrphanedGroups)
        .then(purgeFiledMemos)
        .then(refreshQueue)
        .then(processQueue);

    window.addEventListener('online', () => void processQueue());
    window.addEventListener('pagehide', handlePageHide);

    if (uploaderTimer === null) {
        uploaderTimer = setInterval(() => void processQueue(), 30000);
    }
}
