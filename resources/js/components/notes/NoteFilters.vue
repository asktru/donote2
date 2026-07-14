<script setup lang="ts">
import { AtSign, Hash } from '@lucide/vue';
import { computed, reactive, watch } from 'vue';

import TaskTitle from '@/components/notes/TaskTitle.vue';
import type { ParsedLine } from '@/core/parser';
import { priorityColor } from '@/core/priority';
import { cn } from '@/lib/utils';
import { parsedNote, toggleTaskLine } from '@/stores/workspace';

const props = defineProps<{
    noteId: string;
    readOnly?: boolean;
}>();

const emit = defineEmits<{
    'update:active': [active: boolean];
    'open-line': [line: number];
}>();

const filters = reactive({
    incomplete: false,
    priority: false,
    checklists: false,
    tag: null as string | null,
    mention: null as string | null,
});

const active = computed<boolean>(
    () =>
        filters.incomplete ||
        filters.priority ||
        filters.checklists ||
        filters.tag !== null ||
        filters.mention !== null,
);

watch(active, (value) => emit('update:active', value), { immediate: true });

const lines = computed<ParsedLine[]>(() => parsedNote(props.noteId));

/** Nested match: filtering by `q3` also matches `q3/okrs`. */
function matchesPrefix(values: string[], prefix: string): boolean {
    return values.some(
        (value) => value === prefix || value.startsWith(`${prefix}/`),
    );
}

const noteTags = computed<string[]>(() => {
    const set = new Set<string>();

    for (const line of lines.value) {
        if (line.kind === 'task' || line.kind === 'checklist') {
            line.tags.forEach((tag) => set.add(tag));
        }
    }

    return [...set].sort();
});

const noteMentions = computed<string[]>(() => {
    const set = new Set<string>();

    for (const line of lines.value) {
        if (line.kind === 'task' || line.kind === 'checklist') {
            line.mentions.forEach((mention) => set.add(mention));
        }
    }

    return [...set].sort();
});

const matched = computed<ParsedLine[]>(() =>
    lines.value.filter((line) => {
        const isTask = line.kind === 'task';
        const isChecklist = line.kind === 'checklist';

        if (!isTask && !isChecklist) {
            return false;
        }

        // Checklists only appear when explicitly included.
        if (isChecklist && !filters.checklists) {
            return false;
        }

        if (filters.incomplete && line.state !== 'open') {
            return false;
        }

        if (filters.priority && line.priority <= 0) {
            return false;
        }

        if (filters.tag !== null && !matchesPrefix(line.tags, filters.tag)) {
            return false;
        }

        if (
            filters.mention !== null &&
            !matchesPrefix(line.mentions, filters.mention)
        ) {
            return false;
        }

        return true;
    }),
);

function toggleTag(tag: string): void {
    filters.tag = filters.tag === tag ? null : tag;
}

function toggleMention(mention: string): void {
    filters.mention = filters.mention === mention ? null : mention;
}

function openLine(index: number): void {
    filters.incomplete = false;
    filters.priority = false;
    filters.checklists = false;
    filters.tag = null;
    filters.mention = null;
    emit('open-line', index);
}

const chipClass = (on: boolean): string =>
    cn(
        'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
        on
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border/70 text-muted-foreground hover:bg-muted/60',
    );
</script>

<template>
    <div>
        <div class="flex flex-wrap items-center gap-1.5 py-1">
            <button
                type="button"
                :class="chipClass(filters.incomplete)"
                @click="filters.incomplete = !filters.incomplete"
            >
                Incomplete
            </button>
            <button
                type="button"
                :class="chipClass(filters.priority)"
                @click="filters.priority = !filters.priority"
            >
                Priority
            </button>
            <button
                type="button"
                :class="chipClass(filters.checklists)"
                @click="filters.checklists = !filters.checklists"
            >
                + Checklists
            </button>
            <button
                v-for="tag in noteTags"
                :key="`tag-${tag}`"
                type="button"
                :class="chipClass(filters.tag === tag)"
                @click="toggleTag(tag)"
            >
                <Hash class="mr-0.5 inline size-3" />{{ tag }}
            </button>
            <button
                v-for="mention in noteMentions"
                :key="`mention-${mention}`"
                type="button"
                :class="chipClass(filters.mention === mention)"
                @click="toggleMention(mention)"
            >
                <AtSign class="mr-0.5 inline size-3" />{{ mention }}
            </button>
        </div>

        <div v-if="active" class="mt-1 space-y-0.5 pb-4">
            <p
                v-if="matched.length === 0"
                class="px-1 py-2 text-sm text-muted-foreground"
            >
                No matching tasks.
            </p>
            <div
                v-for="line in matched"
                :key="line.index"
                class="group flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60"
            >
                <button
                    type="button"
                    :disabled="readOnly"
                    :class="
                        cn(
                            'mt-1 size-3.5 shrink-0 rounded-full border-2 transition-colors disabled:opacity-50',
                            line.state !== 'open'
                                ? 'border-primary bg-primary'
                                : line.priority > 0
                                  ? 'hover:bg-current/20'
                                  : 'border-muted-foreground/50 hover:bg-muted-foreground/20',
                        )
                    "
                    :style="
                        line.state === 'open' && priorityColor(line.priority)
                            ? {
                                  borderColor: priorityColor(line.priority)!,
                                  color: priorityColor(line.priority)!,
                              }
                            : {}
                    "
                    :title="line.state === 'open' ? 'Complete' : 'Reopen'"
                    aria-label="Toggle task"
                    @click="toggleTaskLine(noteId, line.index)"
                />
                <button
                    type="button"
                    class="min-w-0 flex-1 text-left"
                    @click="openLine(line.index)"
                >
                    <p
                        :class="
                            cn(
                                'truncate text-sm',
                                line.state !== 'open' &&
                                    'text-muted-foreground line-through',
                            )
                        "
                    >
                        <span
                            v-if="line.priority > 0"
                            class="mr-1 font-bold"
                            :style="{ color: priorityColor(line.priority)! }"
                            >{{ '!'.repeat(line.priority) }}</span
                        >
                        <TaskTitle :text="line.title" />
                    </p>
                </button>
            </div>
        </div>
    </div>
</template>
