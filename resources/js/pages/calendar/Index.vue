<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { ChevronLeft, ChevronRight, Globe, SlidersHorizontal } from '@lucide/vue';
import { addDays, startOfDay } from 'date-fns';
import { computed, onBeforeUnmount, onMounted } from 'vue';

import EventDetailPanel from '@/components/calendar/EventDetailPanel.vue';
import MonthView from '@/components/calendar/MonthView.vue';
import TimeGridView from '@/components/calendar/TimeGridView.vue';
import RecordingIndicator from '@/components/notes/RecordingIndicator.vue';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isMacDesktopShell } from '@/lib/platform';
import { cn } from '@/lib/utils';
import {
    anchor,
    anchorLabel,
    calendarList,
    calendarView,
    displayEvents,
    eventsFailed,
    goToday,
    hiddenCalendars,
    hideDeclined,
    initCalendarPrefs,
    openEventDetail,
    secondZone,
    setCalendarView,
    setHideDeclined,
    setSecondZone,
    showHidden,
    stepCalendar,
    toggleCalendar,
    visibleRange,
    watchCalendarRange,
} from '@/stores/calendar';
import type { CalendarEvent } from '@/stores/calendar';
import { startReminderScheduler } from '@/stores/reminderScheduler';
import { setTeamMembers } from '@/stores/team';
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
                    'flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4',
                    // Clear the macOS traffic lights in the Electron shell.
                    isMacDesktopShell && 'pl-20',
                )
            "
        >
            <nav class="flex items-center gap-1 text-sm">
                <Link
                    :href="notesHref"
                    class="rounded-md px-2.5 py-1 text-muted-foreground hover:bg-muted/60"
                >
                    Notes
                </Link>
                <span class="rounded-md bg-muted px-2.5 py-1 font-medium">
                    Calendar
                </span>
            </nav>

            <div class="mx-2 flex items-center gap-1">
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
                    class="ml-1 h-8 px-3 text-xs"
                    @click="goToday"
                >
                    Today
                </Button>
            </div>

            <h1 class="text-base font-semibold">{{ anchorLabel }}</h1>

            <div class="ml-auto flex items-center gap-2">
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
                    class="flex items-center gap-1 text-xs text-muted-foreground"
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
                        v-for="view in views"
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

        <div class="min-h-0 flex-1 overflow-hidden px-2 py-1">
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
                @open-event="openEvent"
            />
        </div>

        <EventDetailPanel />
        <RecordingIndicator />
    </div>
</template>
