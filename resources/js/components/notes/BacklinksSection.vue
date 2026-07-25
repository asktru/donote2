<script setup lang="ts">
import {
    Archive,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    FileText,
    Layers,
    ListTodo,
    Sparkles,
    Target,
} from '@lucide/vue';
import { computed, ref, watch } from 'vue';

import TaskTitle from '@/components/notes/TaskTitle.vue';
import { humanizeKey, keyStartDate } from '@/core/dates';
import type { NoteKind } from '@/core/frontmatter';
import { childrenOf } from '@/core/parser';
import type { ParsedLine } from '@/core/parser';
import { isTableRow, splitTableRow, tableAligns } from '@/lib/markdownTable';
import type { ColumnAlign } from '@/lib/markdownTable';
import { openNoteWindow } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { LocalNote } from '@/stores/db';
import { isSectionCollapsed, toggleSection } from '@/stores/uiSections';
import {
    backlinksTo,
    isArchivedNote,
    noteMetaFor,
    parsedNote,
} from '@/stores/workspace';

const props = defineProps<{
    noteId: string | null;
}>();

const emit = defineEmits<{
    'open-note': [id: string, line: number, split: boolean];
}>();

const TYPE_ICONS: Record<NoteKind, typeof FileText> = {
    project: Target,
    area: Layers,
    list: ListTodo,
    prompt: Sparkles,
};

/** One rendered row of a reference block: a normal line, or a table. */
type RenderItem =
    | { kind: 'line'; key: number; line: ParsedLine }
    | {
          kind: 'table';
          key: number;
          header: string[];
          rows: string[][];
          aligns: ColumnAlign[];
          /** Markdown indent of the table, so it nests like the text rows. */
          indent: number;
      };

/**
 * Group a block's parsed lines for display, folding a GFM pipe table (a row
 * followed by a `|---|` delimiter, plus its body rows) into a single table
 * item so it renders as a table rather than raw pipes.
 */
function buildRenderItems(lines: ParsedLine[]): RenderItem[] {
    const items: RenderItem[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const next = lines[i + 1];
        const aligns =
            next && isTableRow(line.raw) ? tableAligns(next.raw) : null;

        if (aligns !== null) {
            const rows: string[][] = [];
            let j = i + 2;

            while (
                j < lines.length &&
                isTableRow(lines[j].raw) &&
                tableAligns(lines[j].raw) === null
            ) {
                rows.push(splitTableRow(lines[j].raw));
                j += 1;
            }

            items.push({
                kind: 'table',
                key: line.index,
                header: splitTableRow(line.raw),
                rows,
                aligns,
                indent: line.indent,
            });
            i = j;

            continue;
        }

        items.push({ kind: 'line', key: line.index, line });
        i += 1;
    }

    return items;
}

interface ReferenceBlock {
    /** The line containing the wiki link plus its full nested subtree. */
    lines: ParsedLine[];
    items: RenderItem[];
    anchor: number;
    baseIndent: number;
}

interface ReferenceGroup {
    note: LocalNote;
    icon: typeof FileText;
    label: string;
    blocks: ReferenceBlock[];
}

/**
 * Unlike the task/reminder views, references INCLUDE archived notes by
 * default — a meeting series lives on in @Archive and its backlinks are
 * the whole point. A single global preference can hide them.
 */
const ARCHIVE_PREF_KEY = 'donote:backlinks-include-archive';

function readArchivePref(): boolean {
    try {
        return localStorage.getItem(ARCHIVE_PREF_KEY) !== '0';
    } catch {
        return true;
    }
}

const includeArchive = ref(readArchivePref());

/**
 * Reference click: Cmd opens the note in a new shell window, Opt in a
 * split, a plain click navigates the current pane.
 */
function onReferenceClick(event: MouseEvent, id: string, line: number): void {
    if (event.metaKey && openNoteWindow(id)) {
        return;
    }

    emit('open-note', id, line, event.altKey);
}

