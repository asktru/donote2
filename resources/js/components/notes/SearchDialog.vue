<script setup lang="ts">
import { FilePlus, FileText, Search } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { humanizeKey } from '@/core/dates';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { LocalNote } from '@/stores/db';
import { searchOpen } from '@/stores/ui';
import { createNote, searchLocal, workspaceConfig } from '@/stores/workspace';
import type { WorkspaceConfig } from '@/stores/workspace';

const emit = defineEmits<{
    'open-note': [id: string];
}>();

interface ResultRow {
    id: string;
    title: string;
    type: string;
    dateKey: string | null;
    folder: string;
    snippet: string;
}

const query = ref('');
const rows = ref<ResultRow[]>([]);
const highlighted = ref(0);

let serverTimer: ReturnType<typeof setTimeout> | null = null;

function localRows(notes: LocalNote[]): ResultRow[] {
    return notes.map((note) => ({
        id: note.id,
        title:
            note.type === 'note'
                ? note.title || 'Untitled'
                : humanizeKey(note.dateKey ?? ''),
        type: note.type,
        dateKey: note.dateKey,
        folder: note.folder,
        snippet: note.content.trim().split('\n')[0]?.slice(0, 120) ?? '',
    }));
}

async function searchServer(
    cfg: WorkspaceConfig,
    needle: string,
): Promise<void> {
    try {
        const response = await apiFetch<{
            results: {
                id: string;
                title: string;
                type: string;
                date_key: string | null;
                folder: string;
                snippet: string;
            }[];
        }>(`/api/${cfg.teamSlug}/search?q=${encodeURIComponent(needle)}`);

        if (query.value.trim() !== needle) {
            return;
        }

        const seen = new Set(rows.value.map((row) => row.id));

        rows.value = [
            ...rows.value,
            ...response.results
                .filter((result) => !seen.has(result.id))
                .map((result) => ({
                    id: result.id,
                    title:
                        result.type === 'note'
                            ? result.title || 'Untitled'
                            : humanizeKey(result.date_key ?? ''),
                    type: result.type,
                    dateKey: result.date_key,
                    folder: result.folder,
                    snippet: result.snippet,
                })),
        ];
    } catch {
        // Offline or server error — local results are already shown.
    }
}

watch(query, (value) => {
    const needle = value.trim();
    rows.value = localRows(searchLocal(needle));
    highlighted.value = 0;

    if (serverTimer !== null) {
        clearTimeout(serverTimer);
    }

    if (needle !== '' && navigator.onLine) {
        const cfg = workspaceConfig();

        if (cfg) {
            serverTimer = setTimeout(() => void searchServer(cfg, needle), 200);
        }
    }
});

watch(searchOpen, (open) => {
    if (open) {
        query.value = '';
        rows.value = [];
        highlighted.value = 0;
    }
});

const showCreate = computed(() => query.value.trim() !== '');

function pick(row: ResultRow): void {
    emit('open-note', row.id);
    searchOpen.value = false;
}

async function createFromQuery(): Promise<void> {
    const note = await createNote({ title: query.value.trim() });
    emit('open-note', note.id);
    searchOpen.value = false;
}

function onKeydown(event: KeyboardEvent): void {
    const total = rows.value.length + (showCreate.value ? 1 : 0);

    if (event.key === 'ArrowDown') {
        highlighted.value = (highlighted.value + 1) % Math.max(total, 1);
        event.preventDefault();
    } else if (event.key === 'ArrowUp') {
        highlighted.value =
            (highlighted.value - 1 + Math.max(total, 1)) % Math.max(total, 1);
        event.preventDefault();
    } else if (event.key === 'Enter') {
        event.preventDefault();

        if (highlighted.value < rows.value.length) {
            const row = rows.value[highlighted.value];

            if (row) {
                pick(row);
            }
        } else if (showCreate.value) {
            void createFromQuery();
        }
    }
}
</script>

<template>
    <Dialog v-model:open="searchOpen">
        <DialogContent
            class="top-[20%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
        >
            <DialogTitle class="sr-only">Search notes</DialogTitle>

            <div class="flex items-center gap-2 border-b border-border/60 px-3">
                <Search class="size-4 shrink-0 text-muted-foreground" />
                <input
                    v-model="query"
                    class="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    placeholder="Search notes, or type a title to create one…"
                    autofocus
                    @keydown="onKeydown"
                />
            </div>

            <div class="max-h-80 overflow-y-auto p-1.5">
                <button
                    v-for="(row, index) in rows"
                    :key="row.id"
                    type="button"
                    :class="
                        cn(
                            'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left',
                            index === highlighted
                                ? 'bg-muted'
                                : 'hover:bg-muted/60',
                        )
                    "
                    @mouseenter="highlighted = index"
                    @click="pick(row)"
                >
                    <FileText
                        class="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                    <span class="min-w-0">
                        <span class="block truncate text-sm font-medium">{{
                            row.title
                        }}</span>
                        <span
                            class="block truncate text-xs text-muted-foreground"
                        >
                            <template v-if="row.folder"
                                >{{ row.folder }} · </template
                            >{{ row.snippet }}
                        </span>
                    </span>
                </button>

                <button
                    v-if="showCreate"
                    type="button"
                    :class="
                        cn(
                            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm',
                            highlighted === rows.length
                                ? 'bg-muted'
                                : 'hover:bg-muted/60',
                        )
                    "
                    @mouseenter="highlighted = rows.length"
                    @click="createFromQuery"
                >
                    <FilePlus class="size-4 shrink-0 text-primary" />
                    Create note “{{ query.trim() }}”
                </button>

                <p
                    v-if="rows.length === 0 && !showCreate"
                    class="px-2.5 py-6 text-center text-sm text-muted-foreground"
                >
                    Type to search your workspace.
                </p>
            </div>
        </DialogContent>
    </Dialog>
</template>
