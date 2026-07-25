<script setup lang="ts">
import { Square } from '@lucide/vue';
import { computed } from 'vue';

import {
    isRecording,
    recordingHasSystemAudio,
    recordingSeconds,
    stopRecording,
} from '@/stores/memos';

/**
 * The live-recording stop control, rendered on every top-level page so a
 * recording can be watched and stopped wherever the user navigates — it keeps
 * running across the app. Finished recordings file themselves into their own
 * transcript note automatically, so there's no destination prompt.
 */

const timeLabel = computed(() => {
    const minutes = Math.floor(recordingSeconds.value / 60);
    const seconds = recordingSeconds.value % 60;

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
});
</script>

<template>
    <button
        v-if="isRecording"
        type="button"
        class="fixed bottom-[calc(1.25rem+var(--bottom-chrome,0px))] left-5 z-50 flex items-center gap-2.5 rounded-full bg-red-600 py-2.5 pr-5 pl-4 text-white shadow-xl transition-colors hover:bg-red-700"
        :title="
            recordingHasSystemAudio
                ? 'Recording microphone + system audio — click to stop'
                : 'Recording microphone — click to stop'
        "
        @click="stopRecording"
    >
        <span class="relative flex size-3">
            <span
                class="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70"
            />
            <span class="relative inline-flex size-3 rounded-full bg-white" />
        </span>
        <span class="text-sm font-semibold tabular-nums">{{ timeLabel }}</span>
        <Square class="size-3.5 fill-current" />
    </button>
</template>
