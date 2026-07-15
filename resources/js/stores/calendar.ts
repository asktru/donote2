import { addDays, addMonths, addWeeks, endOfWeek, format, startOfDay, startOfWeek } from 'date-fns';
import { computed, ref, watch } from 'vue';

import { apiFetch } from '@/lib/api';
import { appleCalendar } from '@/lib/appleCalendar';
import { dedupeEvents } from '@/lib/dedupeEvents';

export type CalendarViewKind = 'day' | 'week' | 'month';

export type RsvpStatus = 'accepted' | 'declined' | 'tentative' | 'needsAction';

export interface EventAttendee {
    email: string;
    name: string | null;
    response: RsvpStatus;
    organizer: boolean;
    self: boolean;
}

/** One event on the calendar, normalized across Google and Apple. */
export interface CalendarEvent {
    key: string;
    source: 'google' | 'apple';
    calendarId: string;
    calendarName: string;
    accountEmail: string;
    title: string;
    description: string | null;
    location: string | null;
    color: string | null;
    allDay: boolean;
    /** ISO start; for all-day events a bare YYYY-MM-DD. */
    start: string;
    /** ISO end; for all-day events the exclusive end date. */
    end: string;
    htmlLink: string | null;
    hangoutLink: string | null;
    /** The id shared by every occurrence of a repeating series, if any. */
    seriesId: string | null;
    /** The current user's RSVP to this event. */
    responseStatus: RsvpStatus;
    attendees: EventAttendee[];
}

