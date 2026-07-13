<script setup lang="ts">
import {
    addDays,
    addMinutes,
    differenceInMinutes,
    format,
    isSameDay,
    parseISO,
    startOfDay,
} from 'date-fns';
import { computed, onMounted, ref } from 'vue';

import { layoutDayColumns } from '@/core/calendarLayout';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/stores/calendar';

const props = defineProps<{
    days: Date[];
    events: CalendarEvent[];
    /** IANA zone for the secondary time axis, e.g. "Europe/London". */
    secondZone?: string | null;
}>();

const emit = defineEmits<{ 'open-event': [event: CalendarEvent] }>();

const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const scroller = ref<HTMLElement | null>(null);
const now = ref(new Date());

/** Parse an all-day date key (YYYY-MM-DD) as a local midnight, not UTC. */
function parseAllDay(value: string): Date {
    const [y, m, d] = value.split('-').map(Number);

    return new Date(y, (m ?? 1) - 1, d ?? 1);
}

interface PositionedEvent {
    event: CalendarEvent;
    top: number;
    height: number;
    leftPct: number;
    widthPct: number;
}

/** Timed events that intersect a given day, laid out in overlap columns. */
function timedFor(day: Date): PositionedEvent[] {
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);

    const items = props.events
        .filter((event) => !event.allDay)
        .map((event) => ({ event, start: parseISO(event.start), end: parseISO(event.end) }))
        .filter(({ start, end }) => start < dayEnd && end > dayStart)
        .map(({ event, start, end }) => {
            const startMin = Math.max(0, differenceInMinutes(start, dayStart));
            const endMin = Math.min(1440, differenceInMinutes(end, dayStart));

            return { event, startMin, endMin: Math.max(endMin, startMin + 20) };
        });

    return layoutDayColumns(items).map(({ item, lane, lanes }) => ({
        event: item.event,
        top: (item.startMin / 60) * HOUR_HEIGHT,
        height: ((item.endMin - item.startMin) / 60) * HOUR_HEIGHT,
        leftPct: (lane / lanes) * 100,
        widthPct: (1 / lanes) * 100,
    }));
}

/** All-day events covering a given day. */
function allDayFor(day: Date): CalendarEvent[] {
    return props.events.filter((event) => {
        if (!event.allDay) {
            return false;
        }

        const start = parseAllDay(event.start);
        const end = parseAllDay(event.end); // exclusive

        return day >= startOfDay(start) && day < end;
    });
}

const columns = computed(() =>
    props.days.map((day) => ({
        day,
        isToday: isSameDay(day, now.value),
        timed: timedFor(day),
        allDay: allDayFor(day),
    })),
);

const hasAllDay = computed(() => columns.value.some((c) => c.allDay.length > 0));

/** Secondary-zone hour labels aligned to each local hour row. */
const secondZoneLabels = computed<string[]>(() => {
    if (!props.secondZone) {
        return [];
    }

    const base = startOfDay(props.days[0] ?? now.value);
    const formatter = new Intl.DateTimeFormat([], {
        hour: 'numeric',
        timeZone: props.secondZone,
    });

    return HOURS.map((h) => formatter.format(addMinutes(base, h * 60)));
});

const nowTop = computed(
    () => (differenceInMinutes(now.value, startOfDay(now.value)) / 60) * HOUR_HEIGHT,
);

function timeLabel(event: CalendarEvent): string {
    return format(parseISO(event.start), 'h:mm');
}

