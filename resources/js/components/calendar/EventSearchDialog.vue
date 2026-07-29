<script setup lang="ts">
import { CalendarDays, Search } from '@lucide/vue';
import { format, formatDistanceToNowStrict, isSameDay } from 'date-fns';
import { computed, ref, watch } from 'vue';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { searchEvents } from '@/core/eventSearch';
import { visibleEvents } from '@/core/eventVisibility';
import { eventMoment } from '@/core/eventWindow';
import type { CalendarEvent } from '@/lib/calendarFetch';
import { cn } from '@/lib/utils';
import { currentVisibility } from '@/stores/calendar';
import { horizonEvents, refreshHorizon } from '@/stores/eventHorizon';

const open = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{ pick: [event: CalendarEvent] }>();

const query = ref('');
const highlighted = ref(0);

/**
 * The corpus is the cached window put through the grid's own visibility
 * pipeline, so switched-off calendars, declined events, and decluttered ones
 * behave exactly as they do on screen.
 */
const corpus = computed<CalendarEvent[]>(() =>
    visibleEvents(horizonEvents.value, currentVisibility()).filter(
        (event) => !event.hidden,
    ),
);

const results = computed<CalendarEvent[]>(() =>
    searchEvents(corpus.value, query.value, new Date()),
);

watch(open, (isOpen) => {
    if (isOpen) {
        query.value = '';
        highlighted.value = 0;
        // The window may be minutes old; correct it behind the typing.
        void refreshHorizon();
    }
});

watch(results, () => {
    highlighted.value = 0;
});

/** "in 2 hours" / "3 days ago", plus the clock time for a same-day hit. */
function when(event: CalendarEvent): string {
    const start = new Date(eventMoment(event.start));
    const relative = formatDistanceToNowStrict(start, { addSuffix: true });

    return isSameDay(start, new Date())
        ? `${format(start, 'HH:mm')} · ${relative}`
        : `${format(start, 'EEE, MMM d')} · ${relative}`;
}

function pick(event: CalendarEvent): void {
    emit('pick', event);
    open.value = false;
}

function onKeydown(event: KeyboardEvent): void {
    const total = results.value.length;

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        highlighted.value = (highlighted.value + 1) % Math.max(total, 1);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        highlighted.value =
            (highlighted.value - 1 + Math.max(total, 1)) % Math.max(total, 1);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        const chosen = results.value[highlighted.value];

        if (chosen) {
            pick(chosen);
        }
    }
}
</script>

<template>
    <Dialog v-model:open="open">
        <DialogContent
            class="top-[20%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
        >
            <DialogTitle class="sr-only">Search events</DialogTitle>

            <div class="flex items-center gap-2 border-b border-border/60 px-3">
                <Search class="size-4 shrink-0 text-muted-foreground" />
                <input
                    v-model="query"
                    class="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    placeholder="Search events by title, person, or place…"
                    autofocus
                    @keydown="onKeydown"
                />
            </div>

            <div class="max-h-80 overflow-y-auto p-1.5">
                <button
                    v-for="(event, index) in results"
                    :key="event.key"
                    type="button"
                    :class="
                        cn(
                            'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left',
                            index === highlighted
                                ? 'bg-muted'
                                : 'hover:bg-muted/60',
                        )
                    "
                    @mouseenter="highlighted = index"
                    @click="pick(event)"
                >
                    <span
                        class="mt-1.5 size-2 shrink-0 rounded-full"
                        :style="{
                            backgroundColor:
                                event.eventColor ??
                                event.color ??
                                'var(--muted-foreground)',
                        }"
                    />
                    <span class="min-w-0">
                        <span class="block truncate text-sm font-medium">{{
                            event.title
                        }}</span>
                        <span
                            class="block truncate text-xs text-muted-foreground"
                        >
                            {{ when(event) }}
                            <template v-if="event.location">
                                · {{ event.location }}
                            </template>
                        </span>
                    </span>
                </button>

                <p
                    v-if="results.length === 0"
                    class="flex items-center justify-center gap-1.5 px-2.5 py-6 text-center text-sm text-muted-foreground"
                >
                    <CalendarDays class="size-3.5" />
                    {{
                        query.trim() === ''
                            ? 'Type to search four weeks either side of today.'
                            : 'No events match.'
                    }}
                </p>
            </div>
        </DialogContent>
    </Dialog>
</template>