interface GoogleEventDto {
    id: string;
    calendar_id: string;
    calendar_name: string;
    account_email: string;
    summary: string;
    description: string | null;
    location: string | null;
    html_link: string | null;
    hangout_link: string | null;
    color: string | null;
    all_day: boolean;
    start: string | null;
    end: string | null;
    recurring_event_id: string | null;
    response_status: RsvpStatus;
    attendees: EventAttendee[];
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
        accountEmail: dto.account_email,
        title: dto.summary || '(no title)',
        description: dto.description,
        location: dto.location,
        color: dto.color,
        allDay: dto.all_day,
        start: dto.start,
        end: dto.end,
        htmlLink: dto.html_link,
        hangoutLink: dto.hangout_link,
        seriesId: dto.recurring_event_id,
        responseStatus: dto.response_status ?? 'accepted',
        attendees: dto.attendees ?? [],
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
            accountEmail: '',
            title: event.title,
            description: null,
            location: event.location,
            color: colorById.get(event.calendarId) ?? null,
            allDay: event.allDay,
            start: event.start,
            end: event.end,
            htmlLink: null,
            hangoutLink: null,
            seriesId: event.seriesId,
            responseStatus: 'accepted' as const,
            attendees: [],
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

/* ---- Meet with (colleague overlays) --------------------------------- */

export interface MeetWithPerson {
    email: string;
    name: string;
    color: string;
}

/** A colleague's calendar entry overlaid on the grid. */
export interface OverlayEvent {
    key: string;
    personEmail: string;
    personName: string;
    color: string;
    title: string;
    allDay: boolean;
    start: string;
    end: string;
    /** false when only free/busy is available (no titles). */
    shared: boolean;
}

const MEET_COLORS = [
    '#f97316',
    '#0ea5e9',
    '#a855f7',
    '#22c55e',
    '#ec4899',
    '#eab308',
];

export const meetWith = ref<MeetWithPerson[]>([]);
export const overlayEvents = ref<OverlayEvent[]>([]);
export const overlayLoading = ref(false);

/** Add/remove a colleague, reassigning stable colors by position. */
export function toggleMeetWith(email: string, name: string): void {
    const present = meetWith.value.some((person) => person.email === email);
    const next = present
        ? meetWith.value.filter((person) => person.email !== email)
        : [...meetWith.value, { email, name, color: '' }];

    meetWith.value = next.map((person, index) => ({
        ...person,
        color: MEET_COLORS[index % MEET_COLORS.length],
    }));
}

export function clearMeetWith(): void {
    meetWith.value = [];
    overlayEvents.value = [];
}

interface OverlayDto {
    shared: boolean;
    events?: {
        id: string | null;
        summary: string;
        all_day: boolean;
        start: string | null;
        end: string | null;
    }[];
    busy?: { start: string; end: string }[];
}

let overlaySeq = 0;

/** Fetch each selected colleague's schedule for the visible range. */
export async function fetchOverlays(): Promise<void> {
    const people = meetWith.value;

    if (people.length === 0) {
        overlayEvents.value = [];

        return;
    }

    const { start, end } = visibleRange.value;
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const seq = ++overlaySeq;

    overlayLoading.value = true;

    try {
        const results = await Promise.all(
            people.map((person) =>
                apiFetch<OverlayDto>(
                    `/api/google/overlay?email=${encodeURIComponent(person.email)}&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`,
                )
                    .then((dto) => ({ person, dto }))
                    .catch(() => null),
            ),
        );

        if (seq !== overlaySeq) {
            return;
        }

        const mapped: OverlayEvent[] = [];

        for (const result of results) {
            if (result === null) {
                continue;
            }

            const { person, dto } = result;

            if (dto.shared && dto.events) {
                for (const event of dto.events) {
                    if (event.start === null || event.end === null) {
                        continue;
                    }

                    mapped.push({
                        key: `overlay:${person.email}:${event.id ?? event.start}`,
                        personEmail: person.email,
                        personName: person.name,
                        color: person.color,
                        title: event.summary || 'Busy',
                        allDay: event.all_day,
                        start: event.start,
                        end: event.end,
                        shared: true,
                    });
                }
            } else if (dto.busy) {
                dto.busy.forEach((slot, index) => {
                    mapped.push({
                        key: `overlay:${person.email}:busy:${index}`,
                        personEmail: person.email,
                        personName: person.name,
                        color: person.color,
                        title: 'Busy',
                        allDay: false,
                        start: slot.start,
                        end: slot.end,
                        shared: false,
                    });
                });
            }
        }

        overlayEvents.value = mapped;
    } finally {
        if (seq === overlaySeq) {
            overlayLoading.value = false;
        }
    }
}

/* ---- Event creation & availability ---------------------------------- */

export interface BusyInterval {
    start: string;
    end: string;
}

/** Free/busy for a set of invitees (meeting availability preview). */
export async function fetchInviteeBusy(
    emails: string[],
    start: string,
    end: string,
): Promise<Record<string, BusyInterval[]>> {
    if (emails.length === 0) {
        return {};
    }

    const res = await apiFetch<{ busy: Record<string, BusyInterval[]> }>(
        '/api/google/freebusy',
        { method: 'POST', body: JSON.stringify({ emails, start, end }) },
    );

    return res.busy ?? {};
}

export interface DirectoryPerson {
    name: string;
    email: string;
}

/** Search the Google Workspace directory (invitee autocomplete). */
export async function searchDirectory(
    query: string,
): Promise<DirectoryPerson[]> {
    try {
        const res = await apiFetch<{ people: DirectoryPerson[] }>(
            `/api/google/directory?q=${encodeURIComponent(query)}`,
        );

        return res.people ?? [];
    } catch {
        return [];
    }
}

export interface NewEventInput {
    calendarId: string;
    summary: string;
    description: string | null;
    location: string | null;
    allDay: boolean;
    start: string;
    end: string;
    attendees: string[];
    addMeet: boolean;
}

/** Create an event on a Google calendar, then refresh the grid. */
export async function createEvent(input: NewEventInput): Promise<void> {
    await apiFetch('/api/google/events', {
        method: 'POST',
        body: JSON.stringify({
            calendar_id: input.calendarId,
            summary: input.summary,
            description: input.description,
            location: input.location,
            all_day: input.allDay,
            start: input.start,
            end: input.end,
            attendees: input.attendees,
            add_meet: input.addMeet,
        }),
    });

    await fetchEvents();
}

/** A pending "new event" draft that opens the editor when set. */
export interface EventDraft {
    /** 'meeting' shows invitees/availability/Meet; 'timeblock' is minimal. */
    kind: 'meeting' | 'timeblock';
    start: Date;
    end: Date;
    attendees: string[];
}

export const eventDraft = ref<EventDraft | null>(null);

export function openEventEditor(draft: EventDraft): void {
    eventDraft.value = draft;
}

export function closeEventEditor(): void {
    eventDraft.value = null;
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

    loadHidePrefs(teamSlug);
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

/* ---- Declined filter + hidden events (per team) --------------------- */

const HIDE_DECLINED_PREFIX = 'donote:calendar:hide-declined:';
const HIDDEN_EVENTS_PREFIX = 'donote:calendar:hidden-events:';

/** Drop events the user has declined entirely. */
export const hideDeclined = ref(false);
/** Keys of hidden events/series (declutter). Session reveal via showHidden. */
export const hiddenEventKeys = ref<Set<string>>(new Set());
/** Session-only: reveal hidden events (shown dimmed instead of as a strip). */
export const showHidden = ref(false);

function loadHidePrefs(teamSlug: string): void {
    try {
        hideDeclined.value = localStorage.getItem(HIDE_DECLINED_PREFIX + teamSlug) === '1';
        const raw = localStorage.getItem(HIDDEN_EVENTS_PREFIX + teamSlug);
        hiddenEventKeys.value = new Set(Array.isArray(JSON.parse(raw ?? 'null')) ? JSON.parse(raw!) : []);
    } catch {
        hideDeclined.value = false;
        hiddenEventKeys.value = new Set();
    }
}

export function setHideDeclined(value: boolean): void {
    hideDeclined.value = value;

    if (prefsTeam) {
        localStorage.setItem(HIDE_DECLINED_PREFIX + prefsTeam, value ? '1' : '0');
    }
}

/** The stored key for hiding a single event vs a whole repeating series. */
function hideKeyFor(event: CalendarEvent, scope: 'one' | 'series'): string {
    return scope === 'series' && event.seriesId
        ? `series:${event.seriesId}`
        : `one:${event.key}`;
}

export function isEventHidden(event: CalendarEvent): boolean {
    return (
        hiddenEventKeys.value.has(`one:${event.key}`) ||
        (event.seriesId !== null && hiddenEventKeys.value.has(`series:${event.seriesId}`))
    );
}

export function hideEvent(event: CalendarEvent, scope: 'one' | 'series'): void {
    const next = new Set(hiddenEventKeys.value);
    next.add(hideKeyFor(event, scope));
    hiddenEventKeys.value = next;
    persistHiddenEvents();
}

export function unhideEvent(event: CalendarEvent): void {
    const next = new Set(hiddenEventKeys.value);
    next.delete(`one:${event.key}`);

    if (event.seriesId !== null) {
        next.delete(`series:${event.seriesId}`);
    }

    hiddenEventKeys.value = next;
    persistHiddenEvents();
}

function persistHiddenEvents(): void {
    if (prefsTeam) {
        localStorage.setItem(
            HIDDEN_EVENTS_PREFIX + prefsTeam,
            JSON.stringify([...hiddenEventKeys.value]),
        );
    }
}

export interface DisplayEvent extends CalendarEvent {
    hidden: boolean;
}

/**
 * Events actually shown: switched-off calendars removed, declined dropped when
 * requested, de-duplicated (Google wins), and annotated with `hidden` so the
 * views can render decluttered events as a thin strip.
 */
export const displayEvents = computed<DisplayEvent[]>(() => {
    const base = events.value.filter(
        (event) => !hiddenCalendars.value.has(event.calendarId),
    );
    const filtered = hideDeclined.value
        ? base.filter((event) => event.responseStatus !== 'declined')
        : base;

    return dedupeEvents(filtered).map((event) => ({
        ...event,
        hidden: isEventHidden(event),
    }));
});

/** Currently open event in the detail panel, if any. */
export const selectedEvent = ref<CalendarEvent | null>(null);

export function openEventDetail(event: CalendarEvent): void {
    selectedEvent.value = event;
}

export function closeEventDetail(): void {
    selectedEvent.value = null;
}

/** Refetch whenever the visible range changes (view switch or navigation). */
export function watchCalendarRange(): void {
    watch(
        () => [visibleRange.value.start.getTime(), visibleRange.value.end.getTime()],
        () => {
            void fetchEvents();
            void fetchOverlays();
        },
        { immediate: true },
    );
    watch(meetWith, () => void fetchOverlays());
}
