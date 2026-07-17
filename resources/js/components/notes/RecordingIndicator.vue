<script setup lang="ts">
import { Square } from '@lucide/vue';
import { computed } from 'vue';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    chooseDestination,
    isRecording,
    pendingDestination,
    recordingHasSystemAudio,
    recordingSeconds,
    stopRecording,
} from '@/stores/memos';

/**
 * The live-recording stop control and the post-recording destination prompt,
 * rendered on every top-level page so a recording can be watched and stopped
 * wherever the user navigates — it keeps running across the app.
 */

const timeLabel = computed(() => {
    const minutes = Math.floor(recordingSeconds.value / 60);
    const seconds = recordingSeconds.value % 60;

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
});

const destinationMinutes = computed(() =>
    pendingDestination.value
        ? Math.round(pendingDestination.value.durationSec / 60)
        : 0,
);

function pickDestination(destination: 'daily' | 'note'): void {
    const pending = pendingDestination.value;

    if (pending) {
        void chooseDestination(pending.groupId, destination);
    }
}

function dismissDestination(open: boolean): void {
    if (!open && pendingDestination.value) {
        // Dismissed without choosing — default to the daily note.
        pickDestination('daily');
    }
}
</script>

<template>
    <div>
        <button
            v-if="isRecording"
            type="button"
            class="fixed right-5 bottom-[calc(1.25rem+var(--bottom-chrome,0px))] z-50 flex items-center gap-2.5 rounded-full bg-red-600 py-2.5 pr-5 pl-4 text-white shadow-xl transition-colors hover:bg-red-700"
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

        <Dialog
            :open="pendingDestination !== null"
            @update:open="dismissDestination"
        >
            <DialogContent class="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Where should this memo go?</DialogTitle>
                    <DialogDescription>
                        That was a {{ destinationMinutes }}-minute recording — a
                        long transcript can live in its own note, linked from
                        today's daily note.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter class="gap-2 sm:justify-start">
                    <Button variant="outline" @click="pickDestination('daily')">
                        Append to daily note
                    </Button>
                    <Button @click="pickDestination('note')">
                        Create a dedicated note
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </div>
</template>
