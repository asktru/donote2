<script setup lang="ts">
import { ChevronLeft, ChevronRight } from '@lucide/vue';
import {
    addDays,
    addMonths,
    format,
    getISOWeek,
    getISOWeekYear,
    isSameDay,
    isSameMonth,
    startOfISOWeek,
    startOfMonth,
} from 'date-fns';
import { computed, ref, watch } from 'vue';

import { Button } from '@/components/ui/button';
import { dateKeyFor, keyStartDate } from '@/core/dates';
import { cn } from '@/lib/utils';
import { currentView } from '@/stores/ui';
import { liveNotes } from '@/stores/workspace';

const emit = defineEmits<{
    'pick-day': [dateKey: string];
    'pick-week': [dateKey: string];
}>();

const focusedMonth = ref(startOfMonth(new Date()));

watch(
    currentView,
    (view) => {
        if (view.kind === 'calendar') {
            focusedMonth.value = startOfMonth(keyStartDate(view.dateKey));
        }
    },
    { immediate: true },
);

const selectedDayKey = computed(() =>
    currentView.value.kind === 'calendar' &&
    currentView.value.calKind === 'daily'
        ? currentView.value.dateKey
        : null,
);

/** Days that have a daily note with content. */
const daysWithNotes = computed<Set<string>>(() => {
    const days = new Set<string>();

    for (const note of liveNotes.value) {
        if (
            note.type === 'daily' &&
            note.dateKey !== null &&
            note.content.trim() !== ''
        ) {
            days.add(note.dateKey);
        }
    }

    return days;
});

interface WeekRow {
    weekKey: string;
    weekNumber: number;
    days: Date[];
}

const weeks = computed<WeekRow[]>(() => {
    const rows: WeekRow[] = [];
    let cursor = startOfISOWeek(startOfMonth(focusedMonth.value));

    for (let index = 0; index < 6; index++) {
        const days = Array.from({ length: 7 }, (_, day) =>
            addDays(cursor, day),
        );
        rows.push({
            weekKey: `${getISOWeekYear(cursor)}-W${String(getISOWeek(cursor)).padStart(2, '0')}`,
            weekNumber: getISOWeek(cursor),
            days,
        });
        cursor = addDays(cursor, 7);
    }

    return rows;
});

const today = new Date();
</script>

<template>
    <div class="select-none">
        <div class="flex items-center px-1 pb-2">
            <p class="text-sm font-semibold">
                {{ format(focusedMonth, 'MMMM yyyy') }}
            </p>
            <div class="ml-auto flex gap-0.5">
                <Button
                    variant="ghost"
                    size="icon"
                    class="size-6"
                    aria-label="Previous month"
                    @click="focusedMonth = addMonths(focusedMonth, -1)"
                >
                    <ChevronLeft class="size-3.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    class="size-6"
                    aria-label="Next month"
                    @click="focusedMonth = addMonths(focusedMonth, 1)"
                >
                    <ChevronRight class="size-3.5" />
                </Button>
            </div>
        </div>

        <div
            class="grid grid-cols-[auto_repeat(7,1fr)] gap-y-0.5 text-center text-xs"
        >
            <span class="pr-1.5 text-[10px] text-muted-foreground/60">CW</span>
            <span
                v-for="day in ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']"
                :key="day"
                class="pb-1 text-[10px] text-muted-foreground"
            >
                {{ day }}
            </span>

            <template v-for="week in weeks" :key="week.weekKey">
                <button
                    type="button"
                    class="pr-1.5 text-[10px] text-muted-foreground/60 hover:text-primary"
                    :title="`Open weekly note ${week.weekKey}`"
                    @click="emit('pick-week', week.weekKey)"
                >
                    {{ week.weekNumber }}
                </button>
                <button
                    v-for="day in week.days"
                    :key="day.toISOString()"
                    type="button"
                    :class="
                        cn(
                            'relative mx-auto flex size-6 items-center justify-center rounded-full text-xs hover:bg-muted',
                            !isSameMonth(day, focusedMonth) &&
                                'text-muted-foreground/40',
                            isSameDay(day, today) && 'font-bold text-primary',
                            selectedDayKey === dateKeyFor('daily', day) &&
                                'bg-primary text-primary-foreground hover:bg-primary',
                        )
                    "
                    @click="emit('pick-day', dateKeyFor('daily', day))"
                >
                    {{ day.getDate() }}
                    <span
                        v-if="daysWithNotes.has(dateKeyFor('daily', day))"
                        :class="
                            cn(
                                'absolute bottom-0 size-1 rounded-full',
                                selectedDayKey === dateKeyFor('daily', day)
                                    ? 'bg-primary-foreground'
                                    : 'bg-primary/70',
                            )
                        "
                    />
                </button>
            </template>
        </div>
    </div>
</template>
