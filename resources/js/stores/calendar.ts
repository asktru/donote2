import { addDays, addMonths, addWeeks, endOfWeek, format, startOfDay, startOfWeek } from 'date-fns';
import { computed, ref, watch } from 'vue';

import { apiFetch } from '@/lib/api';
import { appleCalendar } from '@/lib/appleCalendar';
import { dedupeEvents } from '@/lib/dedupeEvents';

export type CalendarViewKind = 'day' | 'week' | 'month';

/** One event on the calendar, normalized across Google and Apple. */
export interface CalendarEvent {
    key: string;
    source: 'google' | 'apple';
    calendarId: string;
    calendarName: string;
    title: string;
    location: string | null;
    color: string | null;
    allDay: boolean;
    /** ISO start; for all-day events a bare YYYY-MM-DD. */
    start: string;
    /** ISO end; for all-day events the exclusive end date. */
    end: string;
    htmlLink: string | null;
}

interface GoogleEventDto {
    id: string;
    calendar_id: string;
    calendar_name: string;
    summary: string;
    location: string | null;
    html_link: string | null;
    color: string | null;
    all_day: boolean;
    start: string | null;
    end: string | null;
}

/** Weeks start on Monday, matching the app's ISO-week date math elsewhere. */
const WEEK_STARTS_ON = 1;

export const calendarView = ref<CalendarViewKind>('week');

/** The day the current view is anchored on (local midnight). */
export const anchor = ref<Date>(startOfDay(new Date()));

const SECOND_ZONE_KEY = 'donote:calendar:second-zone';

/** Optional IANA zone shown as a secondary axis in the week/day grid. */
export const secondZone = ref<string | null>(
    typeof localStorage !== 'undefined'
        ? localStorage.getItem(SECOND_ZONE_KEY)
        : null,
);

export function setSecondZone(zone: string | null): void {
    secondZone.value = zone;

    if (typeof localStorage !== 'undefined') {
        if (zone) {
            localStorage.setItem(SECOND_ZONE_KEY, zone);
        } else {
            localStorage.removeItem(SECOND_ZONE_KEY);
        }
    }
}

export function setCalendarView(view: CalendarViewKind): void {
    calendarView.value = view;
}

export function goToday(): void {
    anchor.value = startOfDay(new Date());
}

/** Move one period (day/week/month) forward (+1) or back (-1). */
export function stepCalendar(delta: number): void {
    const current = anchor.value;

    anchor.value =
        calendarView.value === 'day'
            ? addDays(current, delta)
            : calendarView.value === 'week'
              ? addWeeks(current, delta)
              : addMonths(current, delta);
}

/** The [start, end) day range the current view covers. */
export const visibleRange = computed<{ start: Date; end: Date }>(() => {
    const day = startOfDay(anchor.value);

    if (calendarView.value === 'day') {
        return { start: day, end: addDays(day, 1) };
    }

    if (calendarView.value === 'week') {
        const start = startOfWeek(day, { weekStartsOn: WEEK_STARTS_ON });

        return { start, end: addDays(start, 7) };
    }

    // Month view shows whole weeks around the anchor's month.
    const monthStart = new Date(day.getFullYear(), day.getMonth(), 1);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON });
    const monthEnd = new Date(day.getFullYear(), day.getMonth() + 1, 0);
    const gridEnd = addDays(endOfWeek(monthEnd, { weekStartsOn: WEEK_STARTS_ON }), 1);

    return { start: gridStart, end: gridEnd };
});

