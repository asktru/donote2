<script setup lang="ts">
import { CalendarDays, ChevronLeft, ChevronRight, Trash2 } from '@lucide/vue';
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
import { computed, nextTick, ref, watch } from 'vue';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { dateKeyFor, humanizeKey, keyStartDate, kindOfKey } from '@/core/dates';
import { parseNaturalDate } from '@/core/parseNaturalDate';
import { cn } from '@/lib/utils';
import { closeDatePicker, datePickerRequest } from '@/stores/datePicker';
import { openCalendar } from '@/stores/ui';

const text = ref('');
const focusedMonth = ref(startOfMonth(new Date()));
const input = ref<HTMLInputElement | null>(null);

const open = computed({
    get: () => datePickerRequest.value !== null,
    // Closing via overlay/escape cancels (any appended token stays as-is).
    set: (value) => {
        if (!value) {
            closeDatePicker();
        }
    },
});

const allowPeriods = computed(() => datePickerRequest.value?.allowPeriods ?? true);

// (Re)initialize each time the picker opens.
watch(datePickerRequest, (request) => {
    if (request === null) {
        return;
    }

    text.value = request.current ?? '';
    focusedMonth.value = startOfMonth(
        request.current !== null && kindOfKey(request.current) !== null
            ? keyStartDate(request.current)
            : new Date(),
    );

    void nextTick(() => {
        input.value?.focus();
        input.value?.select();
    });
});

/** The key the current text resolves to, or null. */
const draftKey = computed<string | null>(() =>
    text.value.trim() === '' ? null : parseNaturalDate(text.value),
);

/** Whether the draft can be applied in the current mode. */
const draftValid = computed<boolean>(() => {
    if (draftKey.value === null) {
        return false;
    }

    return allowPeriods.value || kindOfKey(draftKey.value) === 'daily';
});

const preview = computed<string>(() => {
    if (text.value.trim() === '') {
        return '';
    }

    if (draftKey.value === null) {
        return 'Not a recognized date';
    }

    if (!draftValid.value) {
        return 'Due dates must be a single day';
    }

    return `→ ${humanizeKey(draftKey.value)}`;
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
        const days = Array.from({ length: 7 }, (_, day) => addDays(cursor, day));

        rows.push({
            weekKey: `${getISOWeekYear(cursor)}-W${String(getISOWeek(cursor)).padStart(2, '0')}`,
            weekNumber: getISOWeek(cursor),
            days,
        });
        cursor = addDays(cursor, 7);
    }

    return rows;
});

const monthKey = computed(() => dateKeyFor('monthly', focusedMonth.value));
const quarterKey = computed(() => dateKeyFor('quarterly', focusedMonth.value));
const yearKey = computed(() => dateKeyFor('yearly', focusedMonth.value));
const today = new Date();

/** Selecting from the calendar just fills the text input. */
function choose(key: string): void {
    text.value = key;
}

function apply(): void {
    if (draftValid.value && draftKey.value !== null) {
        datePickerRequest.value?.onApply(draftKey.value);
        closeDatePicker();
    }
}

function clear(): void {
    datePickerRequest.value?.onApply(null);
    closeDatePicker();
}

function goToCalendarNote(): void {
    const key = draftKey.value;
    const kind = key !== null ? kindOfKey(key) : null;

    if (key !== null && kind !== null) {
        openCalendar(kind, key);
        closeDatePicker();
    }
}
</script>

<template>
    <Dialog v-model:open="open">
        <DialogContent class="max-w-xs gap-0 p-0">
            <DialogHeader class="px-4 pt-4 pb-2">
                <DialogTitle>{{ datePickerRequest?.title ?? 'Date' }}</DialogTitle>
                <DialogDescription class="sr-only">
                    Type a date or pick one from the calendar.
                </DialogDescription>
            </DialogHeader>

            <div class="space-y-3 px-4 pb-4">
                <div>
                    <input
                        ref="input"
                        v-model="text"
                        type="text"
                        class="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
                        placeholder="e.g. next fri, aug 12, w18, 2026-Q3"
                        @keydown.enter.prevent="apply"
                    />
                    <p
                        v-if="preview"
                        :class="
                            cn(
                                'mt-1 px-0.5 text-xs',
                                draftValid
                                    ? 'text-muted-foreground'
                                    : 'text-destructive',
                            )
                        "
                    >
                        {{ preview }}
                    </p>
                </div>

                <!-- Period shortcuts (schedule only). -->
                <div
                    v-if="allowPeriods"
                    class="flex flex-wrap gap-1 text-xs"
                >
                    <button
                        v-for="option in [
                            { label: format(focusedMonth, 'MMMM'), key: monthKey },
                            { label: `Q${format(focusedMonth, 'Q')}`, key: quarterKey },
                            { label: format(focusedMonth, 'yyyy'), key: yearKey },
                        ]"
                        :key="option.key"
                        type="button"
                        :class="
                            cn(
                                'rounded-md border border-border/70 px-2 py-1 hover:bg-muted/60',
                                draftKey === option.key &&
                                    'border-primary bg-primary/10 text-primary',
                            )
                        "
                        @click="choose(option.key)"
                    >
                        {{ option.label }}
                    </button>
                </div>

                <!-- Month calendar -->
                <div class="select-none">
                    <div class="flex items-center px-1 pb-1">
                        <p class="text-sm font-medium">
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
                        <span class="pr-1.5 text-[10px] text-muted-foreground/60"
                            >CW</span
                        >
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
                                :disabled="!allowPeriods"
                                :class="
                                    cn(
                                        'pr-1.5 text-[10px] text-muted-foreground/60',
                                        allowPeriods
                                            ? 'hover:text-primary'
                                            : 'opacity-40',
                                        draftKey === week.weekKey &&
                                            'font-bold text-primary',
                                    )
                                "
                                @click="allowPeriods && choose(week.weekKey)"
                            >
                                {{ week.weekNumber }}
                            </button>
                            <button
                                v-for="day in week.days"
                                :key="day.toISOString()"
                                type="button"
                                :class="
                                    cn(
                                        'mx-auto flex size-7 items-center justify-center rounded-full text-xs hover:bg-muted',
                                        !isSameMonth(day, focusedMonth) &&
                                            'text-muted-foreground/40',
                                        isSameDay(day, today) &&
                                            'font-bold text-primary',
                                        draftKey === dateKeyFor('daily', day) &&
                                            'bg-primary text-primary-foreground hover:bg-primary',
                                    )
                                "
                                @click="choose(dateKeyFor('daily', day))"
                            >
                                {{ day.getDate() }}
                            </button>
                        </template>
                    </div>
                </div>

                <div class="flex items-center gap-2 border-t border-border/60 pt-3">
                    <button
                        type="button"
                        class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                        :disabled="!draftValid"
                        @click="goToCalendarNote"
                    >
                        <CalendarDays class="size-3.5" /> Open note
                    </button>
                    <button
                        type="button"
                        class="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                        @click="clear"
                    >
                        <Trash2 class="size-3.5" /> Clear
                    </button>
                    <Button size="sm" :disabled="!draftValid" @click="apply">
                        Set
                    </Button>
                </div>
            </div>
        </DialogContent>
    </Dialog>
</template>
