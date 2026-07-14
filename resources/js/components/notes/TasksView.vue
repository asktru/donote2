<script setup lang="ts">
import { AtSign, CalendarClock, Flag, Hash, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import MobileSidebarButton from '@/components/notes/MobileSidebarButton.vue';
import TaskTitle from '@/components/notes/TaskTitle.vue';

import { Button } from '@/components/ui/button';
import {
    humanizeKey,
    keyRange,
    keyStartDate,
    todayDailyKey,
    todayKey,
} from '@/core/dates';
import { priorityColor } from '@/core/priority';
import { cn } from '@/lib/utils';
import { toggleTaskLine, workspaceTasks, taskDayKey } from '@/stores/workspace';
import type { WorkspaceTask } from '@/stores/workspace';

/**
 * Inline style for a task's checkbox, matching the editor: an open task
 * takes its priority colour on the border with a faint tint; a done task
 * fills with that colour (or the theme primary when it has no priority).
 * Returns {} so the base Tailwind classes apply unchanged.
 */
function checkboxStyle(task: WorkspaceTask): Record<string, string> {
    const color = priorityColor(task.line.priority);

    if (task.line.state === 'done') {
        return color
            ? { backgroundColor: color, borderColor: color, color: '#fff' }
            : {};
    }

    if (task.line.state === 'open' && color) {
        return {
            borderColor: color,
            backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
        };
    }

    return {};
}

const props = defineProps<{
    filterTag?: string;
    filterMention?: string;
    isSplit?: boolean;
}>();

const emit = defineEmits<{
    'open-note': [noteId: string, line: number];
    close: [];
}>();

const includeChecklists = ref(false);
const showCompleted = ref(false);
const priorityOnly = ref(false);
const selectedTag = ref<string | null>(props.filterTag ?? null);
const selectedMention = ref<string | null>(props.filterMention ?? null);

interface TaskGroup {
    label: string;
    tasks: WorkspaceTask[];
}

/** Nested match: filtering by `q3` also matches `q3/okrs`. */
function matchesPrefix(values: string[], filter: string): boolean {
    return values.some(
        (value) => value === filter || value.startsWith(`${filter}/`),
    );
}

const filtered = computed<WorkspaceTask[]>(() =>
    workspaceTasks.value.filter((task) => {
        if (
            task.line.kind === 'checklist' &&
            !includeChecklists.value &&
            !selectedTag.value &&
            !selectedMention.value
        ) {
            return false;
        }

        if (!showCompleted.value && task.line.state !== 'open') {
            return false;
        }

        if (priorityOnly.value && task.line.priority === 0) {
            return false;
        }

        if (
            selectedTag.value !== null &&
            !matchesPrefix(task.line.tags, selectedTag.value)
        ) {
            return false;
        }

        if (
            selectedMention.value !== null &&
            !matchesPrefix(task.line.mentions, selectedMention.value)
        ) {
            return false;
        }

        return true;
    }),
);

const availableTags = computed(() => {
    const tags = new Set<string>();

    for (const task of workspaceTasks.value) {
        for (const tag of task.line.tags) {
            tags.add(tag);
        }
    }

    return [...tags].sort();
});

function sortTasks(tasks: WorkspaceTask[]): WorkspaceTask[] {
    return [...tasks].sort((a, b) => {
        const dayA = taskDayKey(a);
        const dayB = taskDayKey(b);
        const timeA = dayA !== null ? keyStartDate(dayA).getTime() : Infinity;
        const timeB = dayB !== null ? keyStartDate(dayB).getTime() : Infinity;

        return b.line.priority - a.line.priority || timeA - timeB;
    });
}

const groups = computed<TaskGroup[]>(() => {
    const now = keyStartDate(todayDailyKey()).getTime();
    const thisWeekEnd = keyRange(todayKey('weekly')).end.getTime();

    const overdue: WorkspaceTask[] = [];
    const today: WorkspaceTask[] = [];
    const week: WorkspaceTask[] = [];
    const later: WorkspaceTask[] = [];
    const someday: WorkspaceTask[] = [];

    for (const task of filtered.value) {
        const day = taskDayKey(task);

        if (day === null) {
            someday.push(task);
            continue;
        }

        const range = keyRange(day);

        if (range.end.getTime() <= now) {
            overdue.push(task);
        } else if (range.start.getTime() <= now && now < range.end.getTime()) {
            today.push(task);
        } else if (range.start.getTime() < thisWeekEnd) {
            week.push(task);
        } else {
            later.push(task);
        }
    }

    return [
        { label: 'Overdue', tasks: sortTasks(overdue) },
        { label: 'Today', tasks: sortTasks(today) },
        { label: 'This week', tasks: sortTasks(week) },
        { label: 'Later', tasks: sortTasks(later) },
        { label: 'No date', tasks: sortTasks(someday) },
    ].filter((group) => group.tasks.length > 0);
});

function noteLabel(task: WorkspaceTask): string {
    if (task.note.type !== 'note' && task.note.dateKey !== null) {
        return humanizeKey(task.note.dateKey);
    }

    return task.note.title || 'Untitled';
}

function dueLabel(task: WorkspaceTask): string | null {
    if (task.line.due === null) {
        return null;
    }

    const overdue =
        keyStartDate(task.line.due).getTime() <
        keyStartDate(todayDailyKey()).getTime();

    return overdue ? `due ${task.line.due} ⚠️` : `due ${task.line.due}`;
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <header
            class="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4"
        >
            <MobileSidebarButton v-if="!isSplit" />
            <h1 class="text-base font-semibold">
                <template v-if="filterTag">#{{ filterTag }}</template>
                <template v-else-if="filterMention"
                    >@{{ filterMention }}</template
                >
                <template v-else>Tasks</template>
            </h1>
            <div class="ml-auto flex items-center gap-1">
                <Button
                    :variant="priorityOnly ? 'secondary' : 'ghost'"
                    size="sm"
                    class="h-7 gap-1 px-2 text-xs"
                    @click="priorityOnly = !priorityOnly"
                >
                    <Flag class="size-3.5" /> Priority
                </Button>
                <Button
                    :variant="includeChecklists ? 'secondary' : 'ghost'"
                    size="sm"
                    class="h-7 px-2 text-xs"
                    @click="includeChecklists = !includeChecklists"
                >
                    + Checklists
                </Button>
                <Button
                    :variant="showCompleted ? 'secondary' : 'ghost'"
                    size="sm"
                    class="h-7 px-2 text-xs"
                    @click="showCompleted = !showCompleted"
                >
                    Done
                </Button>
                <Button
                    v-if="isSplit"
                    variant="outline"
                    size="sm"
                    class="ml-2 h-7 gap-1 px-2 text-xs text-muted-foreground"
                    title="Close split (Esc)"
                    @click="emit('close')"
                >
                    <X class="size-3.5" /> Close
                </Button>
            </div>
        </header>

        <div
            v-if="!filterTag && !filterMention && availableTags.length > 0"
            class="flex flex-wrap gap-1 border-b border-border/40 px-4 py-2"
        >
            <button
                v-for="tag in availableTags"
                :key="tag"
                type="button"
                :class="
                    cn(
                        'rounded-full border px-2 py-0.5 text-xs',
                        selectedTag === tag
                            ? 'border-primary/50 bg-primary/10 text-primary'
                            : 'border-border/70 text-muted-foreground hover:bg-muted/60',
                    )
                "
                @click="selectedTag = selectedTag === tag ? null : tag"
            >
                #{{ tag }}
            </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div
                v-if="groups.length === 0"
                class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"
            >
                <CalendarClock class="size-8 opacity-40" />
                <p class="text-sm">No tasks match these filters.</p>
            </div>

            <section v-for="group in groups" :key="group.label" class="mb-5">
                <h2
                    :class="
                        cn(
                            'mb-1.5 text-[11px] font-semibold tracking-wide uppercase',
                            group.label === 'Overdue'
                                ? 'text-destructive'
                                : 'text-muted-foreground',
                        )
                    "
                >
                    {{ group.label }}
                    <span class="font-normal opacity-60"
                        >· {{ group.tasks.length }}</span
                    >
                </h2>

                <div
                    v-for="task in group.tasks"
                    :key="`${task.noteId}:${task.line.index}`"
                    class="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/50"
                >
                    <button
                        type="button"
                        :class="
                            cn(
                                'mt-0.5 flex size-[17px] shrink-0 items-center justify-center border-[1.5px] text-[10px] font-bold transition-transform hover:scale-110',
                                task.line.kind === 'task'
                                    ? 'rounded-full'
                                    : 'rounded-[4px]',
                                task.line.state === 'done'
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-primary/60 text-transparent',
                            )
                        "
                        :style="checkboxStyle(task)"
                        :aria-label="
                            task.line.state === 'done' ? 'Reopen' : 'Complete'
                        "
                        @click="toggleTaskLine(task.noteId, task.line.index)"
                    >
                        ✓
                    </button>

                    <button
                        type="button"
                        class="min-w-0 flex-1 text-left"
                        @click="emit('open-note', task.noteId, task.line.index)"
                    >
                        <p
                            :class="
                                cn(
                                    'truncate text-sm',
                                    task.line.state !== 'open' &&
                                        'text-muted-foreground line-through',
                                )
                            "
                        >
                            <span
                                v-if="task.line.priority > 0"
                                class="mr-1 font-bold"
                                :style="{
                                    color: priorityColor(task.line.priority)!,
                                }"
                                >{{ '!'.repeat(task.line.priority) }}</span
                            >
                            <TaskTitle :text="task.line.title" />
                        </p>
                        <p
                            class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
                        >
                            <span class="truncate">{{ noteLabel(task) }}</span>
                            <span
                                v-if="taskDayKey(task)"
                                class="text-primary/80"
                                >{{ humanizeKey(taskDayKey(task)!) }}</span
                            >
                            <span
                                v-if="dueLabel(task)"
                                class="text-amber-600 dark:text-amber-500"
                                >{{ dueLabel(task) }}</span
                            >
                            <span v-if="task.line.repeat" class="opacity-70"
                                >↻ {{ task.line.repeat.raw }}</span
                            >
                            <span
                                v-for="tag in task.line.tags"
                                :key="tag"
                                class="inline-flex items-center gap-0.5 opacity-80"
                            >
                                <Hash class="size-3" />{{ tag }}
                            </span>
                            <span
                                v-for="mention in task.line.mentions"
                                :key="mention"
                                class="inline-flex items-center gap-0.5 opacity-80"
                            >
                                <AtSign class="size-3" />{{ mention }}
                            </span>
                        </p>
                    </button>
                </div>
            </section>
        </div>
    </div>
</template>
