<script setup lang="ts">
import { ChevronRight, FileText, Layers, ListTodo, Sparkles, Target } from '@lucide/vue';
import { computed, ref } from 'vue';

import { humanizeKey } from '@/core/dates';
import type { NoteKind } from '@/core/frontmatter';
import { childrenOf } from '@/core/parser';
import type { ParsedLine } from '@/core/parser';
import { cn } from '@/lib/utils';
import type { LocalNote } from '@/stores/db';
import { backlinksTo, noteMetaFor, parsedNote } from '@/stores/workspace';

const props = defineProps<{
    noteId: string | null;
}>();

const emit = defineEmits<{
    'open-note': [id: string, line: number];
}>();

const expanded = ref(true);

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

const groups = computed<ReferenceGroup[]>(() => {
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

/** Reader-friendly text: markers stripped, wiki links shown by display name. */
function displayText(line: ParsedLine): string {
    let text = line.raw.trim();

    text = text.replace(/^[-*+]\s\[[ xX>-]\]\s/, '');
    text = text.replace(/^[-*+]\s/, '');
    text = text.replace(/^#{1,6}\s/, '');
    text = text.replace(
        /\[\[([^\]|\n]+?)(?:\s*\|\s*([^\]\n]*?))?\]\]/g,
        (_match, target: string, display?: string) =>
            (display ?? '').trim() || target.trim(),
    );

    return text;
}
</script>

<template>
    <section
        v-if="total > 0"
        class="max-h-[45%] shrink-0 overflow-y-auto border-t border-border/60 bg-muted/10"
    >
        <button
            type="button"
            class="flex w-full items-center gap-1.5 px-4 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
            @click="expanded = !expanded"
        >
            <ChevronRight
                :class="
                    cn('size-3 transition-transform', expanded && 'rotate-90')
                "
            />
            {{ total }} Reference{{ total === 1 ? '' : 's' }}
        </button>

        <div v-if="expanded" class="space-y-4 px-4 pb-4">
            <div v-for="group in groups" :key="group.note.id">
                <button
                    type="button"
                    class="mb-1 flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                    @click="emit('open-note', group.note.id, 0)"
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
                    @click="emit('open-note', group.note.id, block.anchor)"
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
                        >{{ displayText(line) }}
                    </p>
                </button>
            </div>
        </div>
    </section>
</template>