export const anchorLabel = computed<string>(() => {
    const day = anchor.value;

    if (calendarView.value === 'month') {
        return format(day, 'MMMM yyyy');
    }

    if (calendarView.value === 'day') {
        return format(day, 'EEE, MMM d, yyyy');
    }

    const start = startOfWeek(day, { weekStartsOn: WEEK_STARTS_ON });
    const end = addDays(start, 6);
    const sameMonth = start.getMonth() === end.getMonth();

    return sameMonth
        ? `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`
        : `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
});

/* ---- Events ---------------------------------------------------------- */

export const events = ref<CalendarEvent[]>([]);
export const eventsLoading = ref(false);
export const eventsFailed = ref(false);

/** Monotonic guard so a slow response can't overwrite a newer range. */
let requestSeq = 0;

function mapGoogle(dto: GoogleEventDto): CalendarEvent | null {
    if (dto.start === null || dto.end === null) {
        return null;
    }

    return {
        key: `google:${dto.calendar_id}:${dto.id}`,
        source: 'google',
        calendarId: dto.calendar_id,
        calendarName: dto.calendar_name,
        title: dto.summary || '(no title)',
        location: dto.location,
        color: dto.color,
        allDay: dto.all_day,
        start: dto.start,
        end: dto.end,
        htmlLink: dto.html_link,
    };
}

async function fetchApple(startIso: string, endIso: string): Promise<CalendarEvent[]> {
    if (appleCalendar === null) {
        return [];
    }

    try {
        const { status } = await appleCalendar.status();

        if (status !== 'authorized') {
            return [];
        }

        const calendars = await appleCalendar.calendars();
        const colorById = new Map(calendars.map((c) => [c.id, c.color]));
        const raw = await appleCalendar.events(startIso, endIso);

        return raw.map((event) => ({
            key: `apple:${event.id}`,
            source: 'apple' as const,
            calendarId: event.calendarId,
            calendarName: event.calendarTitle,
            title: event.title,
            location: event.location,
            color: colorById.get(event.calendarId) ?? null,
            allDay: event.allDay,
            start: event.start,
            end: event.end,
            htmlLink: null,
        }));
    } catch {
        return [];
    }
}

/** Load events for the currently visible range from Google + Apple. */
export async function fetchEvents(): Promise<void> {
    const { start, end } = visibleRange.value;
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const seq = ++requestSeq;

    eventsLoading.value = true;
    eventsFailed.value = false;

    try {
        const [google, apple] = await Promise.all([
            apiFetch<{ events: GoogleEventDto[] }>(
                `/api/google/events?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`,
            )
                .then((res) => res.events.map(mapGoogle).filter((e): e is CalendarEvent => e !== null))
                .catch(() => [] as CalendarEvent[]),
            fetchApple(startIso, endIso),
        ]);

        if (seq !== requestSeq) {
            return;
        }

        events.value = [...google, ...apple];
    } catch {
        if (seq === requestSeq) {
            eventsFailed.value = true;
            events.value = [];
        }
    } finally {
        if (seq === requestSeq) {
            eventsLoading.value = false;
        }
    }
}

/* ---- Calendar visibility (per team) --------------------------------- */

const HIDDEN_CALS_PREFIX = 'donote:calendar:hidden-cals:';

/** Calendar ids the user has switched off in this team's calendar view. */
export const hiddenCalendars = ref<Set<string>>(new Set());
let prefsTeam: string | null = null;

export function initCalendarPrefs(teamSlug: string): void {
    prefsTeam = teamSlug;

    try {
        const raw = localStorage.getItem(HIDDEN_CALS_PREFIX + teamSlug);
        hiddenCalendars.value = new Set(Array.isArray(JSON.parse(raw ?? 'null')) ? JSON.parse(raw!) : []);
    } catch {
        hiddenCalendars.value = new Set();
    }
}

export function toggleCalendar(id: string): void {
    const next = new Set(hiddenCalendars.value);

    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }

    hiddenCalendars.value = next;

    if (prefsTeam) {
        localStorage.setItem(HIDDEN_CALS_PREFIX + prefsTeam, JSON.stringify([...next]));
    }
}

export interface CalendarSource {
    id: string;
    name: string;
    color: string | null;
    source: 'google' | 'apple';
}

/** The distinct calendars present in the loaded range, for the picker. */
export const calendarList = computed<CalendarSource[]>(() => {
    const map = new Map<string, CalendarSource>();

    for (const event of events.value) {
        if (!map.has(event.calendarId)) {
            map.set(event.calendarId, {
                id: event.calendarId,
                name: event.calendarName || 'Calendar',
                color: event.color,
                source: event.source,
            });
        }
    }

    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
});

/**
 * Events actually shown: switched-off calendars removed, then de-duplicated
 * (Google wins over Apple, since Google events are listed first).
 */
export const visibleEvents = computed<CalendarEvent[]>(() =>
    dedupeEvents(
        events.value.filter((event) => !hiddenCalendars.value.has(event.calendarId)),
    ),
);

/** Refetch whenever the visible range changes (view switch or navigation). */
export function watchCalendarRange(): void {
    watch(
        () => [visibleRange.value.start.getTime(), visibleRange.value.end.getTime()],
        () => void fetchEvents(),
        { immediate: true },
    );
}