onMounted(() => {
    // Scroll to ~7am so the working day is in view on open.
    if (scroller.value) {
        scroller.value.scrollTop = 7 * HOUR_HEIGHT;
    }

    setInterval(() => {
        now.value = new Date();
    }, 60_000);
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <!-- Column headers -->
        <div class="flex shrink-0 border-b border-border/60 pr-3">
            <div :class="secondZone ? 'w-24' : 'w-14'" class="shrink-0" />
            <div
                v-for="col in columns"
                :key="col.day.toISOString()"
                class="flex-1 py-1.5 text-center"
            >
                <div class="text-[11px] text-muted-foreground uppercase">
                    {{ format(col.day, 'EEE') }}
                </div>
                <div
                    :class="
                        cn(
                            'mx-auto flex size-7 items-center justify-center rounded-full text-sm',
                            col.isToday
                                ? 'bg-primary font-semibold text-primary-foreground'
                                : 'text-foreground',
                        )
                    "
                >
                    {{ format(col.day, 'd') }}
                </div>
            </div>
        </div>

        <!-- All-day row -->
        <div
            v-if="hasAllDay"
            class="flex shrink-0 border-b border-border/60 pr-3"
        >
            <div
                :class="secondZone ? 'w-24' : 'w-14'"
                class="shrink-0 py-1 pr-1 text-right text-[10px] text-muted-foreground"
            >
                all-day
            </div>
            <div
                v-for="col in columns"
                :key="col.day.toISOString()"
                class="min-w-0 flex-1 space-y-0.5 px-0.5 py-1"
            >
                <button
                    v-for="event in col.allDay"
                    :key="event.key"
                    type="button"
                    class="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] text-white"
                    :style="{ backgroundColor: event.color ?? 'var(--primary)' }"
                    @click="emit('open-event', event)"
                >
                    {{ event.title }}
                </button>
            </div>
        </div>

        <!-- Scrollable hour grid -->
        <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
            <div class="flex pr-3">
                <!-- Time axis (local + optional secondary zone) -->
                <div
                    :class="secondZone ? 'w-24' : 'w-14'"
                    class="relative shrink-0"
                    :style="{ height: `${24 * HOUR_HEIGHT}px` }"
                >
                    <div
                        v-for="h in HOURS"
                        :key="h"
                        class="absolute right-1 flex w-full justify-end gap-2 pr-1 text-[10px] text-muted-foreground"
                        :style="{ top: `${h * HOUR_HEIGHT - 6}px` }"
                    >
                        <span v-if="secondZone" class="opacity-60">{{
                            secondZoneLabels[h]
                        }}</span>
                        <span>{{ h === 0 ? '' : format(new Date(2000, 0, 1, h), 'ha') }}</span>
                    </div>
                </div>

                <!-- Day columns -->
                <div
                    v-for="col in columns"
                    :key="col.day.toISOString()"
                    class="relative min-w-0 flex-1 border-l border-border/40"
                    :style="{ height: `${24 * HOUR_HEIGHT}px` }"
                >
                    <div
                        v-for="h in HOURS"
                        :key="h"
                        class="absolute inset-x-0 border-t border-border/30"
                        :style="{ top: `${h * HOUR_HEIGHT}px` }"
                    />

                    <div
                        v-if="col.isToday"
                        class="absolute inset-x-0 z-10 border-t-2 border-red-500"
                        :style="{ top: `${nowTop}px` }"
                    >
                        <span
                            class="absolute -top-1 -left-1 size-2 rounded-full bg-red-500"
                        />
                    </div>

                    <button
                        v-for="pos in col.timed"
                        :key="pos.event.key"
                        type="button"
                        class="absolute overflow-hidden rounded-md border border-white/20 px-1.5 py-0.5 text-left text-[11px] leading-tight text-white shadow-sm"
                        :style="{
                            top: `${pos.top}px`,
                            height: `${pos.height}px`,
                            left: `calc(${pos.leftPct}% + 1px)`,
                            width: `calc(${pos.widthPct}% - 2px)`,
                            backgroundColor: pos.event.color ?? 'var(--primary)',
                        }"
                        @click="emit('open-event', pos.event)"
                    >
                        <span class="block font-medium">{{ timeLabel(pos.event) }}</span>
                        <span class="block truncate">{{ pos.event.title }}</span>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