function toggleArchivePref(): void {
    includeArchive.value = !includeArchive.value;

    try {
        localStorage.setItem(
            ARCHIVE_PREF_KEY,
            includeArchive.value ? '1' : '0',
        );
    } catch {
        // Preference just won't survive the session.
    }
}

const allGroups = computed<ReferenceGroup[]>(() => {
    if (props.noteId === null) {
        return [];
    }

    return backlinksTo(props.noteId).map(({ note, lines }) => {
        const allLines = parsedNote(note.id);
        const meta = noteMetaFor(note.id);

        return {
            note,
            icon: meta.type !== null ? TYPE_ICONS[meta.type] : FileText,
            label:
                note.type !== 'note' && note.dateKey !== null
                    ? humanizeKey(note.dateKey)
                    : note.title || 'Untitled',
            blocks: lines.map((line) => {
                const blockLines = [line, ...childrenOf(allLines, line.index)];

                return {
                    lines: blockLines,
                    items: buildRenderItems(blockLines),
                    anchor: line.index,
                    baseIndent: line.indent,
                };
            }),
        };
    });
});

/**
 * Chronological anchor for newest-first ordering: a calendar note sorts by
 * the date it represents; a regular note by its last-changed time. Both
 * resolve to an absolute millisecond value so the two kinds interleave.
 */
function recencyOf(note: LocalNote): number {
    if (note.type !== 'note' && note.dateKey !== null) {
        return keyStartDate(note.dateKey).getTime();
    }

    return new Date(note.updatedAt).getTime();
}

const groups = computed<ReferenceGroup[]>(() => {
    const filtered = includeArchive.value
        ? allGroups.value
        : allGroups.value.filter((group) => !isArchivedNote(group.note));

    return [...filtered].sort((a, b) => recencyOf(b.note) - recencyOf(a.note));
});

/** Whether any reference comes from @Archive — drives the toggle. */
const hasArchived = computed(() =>
    allGroups.value.some((group) => isArchivedNote(group.note)),
);

const total = computed(() =>
    groups.value.reduce((sum, group) => sum + group.blocks.length, 0),
);

/* ------------------------------------------------------------------ */
/* Per-reference collapsing                                            */
/* ------------------------------------------------------------------ */

/**
 * Collapsed reference blocks, keyed by source note + anchor line. A collapsed
 * block shows just the linking line, hiding its nested context — handy when a
 * note is referenced from long task subtrees. Session state: reset when the
 * viewed note changes.
 */
const collapsedBlocks = ref<Set<string>>(new Set());

function blockKey(noteId: string, anchor: number): string {
    return `${noteId}:${anchor}`;
}

function isBlockCollapsed(noteId: string, anchor: number): boolean {
    return collapsedBlocks.value.has(blockKey(noteId, anchor));
}

function toggleBlock(noteId: string, anchor: number): void {
    const key = blockKey(noteId, anchor);
    const next = new Set(collapsedBlocks.value);

    if (next.has(key)) {
        next.delete(key);
    } else {
        next.add(key);
    }

    collapsedBlocks.value = next;
}

/** Only blocks with nested context below the linking line can collapse. */
const collapsibleKeys = computed<string[]>(() =>
    groups.value.flatMap((group) =>
        group.blocks
            .filter((block) => block.items.length > 1)
            .map((block) => blockKey(group.note.id, block.anchor)),
    ),
);

const allCollapsed = computed<boolean>(
    () =>
        collapsibleKeys.value.length > 0 &&
        collapsibleKeys.value.every((key) => collapsedBlocks.value.has(key)),
);

function toggleAll(): void {
    collapsedBlocks.value = allCollapsed.value
        ? new Set()
        : new Set(collapsibleKeys.value);
}

/** Collapsed blocks render their first row (the linking line) only. */
function visibleItems(block: ReferenceBlock, collapsed: boolean): RenderItem[] {
    return collapsed ? block.items.slice(0, 1) : block.items;
}

watch(
    () => props.noteId,
    () => {
        collapsedBlocks.value = new Set();
    },
);

