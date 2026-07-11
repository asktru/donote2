<script setup lang="ts">
import { CloudUpload, Loader2, Mic, TriangleAlert, X } from '@lucide/vue';
import { computed } from 'vue';

import type { MemoRecord } from '@/stores/db';
import {
    cancelMemo,
    discardRecording,
    isRecording,
    memoQueue,
    recordingSeconds,
} from '@/stores/memos';

const hasContent = computed(() => isRecording.value || memoQueue.value.length > 0);

function statusLabel(memo: MemoRecord): string {
    switch (memo.status) {
        case 'uploading':
            return 'Transcribing…';
        case 'failed':
            return memo.error ?? 'Failed — will retry';
        default:
            return navigator.onLine ? 'Waiting…' : 'Waiting for connection…';
    }
}

function timeLabel(memo: MemoRecord): string {
    const time = new Date(memo.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
    const minutes = Math.floor(memo.durationSec / 60);
    const seconds = memo.durationSec % 60;

    return `${time} · ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function recordingLabel(): string {
    const minutes = Math.floor(recordingSeconds.value / 60);
    const seconds = recordingSeconds.value % 60;

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
</script>

<template>
    <section v-if="hasContent">
        <p
            class="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
        >
            Recordings
        </p>

        <div
            v-if="isRecording"
            class="group flex items-center gap-2 rounded-md px-2 py-1 text-sm"
        >
            <span class="relative flex size-2.5 shrink-0">
                <span
                    class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/60"
                />
                <span
                    class="relative inline-flex size-2.5 rounded-full bg-red-500"
                />
            </span>
            <span class="min-w-0 flex-1 truncate">
                Recording · {{ recordingLabel() }}
            </span>
            <button
                type="button"
                class="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                title="Discard recording"
                aria-label="Discard recording"
                @click="discardRecording"
            >
                <X class="size-3.5" />
            </button>
        </div>

        <div
            v-for="memo in memoQueue"
            :key="memo.id"
            class="group flex items-center gap-2 rounded-md px-2 py-1 text-sm"
        >
            <Loader2
                v-if="memo.status === 'uploading'"
                class="size-3.5 shrink-0 animate-spin text-muted-foreground"
            />
            <TriangleAlert
                v-else-if="memo.status === 'failed'"
                class="size-3.5 shrink-0 text-amber-500"
            />
            <CloudUpload
                v-else
                class="size-3.5 shrink-0 text-muted-foreground"
            />
            <span class="min-w-0 flex-1">
                <span class="block truncate text-xs">
                    <Mic class="mr-0.5 inline size-3" />
                    {{ timeLabel(memo) }}
                </span>
                <span
                    class="block truncate text-[11px] text-muted-foreground"
                    :title="memo.error ?? undefined"
                >
                    {{ statusLabel(memo) }}
                </span>
            </span>
            <button
                type="button"
                class="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                title="Cancel this memo"
                aria-label="Cancel memo"
                @click="cancelMemo(memo.id)"
            >
                <X class="size-3.5" />
            </button>
        </div>
    </section>
</template>
