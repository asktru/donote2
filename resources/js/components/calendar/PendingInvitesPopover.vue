<script setup lang="ts">
/**
 * The invitations you have not answered. Each row jumps to the event on the
 * grid, or can be answered in place — clearing the list without ever leaving
 * whatever you were looking at.
 */
import { MailQuestionMark, Repeat } from '@lucide/vue';
import { format, formatDistanceToNowStrict, isSameDay } from 'date-fns';
import { watch } from 'vue';

import RsvpControls from '@/components/calendar/RsvpControls.vue';
import { eventMoment } from '@/core/eventWindow';
import type { CalendarEvent } from '@/stores/calendar';
import { pendingInvitations } from '@/stores/calendar';

const open = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{ pick: [event: CalendarEvent] }>();

// Answering the last one leaves an empty popover hanging; close it instead.
watch(pendingInvitations, (invites) => {
    if (invites.length === 0) {
        open.value = false;
    }
});

/** "Thu, Aug 6 · in 7 days", or the clock time when it is today. */
function when(event: CalendarEvent): string {
    const start = new Date(eventMoment(event.start));
    const relative = formatDistanceToNowStrict(start, { addSuffix: true });

    return isSameDay(start, new Date())
        ? `${format(start, 'HH:mm')} · ${relative}`
        : `${format(start, 'EEE, MMM d')} · ${relative}`;
}
</script>

<template>
    <div
        v-if="open"
        class="absolute top-full right-3 z-50 mt-1 w-80 overflow-hidden rounded-lg border border-border/60 bg-popover shadow-lg sm:right-4"
    >
        <p
            class="border-b border-border/60 px-3 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
        >
            {{ pendingInvitations.length }} pending
            {{ pendingInvitations.length === 1 ? 'invitation' : 'invitations' }}
        </p>

        <div class="max-h-80 overflow-y-auto p-1.5">
            <div
                v-for="event in pendingInvitations"
                :key="event.key"
                class="rounded-lg px-2.5 py-2 hover:bg-muted/60"
            >
                <button
                    type="button"
                    class="block w-full text-left"
                    @click="emit('pick', event)"
                >
                    <span class="flex items-center gap-1.5">
                        <span
                            class="size-2 shrink-0 rounded-full"
                            :style="{
                                backgroundColor:
                                    event.eventColor ??
                                    event.color ??
                                    'var(--muted-foreground)',
                            }"
                        />
                        <span
                            class="min-w-0 flex-1 truncate text-sm font-medium"
                        >
                            {{ event.title }}
                        </span>
                        <Repeat
                            v-if="event.seriesId"
                            class="size-3 shrink-0 text-muted-foreground"
                            aria-label="Repeats"
                        />
                    </span>
                    <span class="block truncate text-xs text-muted-foreground">
                        {{ when(event) }}
                    </span>
                </button>

                <RsvpControls :event="event" size="compact" class="mt-1.5" />
            </div>
        </div>

        <p
            v-if="pendingInvitations.length === 0"
            class="flex items-center justify-center gap-1.5 px-2.5 py-6 text-sm text-muted-foreground"
        >
            <MailQuestionMark class="size-3.5" /> Nothing waiting on you.
        </p>
    </div>
</template>
