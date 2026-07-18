<script setup lang="ts">
import { ArchiveRestore, Folder, Trash2, X } from '@lucide/vue';
import { format } from 'date-fns';
import { ref } from 'vue';

import MobileSidebarButton from '@/components/notes/MobileSidebarButton.vue';
import { Button } from '@/components/ui/button';
import { humanizeKey } from '@/core/dates';
import type { LocalNote } from '@/stores/db';
import { purgeNotes, restoreNote, trashedNotes } from '@/stores/workspace';

const emit = defineEmits<{
    'open-note': [id: string];
}>();

const purging = ref(false);

function label(note: LocalNote): string {
    if (note.type !== 'note' && note.dateKey !== null) {
        return humanizeKey(note.dateKey);
    }

    return note.title || 'Untitled';
}

function preview(note: LocalNote): string {
    return note.content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && line !== '---')
        .slice(0, 1)
        .join(' ')
        .slice(0, 80);
}

function trashedAt(note: LocalNote): string {
    return format(new Date(note.updatedAt), 'MMM d, HH:mm');
}

async function restore(note: LocalNote): Promise<void> {
    await restoreNote(note.id);
    emit('open-note', note.id);
}

async function purgeOne(note: LocalNote): Promise<void> {
    if (
        !confirm(
            `Permanently delete “${label(note)}”? This cannot be undone.`,
        )
    ) {
        return;
    }

    purging.value = true;

    try {
        await purgeNotes([note.id]);
    } finally {
        purging.value = false;
    }
}

async function emptyTrash(): Promise<void> {
    const count = trashedNotes.value.length;

    if (
        !confirm(
            `Permanently delete all ${count} note${count === 1 ? '' : 's'} in the trash? This cannot be undone.`,
        )
    ) {
        return;
    }

    purging.value = true;

    try {
        await purgeNotes(trashedNotes.value.map((note) => note.id));
    } finally {
        purging.value = false;
    }
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <header
            class="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4"
        >
            <MobileSidebarButton />
            <Trash2 class="size-4 text-muted-foreground" />
            <h1 class="text-base font-semibold">Trash</h1>
            <span class="text-xs text-muted-foreground">
                {{ trashedNotes.length }}
            </span>
            <Button
                v-if="trashedNotes.length > 0"
                variant="outline"
                size="sm"
                class="ml-auto h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-destructive"
                :disabled="purging"
                @click="emptyTrash"
            >
                <Trash2 class="size-3.5" /> Empty trash…
            </Button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div
                v-if="trashedNotes.length === 0"
                class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"
            >
                <Trash2 class="size-8 opacity-40" />
                <p class="text-sm">Trash is empty.</p>
            </div>

            <div
                v-for="note in trashedNotes"
                :key="note.id"
                class="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/50"
            >
                <Trash2
                    class="mt-1 size-4 shrink-0 text-muted-foreground/60"
                />
                <div class="min-w-0 flex-1">
                    <p class="truncate text-sm">{{ label(note) }}</p>
                    <p
                        class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
                    >
                        <span>{{ trashedAt(note) }}</span>
                        <span
                            v-if="note.folder !== ''"
                            class="inline-flex items-center gap-1"
                        >
                            <Folder class="size-3" />{{ note.folder }}
                        </span>
                        <span class="truncate">{{ preview(note) }}</span>
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    class="h-7 shrink-0 gap-1.5 px-2 text-xs opacity-0 group-hover:opacity-100"
                    @click="restore(note)"
                >
                    <ArchiveRestore class="size-3.5" /> Restore
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    class="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                    :disabled="purging"
                    title="Delete forever"
                    @click="purgeOne(note)"
                >
                    <X class="size-3.5" /> Delete forever
                </Button>
            </div>
        </div>
    </div>
</template>
