<script setup lang="ts">
import { RefreshCw } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted } from 'vue';

import { humanizeKey } from '@/core/dates';
import type { LocalNote } from '@/stores/db';
import { openNote, syncedLinePanel } from '@/stores/ui';
import { liveNotes } from '@/stores/workspace';

/**
 * Every location of a synced line (^id), anchored near the clicked ⟲
 * glyph — one click jumps to any other copy.
 */

interface Location {
    noteId: string;
    label: string;
    line: number;
    preview: string;
}

function noteLabel(note: LocalNote): string {
    if (note.type !== 'note' && note.dateKey !== null) {
        return humanizeKey(note.dateKey);
    }

    return note.title || 'Untitled';
}

const locations = computed<Location[]>(() => {
    const panel = syncedLinePanel.value;

    if (!panel) {
        return [];
    }

    const marker = new RegExp(`\\s\\^${panel.syncId}\\s*$`);
    const found: Location[] = [];

    for (const note of liveNotes.value) {
        const lines = note.content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            if (marker.test(lines[i])) {
                found.push({
                    noteId: note.id,
                    label: noteLabel(note),
                    line: i,
                    preview: lines[i]
                        .replace(marker, '')
                        .replace(/^\s*[-+*]\s(\[.\]\s)?/, '')
                        .trim()
                        .slice(0, 60),
                });
            }
        }
    }

    return found;
});

const style = computed(() => {
    const panel = syncedLinePanel.value;

    if (!panel) {
        return {};
    }

    return {
        left: `${Math.min(panel.x, window.innerWidth - 340)}px`,
        top: `${Math.min(panel.y + 8, window.innerHeight - 260)}px`,
    };
});

function jump(location: Location): void {
    syncedLinePanel.value = null;
    openNote(location.noteId, { line: location.line });
}

function close(): void {
    syncedLinePanel.value = null;
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && syncedLinePanel.value !== null) {
        event.preventDefault();
        close();
    }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true));
</script>

<template>
    <Teleport to="body">
        <template v-if="syncedLinePanel">
            <div class="fixed inset-0 z-[60]" @click="close" />
            <div
                class="fixed z-[61] w-80 rounded-lg border border-border bg-popover p-1.5 shadow-xl"
                :style="style"
            >
                <p
                    class="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                >
                    <RefreshCw class="size-3" />
                    Synced line · {{ locations.length }} locations
                </p>
                <button
                    v-for="location in locations"
                    :key="`${location.noteId}:${location.line}`"
                    type="button"
                    class="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted/70"
                    @click="jump(location)"
                >
                    <span class="block truncate text-xs font-medium">
                        {{ location.label }}
                    </span>
                    <span
                        class="block truncate text-[11px] text-muted-foreground"
                    >
                        {{ location.preview }}
                    </span>
                </button>
            </div>
        </template>
    </Teleport>
</template>