/** Leading glyph mirroring the editor's task/checklist/bullet rendering. */
function glyph(line: ParsedLine): string {
    if (line.kind === 'task' || line.kind === 'checklist') {
        switch (line.state) {
            case 'done':
                return '✓';
            case 'cancelled':
                return '✕';
            case 'scheduled':
                return '›';
            default:
                return line.kind === 'task' ? '○' : '□';
        }
    }

    if (line.kind === 'bullet') {
        return '•';
    }

    return '';
}

/** Width of the leading glyph column: w-3.5 (14px) + mr-1.5 (6px). */
const GLYPH_WIDTH_PX = 20;

/**
 * Nesting indent plus a hanging indent, so a wrapped bullet/task continues
 * under its own text instead of falling back to the far-left edge (the editor
 * aligns wrapped lines the same way). Rows without a glyph — headings, plain
 * paragraphs — just get the nesting indent.
 */
function lineStyle(
    line: ParsedLine,
    baseIndent: number,
): Record<string, string> {
    const depth = Math.max(0, line.indent - baseIndent) * 6;
    const hanging = glyph(line) === '' ? 0 : GLYPH_WIDTH_PX;

    return {
        paddingLeft: `${depth + hanging}px`,
        textIndent: `${-hanging}px`,
    };
}

/**
 * Reader-friendly text: leading markers stripped. Inline markdown (bold,
 * wiki links, tags, …) is left in place — TaskTitle renders it styled.
 */
