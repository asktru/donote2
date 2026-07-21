<script setup lang="ts">
import {
    Archive,
    ChevronRight,
    FileText,
    Layers,
    ListTodo,
    Sparkles,
    Target,
} from '@lucide/vue';
import { computed, ref } from 'vue';

import TaskTitle from '@/components/notes/TaskTitle.vue';
import { humanizeKey, keyStartDate } from '@/core/dates';
import type { NoteKind } from '@/core/frontmatter';
import { childrenOf } from '@/core/parser';
import type { ParsedLine } from '@/core/parser';
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

interface ReferenceBlock {
    /** The line containing the wiki link plus its full nested subtree. */
    lines: ParsedLine[];
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
function onReferenceClick(
    event: MouseEvent,
    id: string,
    line: number,
): void {
    if (event.metaKey && openNoteWindow(id)) {
        return;
    }

    emit('open-note', id, line, event.altKey);
}

function toggleArchivePref(): void {
    includeArchive.value = !includeArchive.value;

    try {
        localStorage.setItem(ARCHIVE_PREF_KEY, includeArchive.value ? '1' : '0');
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
            blocks: lines.map((line) => ({
                lines: [line, ...childrenOf(allLines, line.index)],
                anchor: line.index,
                baseIndent: line.indent,
            })),
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

    return [...filtered].sort(
        (a, b) => recencyOf(b.note) - recencyOf(a.note),
    );
});

/** Whether any reference comes from @Archive — drives the toggle. */
const hasArchived = computed(() =>
    allGroups.value.some((group) => isArchivedNote(group.note)),
);

const total = computed(() =>
    groups.value.reduce((sum, group) => sum + group.blocks.length, 0),
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

        <div v-if="!isSectionCollapsed('reference')" class="space-y-4 px-4 pb-4">
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

                <button
                    v-for="block in group.blocks"
                    :key="block.anchor"
                    type="button"
                    class="mb-1.5 block w-full rounded-md border-l-2 border-primary/30 bg-background/60 py-1.5 pr-3 pl-3 text-left hover:border-primary/70 hover:bg-muted/50"
                    @click="
                        (event) =>
                            onReferenceClick(event, group.note.id, block.anchor)
                    "
                >
                    <p
                        v-for="line in block.lines"
                        :key="line.index"
                        :class="
                            cn(
                                'text-sm leading-6',
                                line.state === 'done' &&
                                    'text-muted-foreground line-through',
                                line.state === 'cancelled' &&
                                    'text-muted-foreground/70 line-through',
                                line.kind === 'heading' && 'font-semibold',
                            )
                        "
                        :style="{
                            paddingLeft: `${Math.max(0, line.indent - block.baseIndent) * 6}px`,
                        }"
                    >
                        <span
                            v-if="glyph(line)"
                            :class="
                                cn(
                                    'mr-1.5 inline-block w-3.5 text-center',
                                    line.state === 'done'
                                        ? 'text-primary'
                                        : 'text-muted-foreground',
                                )
                            "
                            >{{ glyph(line) }}</span
                        ><TaskTitle :text="displayText(line)" />
                    </p>
                </button>
            </div>
        </div>
    </section>
</template>
