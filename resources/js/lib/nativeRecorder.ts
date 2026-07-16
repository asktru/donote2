import { Capacitor, registerPlugin } from '@capacitor/core';

import { isNativeIos } from '@/lib/platform';

/**
 * Bridge to the native iOS voice recorder (AudioRecorderPlugin). WKWebView's
 * getUserMedia is suspended when the app backgrounds, so on iOS capture runs
 * natively — with the `audio` background mode and a recording Live Activity —
 * and finished m4a segments are handed back here for the shared memo queue.
 * Null everywhere else; web/desktop keep the MediaRecorder path.
 */

export interface NativeSegmentEvent {
    path: string;
    groupId: string;
    part: number;
    mimeType: string;
    durationSec: number;
    last: boolean;
}

export interface NativeStoppedEvent {
    groupId: string;
    parts: number;
    durationSec: number;
}

export interface NativePendingSegment {
    path: string;
    groupId: string;
    part: number;
    sizeBytes: number;
    createdAt: string;
}

export interface NativeAudioRecorder {
    start: () => Promise<{ groupId: string; startedAt: number }>;
    stop: () => Promise<{ parts: number; durationSec: number }>;
    discard: () => Promise<void>;
    isRecording: () => Promise<{
        recording: boolean;
        startedAt?: number;
        groupId?: string;
    }>;
    pendingSegments: () => Promise<{ items: NativePendingSegment[] }>;
    removeSegment: (options: { path: string }) => Promise<void>;
    addListener(
        event: 'segment',
        callback: (data: NativeSegmentEvent) => void,
    ): Promise<{ remove: () => Promise<void> }>;
    addListener(
        event: 'stopped',
        callback: (data: NativeStoppedEvent) => void,
    ): Promise<{ remove: () => Promise<void> }>;
}

export const nativeRecorder: NativeAudioRecorder | null = isNativeIos()
    ? registerPlugin<NativeAudioRecorder>('AudioRecorder')
    : null;

/** Read a finished segment file into a Blob (native path → web view fetch). */
export async function readSegmentBlob(path: string): Promise<Blob> {
    const response = await fetch(Capacitor.convertFileSrc(path));

    if (!response.ok) {
        throw new Error(`Could not read recording segment (${response.status}).`);
    }

    return response.blob();
}