function displayText(line: ParsedLine): string {
    let text = line.raw.trim();

    text = text.replace(/^[-*+]\s\[[ xX>-]\]\s/, '');
    text = text.replace(/^[-*+]\s/, '');
    text = text.replace(/^#{1,6}\s/, '');

    return text;
}
</script>

<template>
    <section
        v-if="total > 0 || hasArchived"
        class="mt-8 border-t border-border/60 bg-muted/10"
    >
        <div class="flex items-center">
            <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 px-4 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
                @click="toggleSection('reference')"
            >
                <ChevronRight
                    :class="
                        cn(
                            'size-3 transition-transform',
                            !isSectionCollapsed('reference') && 'rotate-90',
                        )
                    "
                />
                {{ total }} Reference{{ total === 1 ? '' : 's' }}
            </button>
            <button
                v-if="
                    !isSectionCollapsed('reference') &&
                    collapsibleKeys.length > 0
                "
                type="button"
                class="mr-3 flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground/70 hover:text-foreground"
                :title="
                    allCollapsed
                        ? 'Expand all references'
                        : 'Collapse all references'
                "
                @click="toggleAll"
            >
                <component
                    :is="allCollapsed ? ChevronsUpDown : ChevronsDownUp"
                    class="size-3"
                />
                {{ allCollapsed ? 'Expand all' : 'Collapse all' }}
            </button>
            <button
                v-if="hasArchived"
                type="button"
                :class="
                    cn(
                        'mr-4 flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11px]',
                        includeArchive
                            ? 'text-foreground'
                            : 'text-muted-foreground/70 hover:text-foreground',
                    )
                "
                :title="
                    includeArchive
                        ? 'Hide references from the archive'
                        : 'Show references from the archive'
                "
                @click="toggleArchivePref"
            >
                <Archive class="size-3" />
                {{ includeArchive ? 'Archive shown' : 'Archive hidden' }}
            </button>
        </div>

        <div
            v-if="!isSectionCollapsed('reference')"
            class="space-y-4 px-4 pb-4"
        >
            <div v-for="group in groups" :key="group.note.id">
                <button
                    type="button"
                    class="mb-1 flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                    @click="
                        (event) => onReferenceClick(event, group.note.id, 0)
                    "
                >
                    <component
                        :is="group.icon"
                        class="size-3.5 text-muted-foreground"
                    />
                    {{ group.label }}
                </button>

                <div
                    v-for="block in group.blocks"
                    :key="block.anchor"
                    class="mb-1.5 flex w-full items-start gap-1 rounded-md border-l-2 border-primary/30 bg-background/60 py-1.5 pr-3 pl-1 hover:border-primary/70 hover:bg-muted/50"
                >
                    <!-- Sibling of the open-note button, not nested inside it,
                         so collapsing never navigates. -->
                    <button
                        v-if="block.items.length > 1"
                        type="button"
                        class="mt-1 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                        :title="
                            isBlockCollapsed(group.note.id, block.anchor)
                                ? 'Expand this reference'
                                : 'Collapse this reference'
                        "
                        @click="toggleBlock(group.note.id, block.anchor)"
                    >
                        <ChevronRight
                            :class="
                                cn(
                                    'size-3 transition-transform',
                                    !isBlockCollapsed(
                                        group.note.id,
                                        block.anchor,
                                    ) && 'rotate-90',
                                )
                            "
                        />
                    </button>
                    <span v-else class="mt-1 size-4 shrink-0" />

                    <button
                        type="button"
                        class="min-w-0 flex-1 text-left"
                        @click="
                            (event) =>
                                onReferenceClick(
                                    event,
                                    group.note.id,
                                    block.anchor,
                                )
                        "
                    >
                        <template
                            v-for="item in visibleItems(
                                block,
                                isBlockCollapsed(group.note.id, block.anchor),
                            )"
                            :key="item.key"
                        >
                            <table
                                v-if="item.kind === 'table'"
                                class="reference-table my-1 border-collapse text-sm"
                                :style="{
                                    marginLeft: `${Math.max(0, item.indent - block.baseIndent) * 6}px`,
                                }"
                            >
                                <thead>
                                    <tr>
                                        <th
                                            v-for="(cell, i) in item.header"
                                            :key="i"
                                            :style="{
                                                textAlign:
                                                    item.aligns[i] ?? undefined,
                                            }"
                                        >
                                            <TaskTitle :text="cell" />
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="(row, r) in item.rows" :key="r">
                                        <td
                                            v-for="(cell, i) in item.header"
                                            :key="i"
                                            :style="{
                                                textAlign:
                                                    item.aligns[i] ?? undefined,
                                            }"
                                        >
                                            <TaskTitle :text="row[i] ?? ''" />
                                        </td>
                                    </tr>
                                </tbody>
                            </table>

                            <p
                                v-else
                                :class="
                                    cn(
                                        'text-sm leading-6',
                                        item.line.state === 'done' &&
                                            'text-muted-foreground line-through',
                                        item.line.state === 'cancelled' &&
                                            'text-muted-foreground/70 line-through',
                                        item.line.kind === 'heading' &&
                                            'font-semibold',
                                    )
                                "
                                :style="lineStyle(item.line, block.baseIndent)"
                            >
                                <span
                                    v-if="glyph(item.line)"
                                    :class="
                                        cn(
                                            'mr-1.5 inline-block w-3.5 text-center',
                                            item.line.state === 'done'
                                                ? 'text-primary'
                                                : 'text-muted-foreground',
                                        )
                                    "
                                    >{{ glyph(item.line) }}</span
                                ><TaskTitle :text="displayText(item.line)" />
                            </p>
                        </template>

                        <p
                            v-if="isBlockCollapsed(group.note.id, block.anchor)"
                            class="mt-0.5 text-xs text-muted-foreground/70"
                        >
                            +{{ block.items.length - 1 }} more
                        </p>
                    </button>
                </div>
            </div>
        </div>
    </section>
</template>

<style scoped>
.reference-table th,
.reference-table td {
    border: 1px solid var(--border);
    padding: 2px 8px;
    text-align: left;
    vertical-align: top;
}

.reference-table th {
    font-weight: 600;
    background-color: color-mix(in oklab, var(--muted) 55%, transparent);
}

.reference-table tbody tr:nth-child(even) {
    background-color: color-mix(in oklab, var(--muted) 22%, transparent);
}
</style>
