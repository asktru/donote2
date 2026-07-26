<script setup lang="ts">
import { Archive, ChevronRight } from '@lucide/vue';
import { format } from 'date-fns';
import { computed, ref } from 'vue';

import {
    humanizeKey,
    isSamePeriodKey,
    keyStartDate,
    todayDailyKey,
} from '@/core/dates';
import { priorityColor } from '@/core/priority';
import { cn } from '@/lib/utils';
import { currentView } from '@/stores/ui';
import { isSectionCollapsed, toggleSection } from '@/stores/uiSections';
import {
    isArchivedNote,
    taskDayKey,
    toggleTaskLine,
    workspaceTasks,
} from '@/stores/workspace';
import type { WorkspaceTask } from '@/stores/workspace';

/**
 * Open tasks scheduled for exactly the currently viewed period — a weekly
 * note lists what was scheduled for the week itself (`>2026-W30`), not the
 * items scheduled for its individual days, which belong to those days' own
 * notes. A task lands in the period via its schedule (>date), its @due(date),
 * or the daily note it lives in.
 */

const emit = defineEmits<{
    'open-note': [noteId: string, line: number, split: boolean];
}>();

const periodKey = computed(() =>
    currentView.value.kind === 'calendar'
        ? currentView.value.dateKey
        : todayDailyKey(),
);

const periodLabel = computed(() => humanizeKey(periodKey.value));

const includeArchive = ref(false);

/** Every open task landing in the viewed period, archived ones included. */
const periodTasks = computed<WorkspaceTask[]>(() => {
    const inPeriod = (key: string | null): boolean =>
        isSamePeriodKey(key, periodKey.value);

    return workspaceTasks.value
        .filter(
            (task) =>
                task.line.kind === 'task' &&
                task.line.state === 'open' &&
                (inPeriod(taskDayKey(task)) || inPeriod(task.line.due)),
        )
        .sort(
            (a, b) =>
                b.line.priority - a.line.priority ||
                (taskDayKey(a) ?? '').localeCompare(taskDayKey(b) ?? ''),
        );
});

const dueTasks = computed<WorkspaceTask[]>(() =>
    includeArchive.value
        ? periodTasks.value
        : periodTasks.value.filter((task) => !isArchivedNote(task.note)),
);

/** Archived tasks in the period — drives the toggle's visibility. */
const archivedCount = computed(
    () => periodTasks.value.filter((task) => isArchivedNote(task.note)).length,
);

function noteLabel(task: WorkspaceTask): string {
    if (task.note.type !== 'note' && task.note.dateKey !== null) {
        return humanizeKey(task.note.dateKey);
    }

    return task.note.title || 'Untitled';
}

function dueBadge(task: WorkspaceTask): string | null {
    if (task.line.due === null) {
        return null;
    }

    return `due ${format(keyStartDate(task.line.due), 'MMM d')}`;
}
</script>

<template>
    <div v-if="dueTasks.length > 0 || archivedCount > 0">
        <div class="flex items-center gap-1 pb-1.5">
            <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1 px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
                @click="toggleSection('tasks')"
            >
                <ChevronRight
                    :class="
                        cn(
                            'size-3 shrink-0 transition-transform',
                            !isSectionCollapsed('tasks') && 'rotate-90',
                        )
                    "
                />
                Tasks · {{ periodLabel }}
            </button>
            <button
                v-if="archivedCount > 0"
                type="button"
                :class="
                    cn(
                        'flex shrink-0 items-center gap-1 rounded px-1 text-[11px]',
                        includeArchive
                            ? 'text-foreground'
                            : 'text-muted-foreground/70 hover:text-foreground',
                    )
                "
                :title="
                    includeArchive
                        ? 'Hide archived tasks'
                        : `Show ${archivedCount} archived task${archivedCount === 1 ? '' : 's'}`
                "
                @click="includeArchive = !includeArchive"
            >
                <Archive class="size-3" /> {{ archivedCount }}
            </button>
        </div>
        <div v-if="!isSectionCollapsed('tasks')" class="space-y-0.5">
            <div
                v-for="task in dueTasks"
                :key="`${task.noteId}:${task.line.index}`"
                class="group flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60"
            >
                <button
                    type="button"
                    :class="
                        cn(
                            'mt-1 size-3.5 shrink-0 rounded-full border-2 transition-colors',
                            task.line.priority > 0
                                ? 'hover:bg-current/20'
                                : 'border-muted-foreground/50 hover:bg-muted-foreground/20',
                        )
                    "
                    :style="
                        priorityColor(task.line.priority)
                            ? {
                                  borderColor: priorityColor(
                                      task.line.priority,
                                  )!,
                                  color: priorityColor(task.line.priority)!,
                              }
                            : {}
                    "
                    title="Complete task"
                    aria-label="Complete task"
                    @click="toggleTaskLine(task.noteId, task.line.index)"
                />
                <button
                    type="button"
                    class="min-w-0 flex-1 text-left"
                    @click="
                        (event) =>
                            emit(
                                'open-note',
                                task.noteId,
                                task.line.index,
                                event.altKey,
                            )
                    "
                >
                    <span class="block truncate text-xs">{{
                        task.line.title
                    }}</span>
                    <span
                        class="block truncate text-[11px] text-muted-foreground"
                    >
                        {{ noteLabel(task)
                        }}<template v-if="dueBadge(task)">
                            · {{ dueBadge(task) }}</template
                        >
                    </span>
                </button>
            </div>
        </div>
    </div>
</template>
