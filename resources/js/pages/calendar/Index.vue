<script setup lang="ts">
import { Head, Link, router, usePage } from '@inertiajs/vue3';
import {
    ChevronLeft,
    ChevronRight,
    Globe,
    Plus,
    SlidersHorizontal,
    Users,
    X,
} from '@lucide/vue';
import { addDays, startOfDay } from 'date-fns';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { toast } from 'vue-sonner';

import DirectoryAutocomplete from '@/components/calendar/DirectoryAutocomplete.vue';
import EventDetailPanel from '@/components/calendar/EventDetailPanel.vue';
import EventEditor from '@/components/calendar/EventEditor.vue';
import MonthView from '@/components/calendar/MonthView.vue';
import TimeGridView from '@/components/calendar/TimeGridView.vue';
import TimezonePicker from '@/components/calendar/TimezonePicker.vue';
import RecordingIndicator from '@/components/notes/RecordingIndicator.vue';
import ShortcutsDialog from '@/components/notes/ShortcutsDialog.vue';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSwipe } from '@/composables/useSwipe';
import { orderEvents, stepEvent, upcomingEvent } from '@/core/eventCursor';
import { occurrenceId } from '@/lib/dedupeEvents';
import {
    initNativeTabs,
    nativeTabsActive,
    reportNativeTab,
} from '@/lib/nativeTabs';
import type { NativeFabAction } from '@/lib/nativeTabs';
import { isMacDesktopShell, isNarrowViewport } from '@/lib/platform';
import {
    publishShareTargets,
    startShareInboxWatcher,
} from '@/lib/shareInbox';
import { zoneCity } from '@/lib/timezones';
import { cn } from '@/lib/utils';
import {
    anchor,
    anchorLabel,
    calendarList,
    calendarView,
    clearMeetWith,
    closeEventDetail,
    displayEvents,
    eventsFailed,
    goToday,
    hiddenCalendars,
    hideDeclined,
    hideEvent,
    initCalendarPrefs,
    meetWith,
    nextEventAfter,
    openEventDetail,
    openEventEditor,
    overlayEvents,
    secondZone,
    selectedEvent,
    setCalendarView,
    setHideDeclined,
    setSecondZone,
    showHidden,
    stepCalendar,
    toggleCalendar,
    toggleMeetWith,
    visibleRange,
    watchCalendarRange,
} from '@/stores/calendar';
import type { CalendarEvent } from '@/stores/calendar';
import { startReminderScheduler } from '@/stores/reminderScheduler';
import { setTeamMembers, teamMembers } from '@/stores/team';
import type { TeamMember } from '@/stores/team';
import { shortcutsOpen } from '@/stores/ui';
import { initWorkspace } from '@/stores/workspace';

const props = defineProps<{
    workspace: { teamSlug: string; teamName: string; userId: number };
    members: TeamMember[];
    googleConnected: boolean;
}>();

const views: { value: 'day' | 'week' | 'month'; label: string }[] = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
];

// A 7-column week grid is unusable at phone width, so Week is desktop/tablet
// only; phones get Day (default) + Month.
const isNarrow = ref(isNarrowViewport());

function onResize(): void {
    isNarrow.value = isNarrowViewport();
}

const availableViews = computed(() =>
    isNarrow.value ? views.filter((view) => view.value !== 'week') : views,
);

watch(
    isNarrow,
    (narrow) => {
        if (narrow && calendarView.value === 'week') {
            setCalendarView('day');
        }
    },
    { immediate: true },
);

// A refetch or a filter change can drop the selected event; don't leave the
// panel describing something that is no longer on screen. A refetch is also
// where a jumped-to event finally arrives.
watch(displayEvents, (events) => {
    if (pendingOccurrence.value !== null) {
        const arrived = events.find(
            (event) => occurrenceId(event) === pendingOccurrence.value,
        );

        if (arrived) {
            pendingOccurrence.value = null;
            openEventDetail(arrived);

            return;
        }
    }

    const selected = selectedEvent.value;

    if (!selected) {
        return;
    }

    const still = events.find(
        (event) => occurrenceId(event) === occurrenceId(selected),
    );

    if (!still) {
        closeEventDetail();
    } else if (still.key !== selected.key) {
        // Same meeting, different copy after a refetch — re-bind so the grid
        // can match the selection by key.
        openEventDetail(still);
    }
});

