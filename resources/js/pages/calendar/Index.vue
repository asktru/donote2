<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
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

import EventDetailPanel from '@/components/calendar/EventDetailPanel.vue';
import EventEditor from '@/components/calendar/EventEditor.vue';
import MonthView from '@/components/calendar/MonthView.vue';
import TimeGridView from '@/components/calendar/TimeGridView.vue';
import RecordingIndicator from '@/components/notes/RecordingIndicator.vue';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSwipe } from '@/composables/useSwipe';
import { isMacDesktopShell, isNarrowViewport } from '@/lib/platform';
import { cn } from '@/lib/utils';
import {
    anchor,
    anchorLabel,
    calendarList,
    calendarView,
    clearMeetWith,
    displayEvents,
    eventsFailed,
    goToday,
    hiddenCalendars,
    hideDeclined,
    initCalendarPrefs,
    meetWith,
    openEventDetail,
    openEventEditor,
    overlayEvents,
    secondZone,
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

const supported = (
    Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
).supportedValuesOf;

const allZones: string[] = supported
    ? supported('timeZone')
    : ['Europe/Kyiv', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'];

const zones: { value: string; label: string }[] = [
    { value: '', label: 'No 2nd zone' },
    ...allZones.map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') })),
];

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

function personColor(email: string): string | null {
    return meetWith.value.find((person) => person.email === email)?.color ?? null;
}

/** Team members not yet selected — quick-adds under the email field. */
const colleagueSuggestions = computed(() =>
    colleagues.value.filter((member) => !isMeeting(member.email)),
);

const meetEmailInput = ref('');

/** Add any Google Workspace colleague by email (not just Donote members). */
function addMeetEmail(): void {
    const email = meetEmailInput.value.trim().toLowerCase();

    if (email.includes('@') && !isMeeting(email)) {
        const member = teamMembers.value.find((entry) => entry.email === email);
        toggleMeetWith(email, member?.name ?? email);
    }

    meetEmailInput.value = '';
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

function onKeydown(event: KeyboardEvent): void {
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

    // ← / → — step to the previous / next period (ignore while typing).
    const target = event.target as HTMLElement | null;
    const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement;

    if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            stepCalendar(-1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            stepCalendar(1);
        }
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
});

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', onResize);
});
</script>

<template>
    <Head title="Calendar" />

    <div
        class="flex h-dvh min-h-0 flex-col bg-background text-foreground pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
        <header
            :class="
                cn(
                    'flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3 py-1.5 sm:px-4',
                    // Clear the macOS traffic lights in the Electron shell.
                    isMacDesktopShell && 'pl-20',
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
                <DropdownMenu v-if="colleagues.length > 0">
                    <DropdownMenuTrigger as-child>
                        <Button
                            variant="ghost"
                            size="icon"
                            :class="
                                cn(
                                    'size-8',
                                    meetWith.length > 0
                                        ? 'text-primary'
                                        : 'text-muted-foreground',
                                )
                            "
                            aria-label="Meet with"
                            title="Meet with — overlay a colleague's schedule"
                        >
                            <Users class="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-64">
                        <DropdownMenuLabel
                            class="text-[11px] tracking-wide text-muted-foreground uppercase"
                        >
                            Meet with
                        </DropdownMenuLabel>
                        <DropdownMenuCheckboxItem
                            v-for="member in colleagues"
                            :key="member.email"
                            :model-value="isMeeting(member.email)"
                            @select.prevent
                            @update:model-value="
                                toggleMeetWith(member.email, member.name)
                            "
                        >
                            <span
                                class="mr-1.5 inline-block size-2 shrink-0 rounded-full border border-border"
                                :style="{
                                    backgroundColor:
                                        personColor(member.email) ??
                                        'transparent',
                                    borderColor: personColor(member.email) ?? undefined,
                                }"
                            />
                            <span class="min-w-0 flex-1 truncate">{{
                                member.name
                            }}</span>
                        </DropdownMenuCheckboxItem>
                        <template v-if="meetWith.length > 0">
                            <DropdownMenuSeparator />
                            <DropdownMenuItem @select="clearMeetWith">
                                Clear meet-with
                            </DropdownMenuItem>
                        </template>
                    </DropdownMenuContent>
                </DropdownMenu>

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

                <label
                    v-if="calendarView !== 'month'"
                    class="hidden items-center gap-1 text-xs text-muted-foreground sm:flex"
                >
                    <Globe class="size-3.5" />
                    <select
                        :value="secondZone ?? ''"
                        class="rounded-md border border-border/60 bg-background px-1.5 py-1 text-xs"
                        @change="
                            setSecondZone(
                                ($event.target as HTMLSelectElement).value || null,
                            )
                        "
                    >
                        <option
                            v-for="zone in zones"
                            :key="zone.value"
                            :value="zone.value"
                        >
                            {{ zone.label }}
                        </option>
                    </select>
                </label>

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
                @open-event="openEvent"
                @create-at="createAt"
            />
        </div>

        <div
            v-if="googleConnected"
            class="fixed right-5 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-end gap-2"
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

        <Dialog v-model:open="meetPickerOpen">
            <DialogContent class="max-w-xs gap-0 p-0">
                <DialogHeader class="px-5 pt-5 pb-2">
                    <DialogTitle>Meet with</DialogTitle>
                    <DialogDescription class="text-xs">
                        Their schedule overlays the calendar — tap a time slot
                        to schedule a meeting.
                    </DialogDescription>
                </DialogHeader>
                <div class="max-h-[60vh] space-y-3 overflow-y-auto px-4 pb-3">
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
                                @click="toggleMeetWith(person.email, person.name)"
                            >
                                <X class="size-3" />
                            </button>
                        </span>
                    </div>

                    <input
                        v-model="meetEmailInput"
                        type="email"
                        autocapitalize="off"
                        autocorrect="off"
                        placeholder="Colleague's email…"
                        class="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
                        @keydown.enter.prevent="addMeetEmail"
                    />

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
                <div class="flex justify-end gap-2 border-t border-border/60 p-3">
                    <Button variant="ghost" size="sm" @click="clearMeetWith">
                        Clear
                    </Button>
                    <Button size="sm" @click="meetPickerOpen = false">Done</Button>
                </div>
            </DialogContent>
        </Dialog>

        <EventDetailPanel />
        <EventEditor />
        <RecordingIndicator />
    </div>
</template>
