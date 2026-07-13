<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { ChevronLeft, ChevronRight, Globe, SlidersHorizontal } from '@lucide/vue';
import { addDays, startOfDay } from 'date-fns';
import { computed, onMounted } from 'vue';

import MonthView from '@/components/calendar/MonthView.vue';
import TimeGridView from '@/components/calendar/TimeGridView.vue';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
    anchor,
    anchorLabel,
    calendarList,
    calendarView,
    eventsFailed,
    goToday,
    hiddenCalendars,
    initCalendarPrefs,
    secondZone,
    setCalendarView,
    setSecondZone,
    stepCalendar,
    toggleCalendar,
    visibleEvents,
    visibleRange,
    watchCalendarRange,
} from '@/stores/calendar';
import type { CalendarEvent } from '@/stores/calendar';
import { setTeamMembers } from '@/stores/team';
import type { TeamMember } from '@/stores/team';

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
    if (event.htmlLink) {
        window.open(event.htmlLink, '_blank', 'noopener');
    }
}

function openDay(day: Date): void {
    anchor.value = startOfDay(day);
    setCalendarView('day');
}

onMounted(() => {
    setTeamMembers(props.members);
    initCalendarPrefs(props.workspace.teamSlug);
    watchCalendarRange();
});
</script>

<template>
    <Head title="Calendar" />

    <div class="flex h-screen min-h-0 flex-col bg-background text-foreground">
        <header
            class="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4"
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
                <DropdownMenu v-if="calendarList.length > 0">
                    <DropdownMenuTrigger as-child>
                        <Button
                            variant="ghost"
                            size="icon"
                            class="size-8 text-muted-foreground"
                            aria-label="Choose calendars"
                            title="Show / hide calendars"
                        >
                            <SlidersHorizontal class="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-64">
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
                :events="visibleEvents"
                @open-event="openEvent"
                @open-day="openDay"
            />
            <TimeGridView
                v-else
                :days="gridDays"
                :events="visibleEvents"
                :second-zone="secondZone"
                @open-event="openEvent"
            />
        </div>
    </div>
</template>
