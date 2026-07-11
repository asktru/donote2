<script setup lang="ts">
import { FilePlus2, Mic, Plus, Square } from '@lucide/vue';
import { computed, ref } from 'vue';

import { cn } from '@/lib/utils';
import {
    isRecording,
    recordingHasSystemAudio,
    recordingSeconds,
    startRecording,
    stopRecording,
} from '@/stores/memos';
import { appendLinkToTodayNote } from '@/stores/memos';
import { openNote } from '@/stores/ui';
import { createNote } from '@/stores/workspace';

const expanded = ref(false);
const starting = ref(false);

const timeLabel = computed(() => {
    const minutes = Math.floor(recordingSeconds.value / 60);
    const seconds = recordingSeconds.value % 60;

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
});

async function newNote(): Promise<void> {
    expanded.value = false;
    const title = prompt('Note title:')?.trim();

    if (!title) {
        return;
    }

    const note = await createNote({ title });
    await appendLinkToTodayNote(title);
    openNote(note.id);
}

async function newRecording(): Promise<void> {
    expanded.value = false;
    starting.value = true;

    try {
        await startRecording();
    } catch {
        alert(
            'Could not start recording — check microphone permission for this app.',
        );
    } finally {
        starting.value = false;
    }
}

async function finishRecording(): Promise<void> {
    await stopRecording();
}
</script>

<template>
    <div class="pointer-events-none absolute right-5 bottom-5 z-40">
        <div class="pointer-events-auto flex flex-col items-end gap-2">
            <template v-if="expanded && !isRecording">
                <button
                    type="button"
                    class="flex items-center gap-2 rounded-full border border-border/60 bg-background px-3.5 py-2 text-sm font-medium shadow-lg hover:bg-muted/60"
                    @click="newNote"
                >
                    <FilePlus2 class="size-4" /> New note
                </button>
                <button
                    type="button"
                    class="flex items-center gap-2 rounded-full border border-border/60 bg-background px-3.5 py-2 text-sm font-medium shadow-lg hover:bg-muted/60"
                    @click="newRecording"
                >
                    <Mic class="size-4" /> New recording
                </button>
            </template>

            <button
                v-if="isRecording"
                type="button"
                class="flex items-center gap-2.5 rounded-full bg-red-600 py-2.5 pr-5 pl-4 text-white shadow-xl transition-colors hover:bg-red-700"
                :title="
                    recordingHasSystemAudio
                        ? 'Recording microphone + system audio — click to stop'
                        : 'Recording microphone — click to stop'
                "
                @click="finishRecording"
            >
                <span class="relative flex size-3">
                    <span
                        class="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70"
                    />
                    <span
                        class="relative inline-flex size-3 rounded-full bg-white"
                    />
                </span>
                <span class="text-sm font-semibold tabular-nums">{{
                    timeLabel
                }}</span>
                <Square class="size-3.5 fill-current" />
            </button>

            <button
                v-else
                type="button"
                :class="
                    cn(
                        'flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-105',
                        expanded && 'rotate-45',
                    )
                "
                :disabled="starting"
                aria-label="Quick capture"
                @click="expanded = !expanded"
            >
                <Plus class="size-5.5" />
            </button>
        </div>
    </div>
</template>
