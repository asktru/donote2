<script setup lang="ts">
import {
    FilePlus2,
    ListChecks,
    Mic,
    Paperclip,
    Plus,
    Search,
    Sparkles,
} from '@lucide/vue';
import { computed, ref } from 'vue';
import { toast } from 'vue-sonner';

import { parseAgendaConfig } from '@/lib/agenda';
import { insertAttachments } from '@/lib/attachments';
import { isTouchDevice } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { aiDialogOpen } from '@/stores/aiPrompts';
import { activeEditor, editorFocused } from '@/stores/editorRegistry';
import { appendLinkToTodayNote, isRecording, startRecording } from '@/stores/memos';
import { promptText } from '@/stores/prompt';
import { currentView, openNote, searchOpen } from '@/stores/ui';
import { createNote, fetchAgenda, getNote } from '@/stores/workspace';

const expanded = ref(false);
const starting = ref(false);
const filePicker = ref<HTMLInputElement | null>(null);

// On phones the editor toolbar sits above the keyboard where the FAB would
// be; hide the FAB while typing so the two don't overlap.
const hidden = computed(() => isTouchDevice && editorFocused.value);

function pickFiles(): void {
    expanded.value = false;
    filePicker.value?.click();
}

function openAiPrompt(): void {
    expanded.value = false;
    aiDialogOpen.value = true;
}

/** The open note when it's an agenda note (has `agenda` front matter). */
const agendaNoteId = computed<string | null>(() => {
    if (currentView.value.kind !== 'note') {
        return null;
    }

    const note = getNote(currentView.value.id);

    return note && parseAgendaConfig(note.content) !== null ? note.id : null;
});

async function runFetchAgenda(): Promise<void> {
    expanded.value = false;
    const id = agendaNoteId.value;

    if (id === null) {
        return;
    }

    const count = await fetchAgenda(id);
    toast(
        count === 0
            ? 'No new meetings to pull in.'
            : `Pulled action items from ${count} meeting${count === 1 ? '' : 's'}.`,
    );
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

async function newNote(): Promise<void> {
    expanded.value = false;
    const title = await promptText({
        title: 'New note',
        placeholder: 'Note title',
    });

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

</script>

<template>
    <div
        v-show="!hidden"
        class="pointer-events-none absolute right-5 bottom-5 z-40"
    >
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
                <button
                    v-if="agendaNoteId"
                    type="button"
                    class="flex items-center gap-2 rounded-full border border-border/60 bg-background px-3.5 py-2 text-sm font-medium shadow-lg hover:bg-muted/60"
                    @click="runFetchAgenda"
                >
                    <ListChecks class="size-4" /> Fetch agenda
                </button>
            </template>

            <input
                ref="filePicker"
                type="file"
                multiple
                class="hidden"
                @change="onFilesPicked"
            />

            <!-- Search: quick reach on phones, where there's no ⌘K. -->
            <button
                v-if="!isRecording && !expanded"
                type="button"
                class="flex size-11 items-center justify-center rounded-full border border-border/60 bg-background text-foreground shadow-lg transition-transform hover:scale-105 md:hidden"
                aria-label="Search"
                @click="searchOpen = true"
            >
                <Search class="size-5" />
            </button>

            <button
                v-if="!isRecording"
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
