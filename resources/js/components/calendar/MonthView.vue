<script setup lang="ts">
import { format, isSameDay, parseISO, startOfDay } from 'date-fns';
import { computed } from 'vue';

import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/stores/calendar';

const props = defineProps<{
    days: Date[];
    anchorMonth: number;
    events: CalendarEvent[];
}>();

const emit = defineEmits<{
    'open-event': [event: CalendarEvent];
    'open-day': [day: Date];
}>();

const MAX_CHIPS = 3;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function parseAllDay(value: string): Date {
    const [y, m, d] = value.split('-').map(Number);

    return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function eventsFor(day: Date): CalendarEvent[] {
    return props.events
        .filter((event) => {
            if (event.allDay) {
                return (
                    day >= startOfDay(parseAllDay(event.start)) &&
                    day < parseAllDay(event.end)
                );
            }

            return isSameDay(parseISO(event.start), day);
        })
        .sort((a, b) => {
            if (a.allDay !== b.allDay) {
                return a.allDay ? -1 : 1;
            }

            return a.start.localeCompare(b.start);
        });
}

const cells = computed(() =>
    props.days.map((day) => {
        const dayEvents = eventsFor(day);

        return {
            day,
            inMonth: day.getMonth() === props.anchorMonth,
            isToday: isSameDay(day, new Date()),
            chips: dayEvents.slice(0, MAX_CHIPS),
            overflow: Math.max(0, dayEvents.length - MAX_CHIPS),
        };
    }),
);
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <div class="grid shrink-0 grid-cols-7 border-b border-border/60">
            <div
                v-for="weekday in WEEKDAYS"
                :key="weekday"
                class="py-1.5 text-center text-[11px] font-medium text-muted-foreground uppercase"
            >
                {{ weekday }}
            </div>
        </div>

        <div class="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
            <div
                v-for="cell in cells"
                :key="cell.day.toISOString()"
                class="min-h-0 min-w-0 border-r border-b border-border/30 p-1"
            >
                <button
                    type="button"
                    :class="
                        cn(
                            'mx-auto flex size-6 items-center justify-center rounded-full text-xs',
                            cell.isToday
                                ? 'bg-primary font-semibold text-primary-foreground'
                                : cell.inMonth
                                  ? 'text-foreground'
                                  : 'text-muted-foreground/50',
                        )
                    "
                    @click="emit('open-day', cell.day)"
                >
                    {{ format(cell.day, 'd') }}
                </button>

                <div class="mt-0.5 space-y-0.5">
                    <button
                        v-for="event in cell.chips"
                        :key="event.key"
                        type="button"
                        class="flex w-full items-center gap-1 truncate rounded px-1 text-left text-[10px] hover:bg-muted/60"
                        @click="emit('open-event', event)"
                    >
                        <span
                            class="size-1.5 shrink-0 rounded-full"
                            :style="{ backgroundColor: event.color ?? 'var(--primary)' }"
                        />
                        <span class="truncate">{{ event.title }}</span>
                    </button>
                    <p
                        v-if="cell.overflow > 0"
                        class="px-1 text-[10px] text-muted-foreground"
                    >
                        +{{ cell.overflow }} more
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>