const supported = (
    Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
).supportedValuesOf;

const allZones: string[] = supported
    ? supported('timeZone')
    : ['Europe/Kyiv', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'];

const notesHref = computed(() => `/${props.workspace.teamSlug}/notes`);

/** Teammates (excluding me) whose schedules can be overlaid. */
const colleagues = computed(() =>
    teamMembers.value.filter(
        (member) => member.id !== props.workspace.userId && member.email,
    ),
);

function isMeeting(email: string): boolean {
    return meetWith.value.some((person) => person.email === email);
}

/** Team members not yet selected — quick-adds under the email field. */
const colleagueSuggestions = computed(() =>
    colleagues.value.filter((member) => !isMeeting(member.email)),
);

/** Add anyone the directory search returns (or a raw email). */
function addMeetPerson(email: string, name: string): void {
    if (!isMeeting(email)) {
        toggleMeetWith(email, name);
    }
}

const gridDays = computed<Date[]>(() => {
    const { start, end } = visibleRange.value;

    if (calendarView.value === 'day') {
        return [startOfDay(anchor.value)];
    }

    const days: Date[] = [];

    for (let d = start; d < end; d = addDays(d, 1)) {
        days.push(d);
    }

    return days;
});

function openEvent(event: CalendarEvent): void {
    openEventDetail(event);
}

function openDay(day: Date): void {
    anchor.value = startOfDay(day);
    setCalendarView('day');
}

const HOUR_MS = 60 * 60 * 1000;

const fabOpen = ref(false);
const meetPickerOpen = ref(false);
const timezonePickerOpen = ref(false);

/** The zone `Z` restores after switching the rail off. */
const lastSecondZone = ref<string | null>(secondZone.value);

/**
 * `Z` — show or hide the secondary time axis. With no zone ever chosen there
 * is nothing to toggle to, so open the picker instead.
 */
function toggleSecondZone(): void {
    if (secondZone.value !== null) {
        lastSecondZone.value = secondZone.value;
        setSecondZone(null);

        return;
    }

    if (lastSecondZone.value !== null) {
        setSecondZone(lastSecondZone.value);

        return;
    }

    timezonePickerOpen.value = true;
}

/** Picking from the dialog also updates what `Z` toggles back to. */
function onPickZone(zone: string | null): void {
    setSecondZone(zone);

    if (zone !== null) {
        lastSecondZone.value = zone;
    }
}

/** Tapping a slot: schedule a meeting with overlaid people, else a timeblock. */
function createAt(at: Date): void {
    const emails = meetWith.value.map((person) => person.email);

    openEventEditor({
        kind: emails.length > 0 ? 'meeting' : 'timeblock',
        start: at,
        end: new Date(at.getTime() + HOUR_MS),
        attendees: emails,
    });
}

/** A sensible default slot on the anchor day (next hour today, else 9am). */
function defaultSlot(): Date {
    const now = new Date();
    const onToday = startOfDay(anchor.value).getTime() === startOfDay(now).getTime();
    const at = startOfDay(anchor.value);
    at.setHours(onToday ? Math.min(now.getHours() + 1, 22) : 9, 0, 0, 0);

    return at;
}

/** FAB → "New timeblock": minimal event editor at the default slot. */
function newTimeblock(): void {
    fabOpen.value = false;
    openEventEditor({
        kind: 'timeblock',
        start: defaultSlot(),
        end: new Date(defaultSlot().getTime() + HOUR_MS),
        attendees: [],
    });
}

/** FAB → "Meet with…": pick people (overlay), then tap a slot to schedule. */
function startMeetWith(): void {
    fabOpen.value = false;
    meetPickerOpen.value = true;
}

/** The native tab bar's FAB menu routes its calendar actions here. */
function onNativeAction(event: Event): void {
    const action = (event as CustomEvent<{ id: NativeFabAction }>).detail.id;

    if (action === 'meet-with') {
        startMeetWith();
    } else if (action === 'timeblock') {
        newTimeblock();
    }
}

// Swipe left/right over the calendar body to step periods (phones).
useSwipe((swipe) => {
    if (swipe.direction !== 'left' && swipe.direction !== 'right') {
        return;
    }

    const el = swipe.target as HTMLElement | null;

    if (el && el.closest('[data-cal-body]')) {
        stepCalendar(swipe.direction === 'left' ? 1 : -1);
    }
});

/** What the cursor walks: the events actually on screen, yours only. */
const cursorEvents = computed(() => orderEvents(displayEvents.value));

function selectEvent(event: CalendarEvent | null): void {
    if (event) {
        openEventDetail(event);
    }
}

/**
 * An event we have jumped the view to, waiting for its day to load. Held by
 * occurrence rather than key: the copy that represents a meeting on several
 * calendars need not be the same object in two separate fetches.
 */
const pendingOccurrence = ref<string | null>(null);

/**
 * `N` — the next event from now. When the current view holds no future, look
 * past it: the next event is usually tomorrow morning, and refusing to leave
 * today makes the key useless exactly when it is most wanted.
 */
async function selectNextEvent(): Promise<void> {
    const now = new Date();
    const inView = upcomingEvent(cursorEvents.value, now);

    if (inView) {
        selectEvent(inView);

        return;
    }

    const ahead = await nextEventAfter(now);

    if (!ahead) {
        toast('Nothing else on the calendar in the next 60 days.');

        return;
    }

    // Show it straight away — the panel renders from the event itself — then
    // jump the view to its day. The watcher re-binds it to the copy the grid
    // ends up drawing, so the ring lands on the right block.
    openEventDetail(ahead);
    pendingOccurrence.value = occurrenceId(ahead);
    anchor.value = startOfDay(new Date(ahead.start));
}

/**
 * Hide the selected event, then move the cursor on — so H H H clears a run of
 * noise without reaching for the mouse.
 */
function hideSelected(scope: 'one' | 'series'): void {
    const current = selectedEvent.value;

    if (!current) {
        return;
    }

    const next = stepEvent(cursorEvents.value, current.key, 1, new Date());
    hideEvent(current, scope);

    if (next && next.key !== current.key) {
        selectEvent(next);
    } else {
        closeEventDetail();
    }
}

function onKeydown(event: KeyboardEvent): void {
    // Every bare key below is off-limits while the user is typing.
    const target = event.target as HTMLElement | null;
    const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

    // Esc — close the event details.
    if (event.key === 'Escape' && selectedEvent.value) {
        event.preventDefault();
        closeEventDetail();

        return;
    }

    // ⌘/ — the cheatsheet.
    if ((event.metaKey || event.ctrlKey) && event.key === '/') {
        event.preventDefault();
        shortcutsOpen.value = !shortcutsOpen.value;

        return;
    }

    // ⌘J — toggle the Meet-with panel (Vimcal parity). The panel handles the
    // empty case itself (directory search, a raw email field), so there is
    // nothing to gate on — the toolbar button never did either.
    if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'j'
    ) {
        event.preventDefault();
        fabOpen.value = false;
        meetPickerOpen.value = !meetPickerOpen.value;

        return;
    }

    // ⌘⌃1 Notes / ⌘⌃2 Calendar — switch top-level section.
    if (event.metaKey && event.ctrlKey && (event.key === '1' || event.key === '2')) {
        event.preventDefault();

        if (event.key === '1') {
            router.visit(notesHref.value);
        }

        return;
    }

    // ⌘1/2/3 — Day / Week / Month (calendar page only).
    if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
    ) {
        const view = { '1': 'day', '2': 'week', '3': 'month' }[event.key];

        if (view) {
            event.preventDefault();
            setCalendarView(view as 'day' | 'week' | 'month');
        }

        return;
    }

    if (typing || event.metaKey || event.ctrlKey || event.altKey) {
        return;
    }

    // Bare letters (Vimcal parity).
    const key = event.key.toLowerCase();

    if (!event.shiftKey && key === 't') {
        event.preventDefault();
        goToday();

        return;
    }

    const byLetter = { d: 'day', w: 'week', m: 'month' } as const;

    if (!event.shiftKey && key in byLetter) {
        event.preventDefault();
        setCalendarView(byLetter[key as keyof typeof byLetter]);

        return;
    }

    // j is down/forward, k is up/back — vim's directions, and Vimcal's.
    if (!event.shiftKey && (key === 'j' || key === 'k')) {
        event.preventDefault();
        stepCalendar(key === 'j' ? 1 : -1);

        return;
    }

    if (!event.shiftKey && key === 'c') {
        event.preventDefault();
        newTimeblock();

        return;
    }

    if (event.shiftKey && key === 'd') {
        event.preventDefault();
        setHideDeclined(!hideDeclined.value);

        return;
    }

    if (event.shiftKey && key === 'v') {
        event.preventDefault();
        showHidden.value = !showHidden.value;

        return;
    }

    if (!event.shiftKey && key === 'n') {
        event.preventDefault();
        void selectNextEvent();

        return;
    }

    if (key === 'h') {
        event.preventDefault();
        hideSelected(event.shiftKey ? 'series' : 'one');

        return;
    }

    if (event.key === 'Enter' && selectedEvent.value?.htmlLink) {
        event.preventDefault();
        window.open(selectedEvent.value.htmlLink, '_blank', 'noopener');

        return;
    }

    if (!event.shiftKey && key === 'z') {
        event.preventDefault();
        toggleSecondZone();

        return;
    }

    // ↑ / ↓ — walk the events in view.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        selectEvent(
            stepEvent(
                cursorEvents.value,
                selectedEvent.value?.key ?? null,
                event.key === 'ArrowDown' ? 1 : -1,
                new Date(),
            ),
        );

        return;
    }

    // ← / → — step to the previous / next period.
    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepCalendar(-1);
    } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepCalendar(1);
    }
}

