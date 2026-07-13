<script setup lang="ts">
import {
    CalendarClock,
    Check,
    ExternalLink,
    Eye,
    EyeOff,
    MapPin,
    Video,
    X,
} from '@lucide/vue';
import { format, parseISO } from 'date-fns';
import { computed } from 'vue';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
    closeEventDetail,
    hideEvent,
    isEventHidden,
    selectedEvent,
    unhideEvent,
} from '@/stores/calendar';
import type { RsvpStatus } from '@/stores/calendar';

const isHidden = computed<boolean>(() =>
    selectedEvent.value ? isEventHidden(selectedEvent.value) : false,
);

function hideOne(): void {
    if (selectedEvent.value) {
        hideEvent(selectedEvent.value, 'one');
        closeEventDetail();
    }
}

function hideSeries(): void {
    if (selectedEvent.value) {
        hideEvent(selectedEvent.value, 'series');
        closeEventDetail();
    }
}

function unhide(): void {
    if (selectedEvent.value) {
        unhideEvent(selectedEvent.value);
        closeEventDetail();
    }
}

function parseAllDay(value: string): Date {
    const [y, m, d] = value.split('-').map(Number);

    return new Date(y, (m ?? 1) - 1, d ?? 1);
}

const when = computed<string>(() => {
    const event = selectedEvent.value;

    if (!event) {
        return '';
    }

    if (event.allDay) {
        return `${format(parseAllDay(event.start), 'EEEE, MMMM d')} · All day`;
    }

    const start = parseISO(event.start);
    const end = parseISO(event.end);

    return `${format(start, 'EEEE, MMMM d')} · ${format(start, 'h:mm a')} – ${format(end, 'h:mm a')}`;
});

const RSVP_LABEL: Record<RsvpStatus, string> = {
    accepted: 'Going',
    declined: 'Declined',
    tentative: 'Maybe',
    needsAction: 'Not responded',
};

const RSVP_CLASS: Record<RsvpStatus, string> = {
    accepted: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    declined: 'bg-red-500/15 text-red-600 dark:text-red-400',
    tentative: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    needsAction: 'bg-muted text-muted-foreground',
};
</script>

<template>
    <div
        v-if="selectedEvent"
        class="fixed inset-0 z-50"
        @click.self="closeEventDetail"
    >
        <div class="absolute inset-0 bg-black/20" @click="closeEventDetail" />

        <aside
            class="absolute inset-x-0 bottom-0 flex max-h-[85%] flex-col rounded-t-2xl border border-border/60 bg-background shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[380px] sm:rounded-none sm:border-y-0 sm:border-r-0 pb-[env(safe-area-inset-bottom)]"
        >
            <header class="flex items-start gap-2 border-b border-border/60 p-4">
                <span
                    class="mt-1.5 size-3 shrink-0 rounded-full"
                    :style="{ backgroundColor: selectedEvent.color ?? 'var(--primary)' }"
                />
                <h2 class="min-w-0 flex-1 text-lg leading-snug font-semibold">
                    {{ selectedEvent.title }}
                </h2>
                <Button
                    variant="ghost"
                    size="icon"
                    class="size-8 shrink-0"
                    aria-label="Close"
                    @click="closeEventDetail"
                >
                    <X class="size-4" />
                </Button>
            </header>

            <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
                <div class="flex items-start gap-2">
                    <CalendarClock class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span>{{ when }}</span>
                </div>

                <div
                    v-if="selectedEvent.location"
                    class="flex items-start gap-2"
                >
                    <MapPin class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span class="min-w-0">{{ selectedEvent.location }}</span>
                </div>

                <a
                    v-if="selectedEvent.hangoutLink"
                    :href="selectedEvent.hangoutLink"
                    target="_blank"
                    rel="noopener"
                    class="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                    <Video class="size-4" /> Join Google Meet
                </a>

                <p
                    v-if="selectedEvent.description"
                    class="text-sm whitespace-pre-wrap text-foreground/90"
                >
                    {{ selectedEvent.description }}
                </p>

                <div v-if="selectedEvent.attendees.length > 0" class="space-y-1.5">
                    <p class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {{ selectedEvent.attendees.length }} guests
                    </p>
                    <div
                        v-for="attendee in selectedEvent.attendees"
                        :key="attendee.email"
                        class="flex items-center gap-2"
                    >
                        <Check
                            v-if="attendee.response === 'accepted'"
                            class="size-3.5 shrink-0 text-emerald-500"
                        />
                        <span v-else class="size-3.5 shrink-0" />
                        <span class="min-w-0 flex-1 truncate">
                            {{ attendee.name || attendee.email }}
                            <span v-if="attendee.organizer" class="text-xs text-muted-foreground">
                                · organizer</span
                            >
                        </span>
                    </div>
                </div>

                <span
                    :class="
                        cn(
                            'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                            RSVP_CLASS[selectedEvent.responseStatus],
                        )
                    "
                >
                    {{ RSVP_LABEL[selectedEvent.responseStatus] }}
                </span>

                <p class="text-xs text-muted-foreground">
                    {{ selectedEvent.calendarName }}
                    <span v-if="selectedEvent.accountEmail">
                        · {{ selectedEvent.accountEmail }}</span
                    >
                </p>

                <div class="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                    <template v-if="isHidden">
                        <Button
                            variant="outline"
                            size="sm"
                            class="h-8 gap-1.5 text-xs"
                            @click="unhide"
                        >
                            <Eye class="size-3.5" /> Unhide
                        </Button>
                    </template>
                    <template v-else>
                        <Button
                            variant="outline"
                            size="sm"
                            class="h-8 gap-1.5 text-xs"
                            @click="hideOne"
                        >
                            <EyeOff class="size-3.5" /> Hide this event
                        </Button>
                        <Button
                            v-if="selectedEvent.seriesId"
                            variant="outline"
                            size="sm"
                            class="h-8 gap-1.5 text-xs"
                            @click="hideSeries"
                        >
                            <EyeOff class="size-3.5" /> Hide all in series
                        </Button>
                    </template>
                </div>
            </div>

            <footer
                v-if="selectedEvent.htmlLink"
                class="border-t border-border/60 p-3"
            >
                <a
                    :href="selectedEvent.htmlLink"
                    target="_blank"
                    rel="noopener"
                    class="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                    <ExternalLink class="size-3.5" /> Open in Google Calendar
                </a>
            </footer>
        </aside>
    </div>
</template>
