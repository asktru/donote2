<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { CalendarPlus, Eye, EyeOff, SlidersHorizontal } from '@lucide/vue';
import { format } from 'date-fns';
import { computed, onMounted, ref, watch } from 'vue';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { keyRange, kindOfKey } from '@/core/dates';
import { apiFetch } from '@/lib/api';
import { appleCalendar } from '@/lib/appleCalendar';
import type { AppleCalendar, AppleCalendarStatus } from '@/lib/appleCalendar';
import { isMacDesktopShell } from '@/lib/platform';
import { cn } from '@/lib/utils';
import {
    disabledCalendars,
    hiddenEvents,
    hideEvent,
    loadEventPrefs,
    showHiddenEvents,
    toggleCalendar,
    unhideEvent,
} from '@/stores/eventPrefs';
import { currentView } from '@/stores/ui';

const props = defineProps<{
    googleConnected: boolean;
}>();

interface GoogleEvent {
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

/** One event row regardless of source. */
interface UnifiedEvent {
    key: string;
    hideKey: string;
    source: 'google' | 'apple';
    title: string;
    location: string | null;
    color: string | null;
    allDay: boolean;
    start: string | null;
    htmlLink: string | null;
    calendarTitle: string;
    calendarId: string | null;
}

const googleEvents = ref<UnifiedEvent[]>([]);
const appleEvents = ref<UnifiedEvent[]>([]);
const appleStatus = ref<AppleCalendarStatus | null>(null);
const appleCalendars = ref<AppleCalendar[]>([]);
const loading = ref(false);
const failed = ref(false);

/** The day whose events we show — follows the selected calendar note. */
const range = computed(() => {
    if (
        currentView.value.kind === 'calendar' &&
        kindOfKey(currentView.value.dateKey) === 'daily'
    ) {
        return keyRange(currentView.value.dateKey);
    }

    return keyRange(format(new Date(), 'yyyy-MM-dd'));
});

const rangeLabel = computed(() => format(range.value.start, 'EEE, MMM d'));

const appleConnected = computed(() => appleStatus.value === 'authorized');
const appleAvailable = computed(() => appleCalendar !== null);

/** Where to re-enable calendar access differs between macOS and iOS. */
const deniedHint = computed(() =>
    isMacDesktopShell
        ? 'Calendar access is off — enable Donote in System Settings → Privacy & Security → Calendars.'
        : 'Calendar access is off — enable Donote in Settings → Privacy & Security → Calendars.',
);
const anySourceConnected = computed(
    () => props.googleConnected || appleConnected.value,
);

/**
 * Repeating Google instances carry ids like `{seriesId}_{occurrence}`, so
 * hiding by the prefix hides the whole series — matching Apple's seriesId.
 */
function googleHideKey(event: GoogleEvent): string {
    return `google:${event.calendar_id}:${event.id.split('_')[0]}`;
}

async function loadGoogle(): Promise<void> {
    if (!props.googleConnected || !navigator.onLine) {
        googleEvents.value = [];

        return;
    }

    const response = await apiFetch<{ events: GoogleEvent[] }>(
        `/api/google/events?start=${range.value.start.toISOString()}&end=${range.value.end.toISOString()}`,
    );

    googleEvents.value = response.events.map((event) => ({
        key: `google:${event.calendar_id}:${event.id}`,
        hideKey: googleHideKey(event),
        source: 'google' as const,
        title: event.summary,
        location: event.location,
        color: event.color,
        allDay: event.all_day,
        start: event.start,
        htmlLink: event.html_link,
        calendarTitle: event.calendar_name,
        calendarId: null,
    }));
}

async function loadApple(): Promise<void> {
    if (appleCalendar === null || !appleConnected.value) {
        appleEvents.value = [];

        return;
    }

    const colorByCalendar = new Map(
        appleCalendars.value.map((calendar) => [calendar.id, calendar.color]),
    );

    const rawEvents = await appleCalendar.events(
        range.value.start.toISOString(),
        range.value.end.toISOString(),
    );

    appleEvents.value = rawEvents.map((event) => ({
        key: `apple:${event.id}`,
        hideKey: `apple:${event.seriesId}`,
        source: 'apple' as const,
        title: event.title,
        location: event.location,
        color: colorByCalendar.get(event.calendarId) ?? null,
        allDay: event.allDay,
        start: event.start,
        htmlLink: null,
        calendarTitle: event.calendarTitle,
        calendarId: event.calendarId,
    }));
}

const events = computed<UnifiedEvent[]>(() => {
    const merged = [
        ...googleEvents.value,
        ...appleEvents.value.filter(
            (event) =>
                event.calendarId === null ||
                !disabledCalendars.value.has(event.calendarId),
        ),
    ];

    return merged.sort((a, b) => {
        if (a.allDay !== b.allDay) {
            return a.allDay ? -1 : 1;
        }

        return (a.start ?? '').localeCompare(b.start ?? '');
    });
});

const visibleEvents = computed(() =>
    showHiddenEvents.value
        ? events.value
        : events.value.filter((event) => !hiddenEvents.value.has(event.hideKey)),
);

async function load(): Promise<void> {
    loading.value = true;
    failed.value = false;

    try {
        await Promise.all([loadGoogle(), loadApple()]);
    } catch {
        failed.value = true;
    } finally {
        loading.value = false;
    }
}

async function refreshAppleStatus(): Promise<void> {
    if (appleCalendar === null) {
        return;
    }

    try {
        const { status } = await appleCalendar.status();
        appleStatus.value = status;

        if (status === 'authorized') {
            appleCalendars.value = await appleCalendar.calendars();
        }
    } catch {
        appleStatus.value = 'unknown';
    }
}

async function connectApple(): Promise<void> {
    if (appleCalendar === null) {
        return;
    }

    try {
        await appleCalendar.requestAccess();
    } finally {
        await refreshAppleStatus();
        await load();
    }
}

function timeLabel(event: UnifiedEvent): string {
    if (event.allDay || event.start === null) {
        return 'all-day';
    }

    return format(new Date(event.start), 'h:mmaaa').toLowerCase();
}

function isHidden(event: UnifiedEvent): boolean {
    return hiddenEvents.value.has(event.hideKey);
}

onMounted(async () => {
    loadEventPrefs();
    await refreshAppleStatus();
    await load();
});

watch(() => range.value.start.getTime(), load);
</script>

<template>
    <div>
        <div class="flex items-center justify-between pb-1.5">
            <p
                class="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
            >
                Events · {{ rangeLabel }}
            </p>
            <DropdownMenu v-if="appleConnected || hiddenEvents.size > 0">
                <DropdownMenuTrigger as-child>
                    <Button
                        variant="ghost"
                        size="icon"
                        class="size-5 text-muted-foreground"
                        aria-label="Event settings"
                    >
                        <SlidersHorizontal class="size-3.5" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-60">
                    <template v-if="appleConnected">
                        <DropdownMenuLabel
                            class="text-[11px] tracking-wide text-muted-foreground uppercase"
                        >
                            Apple calendars
                        </DropdownMenuLabel>
                        <DropdownMenuCheckboxItem
                            v-for="calendar in appleCalendars"
                            :key="calendar.id"
                            :model-value="!disabledCalendars.has(calendar.id)"
                            @select.prevent
                            @update:model-value="toggleCalendar(calendar.id)"
                        >
                            <span
                                class="mr-1.5 inline-block size-2 shrink-0 rounded-full"
                                :style="{
                                    backgroundColor:
                                        calendar.color ?? 'var(--primary)',
                                }"
                            />
                            <span class="min-w-0 flex-1 truncate">
                                {{ calendar.title }}
                            </span>
                            <span
                                class="ml-2 text-[10px] text-muted-foreground"
                            >
                                {{ calendar.source }}
                            </span>
                        </DropdownMenuCheckboxItem>
                    </template>
                    <template v-if="hiddenEvents.size > 0">
                        <DropdownMenuSeparator v-if="appleConnected" />
                        <DropdownMenuCheckboxItem
                            :model-value="showHiddenEvents"
                            @select.prevent
                            @update:model-value="
                                showHiddenEvents = !showHiddenEvents
                            "
                        >
                            Show hidden events ({{ hiddenEvents.size }})
                        </DropdownMenuCheckboxItem>
                    </template>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>

        <div
            v-if="!anySourceConnected"
            class="rounded-lg border border-dashed border-border/70 p-3 text-center"
        >
            <p class="text-xs text-muted-foreground">
                See your calendar events here.
            </p>
            <div class="mt-2 flex flex-col items-center gap-1.5">
                <button
                    v-if="appleAvailable && appleStatus === 'notDetermined'"
                    type="button"
                    class="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    @click="connectApple"
                >
                    <CalendarPlus class="size-3.5" /> Connect Apple Calendar
                </button>
                <p
                    v-else-if="appleAvailable && appleStatus === 'denied'"
                    class="text-[11px] text-muted-foreground"
                >
                    {{ deniedHint }}
                </p>
                <Link
                    v-if="!googleConnected"
                    href="/settings/integrations"
                    :class="
                        cn(
                            'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium',
                            appleAvailable && appleStatus === 'notDetermined'
                                ? 'text-muted-foreground hover:text-foreground'
                                : 'bg-primary text-primary-foreground hover:bg-primary/90',
                        )
                    "
                >
                    <CalendarPlus class="size-3.5" /> Connect Google Calendar
                </Link>
            </div>
        </div>

        <template v-else>
            <div
                v-if="loading && visibleEvents.length === 0"
                class="space-y-1.5"
            >
                <div class="h-8 animate-pulse rounded-md bg-muted/60"></div>
                <div class="h-8 animate-pulse rounded-md bg-muted/40"></div>
            </div>

            <p v-else-if="failed" class="px-1 text-xs text-muted-foreground">
                Couldn't load events.
            </p>
            <p
                v-else-if="visibleEvents.length === 0"
                class="px-1 text-xs text-muted-foreground"
            >
                No events.
            </p>

            <div v-else class="space-y-1">
                <component
                    :is="event.htmlLink !== null ? 'a' : 'div'"
                    v-for="event in visibleEvents"
                    :key="event.key"
                    v-bind="
                        event.htmlLink !== null
                            ? {
                                  href: event.htmlLink,
                                  target: '_blank',
                                  rel: 'noopener',
                              }
                            : {}
                    "
                    :class="
                        cn(
                            'group flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60',
                            isHidden(event) && 'opacity-50',
                        )
                    "
                >
                    <span
                        class="mt-1 h-8 w-1 shrink-0 rounded-full"
                        :style="{
                            backgroundColor: event.color ?? 'var(--primary)',
                        }"
                    />
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-xs font-medium">{{
                            event.title
                        }}</span>
                        <span class="block text-[11px] text-muted-foreground">
                            {{ timeLabel(event)
                            }}<template v-if="event.location">
                                · {{ event.location }}</template
                            >
                        </span>
                    </span>
                    <button
                        v-if="isHidden(event)"
                        type="button"
                        class="mt-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                        title="Unhide event"
                        aria-label="Unhide event"
                        @click.prevent.stop="unhideEvent(event.hideKey)"
                    >
                        <Eye class="size-3.5" />
                    </button>
                    <button
                        v-else
                        type="button"
                        class="mt-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                        title="Hide event (a repeating event hides the whole series)"
                        aria-label="Hide event"
                        @click.prevent.stop="
                            hideEvent(event.hideKey, event.title)
                        "
                    >
                        <EyeOff class="size-3.5" />
                    </button>
                </component>
            </div>
        </template>
    </div>
</template>
