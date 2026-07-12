<script setup lang="ts">
import { FilePlus2, Mic, Paperclip, Plus, Sparkles, Square } from '@lucide/vue';
import { computed, ref } from 'vue';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { insertAttachments } from '@/lib/attachments';
import { cn } from '@/lib/utils';
import { aiDialogOpen } from '@/stores/aiPrompts';
import { activeEditor } from '@/stores/editorRegistry';
import {
    appendLinkToTodayNote,
    chooseDestination,
    isRecording,
    pendingDestination,
    recordingHasSystemAudio,
    recordingSeconds,
    startRecording,
    stopRecording,
} from '@/stores/memos';
import { openNote } from '@/stores/ui';
import { createNote } from '@/stores/workspace';

const expanded = ref(false);
const starting = ref(false);
const filePicker = ref<HTMLInputElement | null>(null);

function pickFiles(): void {
    expanded.value = false;
    filePicker.value?.click();
}

function openAiPrompt(): void {
    expanded.value = false;
    aiDialogOpen.value = true;
}

/** Insert picked files at the focused editor's cursor. */
async function onFilesPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';

    const view = activeEditor.value;

    if (!view || files.length === 0) {
        return;
    }

    await insertAttachments(view, files);
}

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
                <button
                    v-if="activeEditor !== null"
                    type="button"
                    class="flex items-center gap-2 rounded-full border border-border/60 bg-background px-3.5 py-2 text-sm font-medium shadow-lg hover:bg-muted/60"
                    @click="pickFiles"
                >
                    <Paperclip class="size-4" /> Attach file
                </button>
                <button
                    v-if="activeEditor !== null"
                    type="button"
                    class="flex items-center gap-2 rounded-full border border-border/60 bg-background px-3.5 py-2 text-sm font-medium shadow-lg hover:bg-muted/60"
                    @click="openAiPrompt"
                >
                    <Sparkles class="size-4" /> AI prompt
                </button>
            </template>

            <input
                ref="filePicker"
                type="file"
                multiple
                class="hidden"
                @change="onFilesPicked"
            />

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

        <Dialog
            :open="pendingDestination !== null"
            @update:open="dismissDestination"
        >
            <DialogContent class="pointer-events-auto sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Where should this memo go?</DialogTitle>
                    <DialogDescription>
                        That was a {{ destinationMinutes }}-minute recording —
                        a long transcript can live in its own note, linked
                        from today's daily note.
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
