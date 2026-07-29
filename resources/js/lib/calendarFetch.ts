/**
 * Fetching calendar events from the two sources — the Google proxy and the
 * native Apple bridge — and normalizing them into one shape.
 *
 * This sits below both the calendar store and the cached horizon, which each
 * need to fetch a range. Keeping it a leaf module is what stops those two
 * from importing each other.
 */

import { apiFetch } from '@/lib/api';
import { appleCalendar } from '@/lib/appleCalendar';

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
    /** A per-event custom color (Google's event palette); null = calendar's. */
    eventColor: string | null;
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
    event_color?: string | null;
    all_day: boolean;
    start: string | null;
    end: string | null;
    recurring_event_id: string | null;
    response_status: RsvpStatus;
    attendees: EventAttendee[];
}

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
        eventColor: dto.event_color ?? null,
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

async function fetchApple(
    startIso: string,
    endIso: string,
): Promise<CalendarEvent[]> {
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
            eventColor: null,
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

/**
 * Every event in `[start, end)` from both sources. Google failures degrade to
 * an empty list rather than rejecting: an Apple-only machine, or a revoked
 * Google token, should still show the device calendar.
 */
export async function fetchEventRange(
    start: Date,
    end: Date,
): Promise<CalendarEvent[]> {
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const [google, apple] = await Promise.all([
        apiFetch<{ events: GoogleEventDto[] }>(
            `/api/google/events?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`,
        )
            .then((res) =>
                res.events
                    .map(mapGoogle)
                    .filter((event): event is CalendarEvent => event !== null),
            )
            .catch(() => [] as CalendarEvent[]),
        fetchApple(startIso, endIso),
    ]);

    // Google first, so dedupe keeps the copy that has a click-through link.
    return [...google, ...apple];
}
