<script setup lang="ts">
import {
    AtSign,
    CalendarDays,
    FileOutput,
    FilePlus,
    FileText,
    Hash,
    History,
    Search,
} from '@lucide/vue';
import { computed, ref, watch } from 'vue';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { humanizeKey } from '@/core/dates';
import { parseNaturalDate } from '@/core/parseNaturalDate';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { LocalNote } from '@/stores/db';
import { cancelMove, completeMoveToNote, pendingMove } from '@/stores/move';
import { openMentionView, openTagView, searchOpen } from '@/stores/ui';
import {
    allMentions,
    allTags,
    createNote,
    findCalendarNote,
    getNote,
    recentVisits,
    searchLocal,
    workspaceConfig,
} from '@/stores/workspace';
import type { WorkspaceConfig } from '@/stores/workspace';

const emit = defineEmits<{
    'open-note': [id: string];
    'open-calendar': [dateKey: string];
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
    } else if (pendingMove.value) {
        // Dismissed (Esc / overlay) while picking a move destination.
        cancelMove();
    }
});

/** Recently visited notes/periods, shown while the query is empty. */
const historyRows = computed<ResultRow[]>(() => {
    const seen = new Set<string>();
    const result: ResultRow[] = [];

    for (const visit of recentVisits.value) {
        if (visit.kind === 'note') {
            const note = getNote(visit.id);

            if (!note || note.deleted === 1 || seen.has(note.id)) {
                continue;
            }

            seen.add(note.id);
            result.push(...localRows([note]));
        } else {
            const key = `${visit.calKind}:${visit.dateKey}`;

            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            const note = findCalendarNote(visit.calKind, visit.dateKey);
            result.push({
                id: note?.id ?? key,
                title: humanizeKey(visit.dateKey),
                type: visit.calKind,
                dateKey: visit.dateKey,
                folder: '',
                snippet:
                    note?.content.trim().split('\n')[0]?.slice(0, 120) ?? '',
            });
        }

        if (result.length >= 15) {
            break;
        }
    }

    return result;
});

const showingHistory = computed(() => query.value.trim() === '');

const displayRows = computed<ResultRow[]>(() =>
    showingHistory.value ? historyRows.value : rows.value,
);

/**
 * Direct jumps for the query: a calendar period (natural language or a
 * date key — "tomorrow", "aug 12", "2026-W30", "q4"), and matching tags/
 * mentions. Prefixing with # or @ narrows to that token kind.
 */
type JumpRow =
    | { kind: 'period'; dateKey: string; label: string }
    | { kind: 'tag'; token: string }
    | { kind: 'mention'; token: string };

