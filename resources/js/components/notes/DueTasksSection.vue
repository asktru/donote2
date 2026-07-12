<script setup lang="ts">
import { format } from 'date-fns';
import { computed } from 'vue';

import { humanizeKey, keyRange, keyStartDate, todayDailyKey } from '@/core/dates';
import { priorityColor } from '@/core/priority';
import { cn } from '@/lib/utils';
import { currentView } from '@/stores/ui';
import { taskDayKey, toggleTaskLine, workspaceTasks } from '@/stores/workspace';
import type { WorkspaceTask } from '@/stores/workspace';

/**
 * Open tasks that land in the currently viewed period: the day for a
 * daily note, the whole week/month/quarter/year for the other calendar
 * notes. A task lands in the period via its schedule (>date), its
 * @due(date), or the daily note it lives in.
 */

const emit = defineEmits<{
    'open-note': [noteId: string, line: number];
}>();

const periodKey = computed(() =>
    currentView.value.kind === 'calendar'
        ? currentView.value.dateKey
        : todayDailyKey(),
);

const periodLabel = computed(() => humanizeKey(periodKey.value));

const dueTasks = computed<WorkspaceTask[]>(() => {
    const range = keyRange(periodKey.value);
    const start = range.start.getTime();
    const end = range.end.getTime();

    const inPeriod = (dayKey: string | null): boolean => {
        if (dayKey === null) {
            return false;
        }

        const time = keyStartDate(dayKey).getTime();

        return time >= start && time < end;
    };

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
    <div v-if="dueTasks.length > 0">
        <p
            class="px-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
        >
            Tasks · {{ periodLabel }}
        </p>
        <div class="space-y-0.5">
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
                    @click="emit('open-note', task.noteId, task.line.index)"
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