onMounted(async () => {
    setTeamMembers(props.members);
    initCalendarPrefs(props.workspace.teamSlug);
    watchCalendarRange();
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', onResize);

    // Load cached notes and schedule reminder notifications even when the
    // Notes page was never opened this session (e.g. app launched here).
    await initWorkspace({
        teamSlug: props.workspace.teamSlug,
        userId: props.workspace.userId,
    });
    startReminderScheduler();
    publishShareTargets(usePage().props.teams ?? [], props.workspace.teamSlug);
    startShareInboxWatcher();
    initNativeTabs({ teamSlug: props.workspace.teamSlug, page: 'calendar' });
    reportNativeTab('calendar');
    window.addEventListener('donote:native-action', onNativeAction);
});

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('donote:native-action', onNativeAction);
});
</script>

<template>
    <Head title="Calendar" />

    <div
        data-native-tabs-pad
        class="flex h-dvh min-h-0 flex-col bg-background text-foreground pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
        <header
            :class="
                cn(
                    'flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 py-1.5 pr-3 sm:pr-4',
                    // Clear the macOS traffic lights in the Electron shell.
                    // Left padding is split out from a px-* shorthand: the
                    // responsive `sm:px-4` came later in the compiled CSS and
                    // overrode `pl-20` at desktop widths, putting the header
                    // back under the traffic lights.
                    isMacDesktopShell ? 'pl-20' : 'pl-3 sm:pl-4',
                )
            "
        >
            <nav class="flex items-center gap-1 text-sm">
                <Link
                    :href="notesHref"
                    class="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted/60 sm:px-2.5"
                >
                    Notes
                </Link>
                <span class="rounded-md bg-muted px-2 py-1 font-medium sm:px-2.5">
                    Calendar
                </span>
            </nav>

            <div class="flex items-center gap-0.5 sm:mx-2 sm:gap-1">
                <Button
                    variant="ghost"
                    size="icon"
                    class="size-8"
                    aria-label="Previous"
                    @click="stepCalendar(-1)"
                >
                    <ChevronLeft class="size-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    class="size-8"
                    aria-label="Next"
                    @click="stepCalendar(1)"
                >
                    <ChevronRight class="size-4" />
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    class="ml-1 h-8 px-2.5 text-xs sm:px-3"
                    @click="goToday"
                >
                    Today
                </Button>
            </div>

            <h1 class="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
                {{ anchorLabel }}
            </h1>

            <div class="ml-auto flex items-center gap-1.5 sm:gap-2">
                <Button
                    v-if="googleConnected"
                    variant="ghost"
                    size="icon"
                    :class="
                        cn(
                            'size-8',
                            meetWith.length > 0 || meetPickerOpen
                                ? 'text-primary'
                                : 'text-muted-foreground',
                        )
                    "
                    aria-label="Meet with"
                    title="Meet with — overlay a colleague's schedule (⌘J)"
                    @click="meetPickerOpen = !meetPickerOpen"
                >
                    <Users class="size-4" />
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                        <Button
                            variant="ghost"
                            size="icon"
                            class="size-8 text-muted-foreground"
                            aria-label="Calendar options"
                            title="Show / hide calendars and events"
                        >
                            <SlidersHorizontal class="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-64">
                        <DropdownMenuLabel
                            class="text-[11px] tracking-wide text-muted-foreground uppercase"
                        >
                            Filters
                        </DropdownMenuLabel>
                        <DropdownMenuCheckboxItem
                            :model-value="hideDeclined"
                            @select.prevent
                            @update:model-value="setHideDeclined($event)"
                        >
                            <span class="min-w-0 flex-1">Hide declined events</span>
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                            :model-value="showHidden"
                            @select.prevent
                            @update:model-value="showHidden = $event"
                        >
                            <span class="min-w-0 flex-1">Show hidden events</span>
                        </DropdownMenuCheckboxItem>

                        <template v-if="calendarList.length > 0">
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel
                                class="text-[11px] tracking-wide text-muted-foreground uppercase"
                            >
                                Calendars
                            </DropdownMenuLabel>
                            <DropdownMenuCheckboxItem
                                v-for="calendar in calendarList"
                                :key="calendar.id"
                                :model-value="!hiddenCalendars.has(calendar.id)"
                                @select.prevent
                                @update:model-value="toggleCalendar(calendar.id)"
                            >
                                <span
                                    class="mr-1.5 inline-block size-2 shrink-0 rounded-full"
                                    :style="{
                                        backgroundColor: calendar.color ?? 'var(--primary)',
                                    }"
                                />
                                <span class="min-w-0 flex-1 truncate">{{
                                    calendar.name
                                }}</span>
                                <span class="ml-2 text-[10px] text-muted-foreground">
                                    {{ calendar.source }}
                                </span>
                            </DropdownMenuCheckboxItem>
                        </template>
                    </DropdownMenuContent>
                </DropdownMenu>

                <button
                    v-if="calendarView !== 'month'"
                    type="button"
                    class="hidden items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted/60 sm:flex"
                    title="Secondary timezone (Z)"
                    @click="timezonePickerOpen = true"
                >
                    <Globe class="size-3.5" />
                    {{ secondZone ? zoneCity(secondZone) : 'Add timezone' }}
                </button>

                <div
                    class="flex items-center rounded-lg border border-border/60 p-0.5"
                >
                    <button
                        v-for="view in availableViews"
                        :key="view.value"
                        type="button"
                        :class="
                            cn(
                                'rounded-md px-3 py-1 text-xs font-medium',
                                calendarView === view.value
                                    ? 'bg-muted text-foreground'
                                    : 'text-muted-foreground hover:text-foreground',
                            )
                        "
                        @click="setCalendarView(view.value)"
                    >
                        {{ view.label }}
                    </button>
                </div>
            </div>
        </header>

        <div class="flex min-h-0 flex-1 overflow-hidden">
        <div class="min-h-0 flex-1 overflow-hidden px-2 py-1" data-cal-body>
            <p
                v-if="!googleConnected"
                class="border-b border-border/40 px-2 py-1.5 text-xs text-muted-foreground"
            >
                Connect Google Calendar in
                <Link href="/settings/integrations" class="underline"
                    >Settings</Link
                >
                to see your events.
            </p>
            <p
                v-if="eventsFailed"
                class="px-2 py-1.5 text-xs text-destructive"
            >
                Couldn't load events.
            </p>

            <MonthView
                v-if="calendarView === 'month'"
                :days="gridDays"
                :anchor-month="anchor.getMonth()"
                :events="displayEvents"
                :show-hidden="showHidden"
                :selected-key="selectedEvent?.key ?? null"
                @open-event="openEvent"
                @open-day="openDay"
            />
            <TimeGridView
                v-else
                :days="gridDays"
                :events="displayEvents"
                :second-zone="secondZone"
                :show-hidden="showHidden"
                :overlays="overlayEvents"
                :hide-header="isNarrow && calendarView === 'day'"
                :selected-key="selectedEvent?.key ?? null"
                @open-event="openEvent"
                @create-at="createAt"
            />
        </div>

            <EventDetailPanel />
        </div>

        <div
            v-if="googleConnected && !meetPickerOpen && !nativeTabsActive"
            class="fixed right-5 bottom-[calc(1.25rem+var(--bottom-chrome))] z-40 flex flex-col items-end gap-2"
        >
            <template v-if="fabOpen">
                <button
                    type="button"
                    class="flex items-center gap-2 rounded-full border border-border/60 bg-background px-3.5 py-2 text-sm font-medium shadow-lg hover:bg-muted/60"
                    @click="startMeetWith"
                >
                    <Users class="size-4" /> Meet with…
                </button>
                <button
                    type="button"
                    class="flex items-center gap-2 rounded-full border border-border/60 bg-background px-3.5 py-2 text-sm font-medium shadow-lg hover:bg-muted/60"
                    @click="newTimeblock"
                >
                    <Plus class="size-4" /> New timeblock
                </button>
            </template>
            <button
                type="button"
                :class="
                    cn(
                        'flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-105',
                        fabOpen && 'rotate-45',
                    )
                "
                aria-label="Create"
                @click="fabOpen = !fabOpen"
            >
                <Plus class="size-6" />
            </button>
        </div>

        <!--
            Meet-with is a non-blocking docked panel (not a modal): overlaid
            schedules stay visible so people can be added/removed while
            reading availability, then a slot tap schedules the meeting.
        -->
        <div
            v-if="meetPickerOpen"
            class="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-40 rounded-xl border border-border/60 bg-background/95 shadow-2xl backdrop-blur sm:inset-x-auto sm:top-auto sm:bottom-[calc(0.5rem+var(--bottom-chrome))] sm:left-1/2 sm:w-[26rem] sm:-translate-x-1/2"
        >
            <div class="flex items-center justify-between px-3.5 pt-3 pb-1">
                <div class="flex items-center gap-1.5 text-sm font-semibold">
                    <Users class="size-4" /> Meet with
                </div>
                <button
                    type="button"
                    class="rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    aria-label="Close meet-with"
                    @click="meetPickerOpen = false"
                >
                    <X class="size-4" />
                </button>
            </div>
            <p class="px-3.5 pb-2 text-xs text-muted-foreground">
                Their schedule overlays the grid — tap a time slot to schedule.
            </p>

            <div class="space-y-3 px-3.5 pb-3">
                <div v-if="meetWith.length > 0" class="flex flex-wrap gap-1">
                    <span
                        v-for="person in meetWith"
                        :key="person.email"
                        class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                    >
                        <span
                            class="size-2 shrink-0 rounded-full"
                            :style="{ backgroundColor: person.color }"
                        />
                        {{ person.name }}
                        <button
                            type="button"
                            class="text-muted-foreground hover:text-foreground"
                            aria-label="Remove"
                            @click="toggleMeetWith(person.email, person.name)"
                        >
                            <X class="size-3" />
                        </button>
                    </span>
                </div>

                <DirectoryAutocomplete @add="addMeetPerson" />

                <div v-if="colleagueSuggestions.length > 0">
                    <p class="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                        From your team
                    </p>
                    <div class="flex flex-wrap gap-1">
                        <button
                            v-for="member in colleagueSuggestions"
                            :key="member.email"
                            type="button"
                            class="rounded-full border border-border/70 px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/60"
                            @click="toggleMeetWith(member.email, member.name)"
                        >
                            + {{ member.name }}
                        </button>
                    </div>
                </div>
            </div>

            <div
                v-if="meetWith.length > 0"
                class="flex justify-end border-t border-border/60 px-3 py-2"
            >
                <Button variant="ghost" size="sm" @click="clearMeetWith">
                    Clear everyone
                </Button>
            </div>
        </div>

        <EventEditor />
        <ShortcutsDialog page="calendar" />
        <TimezonePicker
            v-model:open="timezonePickerOpen"
            :zones="allZones"
            :current="secondZone"
            @select="onPickZone"
        />
        <RecordingIndicator />
    </div>
</template>