const jumpRows = computed<JumpRow[]>(() => {
    const needle = query.value.trim();

    if (needle === '' || pendingMove.value) {
        return [];
    }

    const jumps: JumpRow[] = [];
    const dateKey = parseNaturalDate(needle);

    if (dateKey !== null) {
        jumps.push({
            kind: 'period',
            dateKey,
            label: humanizeKey(dateKey),
        });
    }

    const token = needle.replace(/^[#@]/, '').toLowerCase();

    if (token !== '') {
        if (!needle.startsWith('@')) {
            for (const tag of allTags.value) {
                if (tag.toLowerCase().includes(token)) {
                    jumps.push({ kind: 'tag', token: tag });
                }

                if (jumps.length >= 7) {
                    break;
                }
            }
        }

        if (!needle.startsWith('#')) {
            for (const mention of allMentions.value) {
                if (mention.toLowerCase().includes(token)) {
                    jumps.push({ kind: 'mention', token: mention });
                }

                if (jumps.length >= 7) {
                    break;
                }
            }
        }
    }

    return jumps.slice(0, 7);
});

function pickJump(row: JumpRow): void {
    if (row.kind === 'period') {
        emit('open-calendar', row.dateKey);
    } else if (row.kind === 'tag') {
        openTagView(row.token);
    } else {
        openMentionView(row.token);
    }

    searchOpen.value = false;
}

const showCreate = computed(() => query.value.trim() !== '');

function pick(row: ResultRow): void {
    // Picker mode: land the pending move in the chosen note instead of
    // navigating to it.
    if (pendingMove.value) {
        void completeMoveToNote(row.id);

        return;
    }

    if (row.type !== 'note' && row.dateKey !== null) {
        emit('open-calendar', row.dateKey);
    } else {
        emit('open-note', row.id);
    }

    searchOpen.value = false;
}

async function createFromQuery(): Promise<void> {
    const note = await createNote({ title: query.value.trim() });

    if (pendingMove.value) {
        void completeMoveToNote(note.id);

        return;
    }

    emit('open-note', note.id);
    searchOpen.value = false;
}

function onKeydown(event: KeyboardEvent): void {
    const jumps = jumpRows.value.length;
    const total =
        jumps + displayRows.value.length + (showCreate.value ? 1 : 0);

    if (event.key === 'ArrowDown') {
        highlighted.value = (highlighted.value + 1) % Math.max(total, 1);
        event.preventDefault();
    } else if (event.key === 'ArrowUp') {
        highlighted.value =
            (highlighted.value - 1 + Math.max(total, 1)) % Math.max(total, 1);
        event.preventDefault();
    } else if (event.key === 'Enter') {
        event.preventDefault();

        if (highlighted.value < jumps) {
            pickJump(jumpRows.value[highlighted.value]);
        } else if (highlighted.value - jumps < displayRows.value.length) {
            const row = displayRows.value[highlighted.value - jumps];

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

            <div
                v-if="pendingMove"
                class="flex items-center gap-2 border-b border-border/60 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary"
            >
                <FileOutput class="size-3.5 shrink-0" />
                Move {{ pendingMove.lineCount }} line{{
                    pendingMove.lineCount === 1 ? '' : 's'
                }}
                to…
            </div>

            <div class="flex items-center gap-2 border-b border-border/60 px-3">
                <Search class="size-4 shrink-0 text-muted-foreground" />
                <input
                    v-model="query"
                    class="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    :placeholder="
                        pendingMove
                            ? 'Pick or create a note to move into…'
                            : 'Search notes, or type a title to create one…'
                    "
                    autofocus
                    @keydown="onKeydown"
                />
            </div>

            <div class="max-h-80 overflow-y-auto p-1.5">
                <button
                    v-for="(jump, index) in jumpRows"
                    :key="`jump:${jump.kind}:${'dateKey' in jump ? jump.dateKey : jump.token}`"
                    type="button"
                    :class="
                        cn(
                            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm',
                            index === highlighted
                                ? 'bg-muted'
                                : 'hover:bg-muted/60',
                        )
                    "
                    @mouseenter="highlighted = index"
                    @click="pickJump(jump)"
                >
                    <CalendarDays
                        v-if="jump.kind === 'period'"
                        class="size-4 shrink-0 text-primary"
                    />
                    <Hash
                        v-else-if="jump.kind === 'tag'"
                        class="size-4 shrink-0 text-[var(--token-tag)]"
                    />
                    <AtSign
                        v-else
                        class="size-4 shrink-0 text-[var(--token-mention)]"
                    />
                    <span class="truncate font-medium">
                        {{ jump.kind === 'period' ? jump.label : jump.token }}
                    </span>
                    <span class="ml-auto text-xs text-muted-foreground">
                        {{
                            jump.kind === 'period'
                                ? 'Open period'
                                : jump.kind === 'tag'
                                  ? 'Tag'
                                  : 'Mention'
                        }}
                    </span>
                </button>

                <p
                    v-if="showingHistory && displayRows.length > 0"
                    class="flex items-center gap-1.5 px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                >
                    <History class="size-3" /> Recently opened
                </p>
                <button
                    v-for="(row, index) in displayRows"
                    :key="row.id"
                    type="button"
                    :class="
                        cn(
                            'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left',
                            jumpRows.length + index === highlighted
                                ? 'bg-muted'
                                : 'hover:bg-muted/60',
                        )
                    "
                    @mouseenter="highlighted = jumpRows.length + index"
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
                            highlighted === jumpRows.length + displayRows.length
                                ? 'bg-muted'
                                : 'hover:bg-muted/60',
                        )
                    "
                    @mouseenter="highlighted = jumpRows.length + displayRows.length"
                    @click="createFromQuery"
                >
                    <FilePlus class="size-4 shrink-0 text-primary" />
                    Create note “{{ query.trim() }}”
                </button>

                <p
                    v-if="displayRows.length === 0 && !showCreate"
                    class="px-2.5 py-6 text-center text-sm text-muted-foreground"
                >
                    Type to search your workspace.
                </p>
            </div>
        </DialogContent>
    </Dialog>
</template>
