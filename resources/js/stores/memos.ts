import { computed, ref } from 'vue';

import { todayDailyKey } from '@/core/dates';
import { appendLine, appendUnderAudioMemo } from '@/core/memoNote';
import { apiUpload } from '@/lib/api';
import { donoteDesktop } from '@/lib/desktop';
import type { MemoRecord, WorkspaceDb } from '@/stores/db';
import { openWorkspaceDb } from '@/stores/db';
import {
    getNote,
    openCalendarNote,
    updateNoteContent,
    workspaceConfig,
} from '@/stores/workspace';

/**
 * Voice memos: recorded (mic + system audio in the desktop shell), queued
 * in IndexedDB so offline recordings survive reloads, then uploaded for
 * transcription and appended to the daily note of the recording day.
 */

interface ActiveRecording {
    recorder: MediaRecorder;
    chunks: Blob[];
    streams: MediaStream[];
    audioContext: AudioContext | null;
    dateKey: string;
    startedAt: number;
    /** True when system audio is mixed in alongside the microphone. */
    systemAudio: boolean;
}

let active: ActiveRecording | null = null;
let db: WorkspaceDb | null = null;
let uploaderTimer: ReturnType<typeof setInterval> | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
const uploadsInFlight = new Set<string>();

export const isRecording = ref(false);
export const recordingSeconds = ref(0);
export const recordingHasSystemAudio = ref(false);
export const memoQueue = ref<MemoRecord[]>([]);

export const activeMemoCount = computed(
    () => memoQueue.value.length + (isRecording.value ? 1 : 0),
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

export async function startRecording(): Promise<void> {
    if (active !== null) {
        return;
    }

    const capture = await captureStreams();
    const recorder = new MediaRecorder(capture.stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm',
    });

    active = {
        recorder,
        chunks: [],
        streams: capture.streams,
        audioContext: capture.audioContext,
        dateKey: todayDailyKey(),
        startedAt: Date.now(),
        systemAudio: capture.systemAudio,
    };

    recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            active?.chunks.push(event.data);
        }
    };

    recorder.start(5000);
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
        current.streams.forEach((stream) =>
            stream.getTracks().forEach((track) => track.stop()),
        );
        void current.audioContext?.close();
    }

    return current;
}

/** Stop and queue the memo for transcription. */
export async function stopRecording(): Promise<void> {
    const current = active;

    if (current === null) {
        return;
    }

    const stopped = new Promise<void>((resolve) => {
        current.recorder.onstop = () => resolve();
    });

    current.recorder.stop();
    await stopped;

    const record: MemoRecord = {
        id: crypto.randomUUID(),
        dateKey: current.dateKey,
        blob: new Blob(current.chunks, { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationSec: Math.round((Date.now() - current.startedAt) / 1000),
        status: 'pending',
        error: null,
        attempts: 0,
        createdAt: new Date(current.startedAt).toISOString(),
    };

    teardownRecording();

    const database = workspaceDb();

    if (database) {
        await database.memos.put(record);
        await refreshQueue();
    }

    void processQueue();
}

/** Discard the in-progress recording without saving anything. */
export function discardRecording(): void {
    const current = active;

    if (current) {
        current.recorder.onstop = null;
        current.recorder.stop();
    }

    teardownRecording();
}

/** Remove a queued memo (stuck upload, unwanted recording). */
export async function cancelMemo(id: string): Promise<void> {
    const database = workspaceDb();

    if (database) {
        await database.memos.delete(id);
        await refreshQueue();
    }
}

async function appendTranscript(memo: MemoRecord, text: string): Promise<void> {
    const note = await openCalendarNote('daily', memo.dateKey);
    const current = getNote(note.id) ?? note;
    const time = new Date(memo.createdAt).toLocaleTimeString([], {
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
            new File([memo.blob], `memo-${memo.id}.webm`, {
                type: memo.mimeType,
            }),
        );

        const { text } = await apiUpload<{ text: string }>(
            `/api/${config.teamSlug}/memos/transcriptions`,
            form,
        );

        await appendTranscript(memo, text === '' ? '(empty transcription)' : text);
        await database.memos.delete(memo.id);
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

/** Try every queued memo; called on start, on reconnect, and periodically. */
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
        if (!uploadsInFlight.has(memo.id)) {
            await uploadMemo(memo);
        }
    }
}

export function startMemoUploader(): void {
    void refreshQueue();
    void processQueue();

    window.addEventListener('online', () => void processQueue());

    if (uploaderTimer === null) {
        uploaderTimer = setInterval(() => void processQueue(), 30000);
    }
}

export function stopMemoUploader(): void {
    if (uploaderTimer !== null) {
        clearInterval(uploaderTimer);
        uploaderTimer = null;
    }

    discardRecording();
}
