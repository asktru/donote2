<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { CalendarPlus } from '@lucide/vue';
import { format } from 'date-fns';
import { computed, ref, watch } from 'vue';

import { keyRange, kindOfKey } from '@/core/dates';
import { apiFetch } from '@/lib/api';
import { currentView } from '@/stores/ui';

const props = defineProps<{
    googleConnected: boolean;
}>();

interface CalendarEvent {
    id: string;
    calendar_id: string;
    calendar_name: string;
    account_email: string;
    summary: string;
    location: string | null;
    html_link: string | null;
    color: string | null;
    all_day: boolean;
    start: string | null;
    end: string | null;
}

const events = ref<CalendarEvent[]>([]);
const loading = ref(false);
const failed = ref(false);

/** The day (or period) whose events we show — follows the selected calendar note. */
const range = computed(() => {
    if (
        currentView.value.kind === 'calendar' &&
        kindOfKey(currentView.value.dateKey) === 'daily'
    ) {
        return keyRange(currentView.value.dateKey);
    }

    const today = new Date();

    return keyRange(format(today, 'yyyy-MM-dd'));
});

const rangeLabel = computed(() => format(range.value.start, 'EEE, MMM d'));

async function load(): Promise<void> {
    if (!props.googleConnected || !navigator.onLine) {
        return;
    }

    loading.value = true;
    failed.value = false;

    try {
        const response = await apiFetch<{ events: CalendarEvent[] }>(
            `/api/google/events?start=${range.value.start.toISOString()}&end=${range.value.end.toISOString()}`,
        );
        events.value = response.events;
    } catch {
        failed.value = true;
    } finally {
        loading.value = false;
    }
}

watch(() => range.value.start.getTime(), load, { immediate: true });

function timeLabel(event: CalendarEvent): string {
    if (event.all_day || event.start === null) {
        return 'all-day';
    }

    return format(new Date(event.start), 'h:mmaaa').toLowerCase();
}
</script>

<template>
    <div>
        <p
            class="px-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
        >
            Events · {{ rangeLabel }}
        </p>

        <div
            v-if="!googleConnected"
            class="rounded-lg border border-dashed border-border/70 p-3 text-center"
        >
            <p class="text-xs text-muted-foreground">
                See your Google Calendar events here.
            </p>
            <Link
                href="/settings/integrations"
                class="mt-2 inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
                <CalendarPlus class="size-3.5" /> Connect Google Calendar
            </Link>
        </div>

        <template v-else>
            <div v-if="loading && events.length === 0" class="space-y-1.5">
                <div class="h-8 animate-pulse rounded-md bg-muted/60"></div>
                <div class="h-8 animate-pulse rounded-md bg-muted/40"></div>
            </div>

            <p v-else-if="failed" class="px-1 text-xs text-muted-foreground">
                Couldn't load events.
            </p>
            <p
                v-else-if="events.length === 0"
                class="px-1 text-xs text-muted-foreground"
            >
                No events.
            </p>

            <div v-else class="space-y-1">
                <a
                    v-for="event in events"
                    :key="`${event.calendar_id}:${event.id}`"
                    :href="event.html_link ?? '#'"
                    target="_blank"
                    rel="noopener"
                    class="flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60"
                >
                    <span
                        class="mt-1 h-8 w-1 shrink-0 rounded-full"
                        :style="{
                            backgroundColor: event.color ?? 'var(--primary)',
                        }"
                    />
                    <span class="min-w-0">
                        <span class="block truncate text-xs font-medium">{{
                            event.summary
                        }}</span>
                        <span class="block text-[11px] text-muted-foreground">
                            {{ timeLabel(event)
                            }}<template v-if="event.location">
                                · {{ event.location }}</template
                            >
                        </span>
                    </span>
                </a>
            </div>
        </template>
    </div>
</template>
