import { dedupeEvents } from '@/lib/dedupeEvents';

/**
 * Which events a user actually sees, as one pipeline.
 *
 * The order matters and is the whole reason this is a single function:
 * filtering *before* deduping means a meeting that sits on both a hidden and a
 * visible calendar is represented by the visible copy. Dedupe first and the
 * hidden copy can win the group and then be filtered away — losing the event,
 * or keeping a different copy (with a different key) than the grid shows.
 * Two code paths doing this in different orders disagree about which copy of
 * an event is "the" one, which breaks anything matching them up by key.
 */

export interface VisibilityRules {
    /** Calendars switched off in the sidebar. */
    isCalendarHidden: (calendarId: string) => boolean;
    /** The "hide declined events" filter. */
    hideDeclined: boolean;
    /** Individually hidden events / series. */
    isHidden: (event: { calendarId: string }) => boolean;
}

export interface VisibleEvent {
    calendarId: string;
    responseStatus: string;
    title: string;
    start: string;
    end: string;
}

/**
 * Filter, then collapse duplicates, then flag the individually hidden ones —
 * they still render (as a thin strip), so they are marked rather than removed.
 */
export function visibleEvents<T extends VisibleEvent>(
    events: T[],
    rules: VisibilityRules,
): (T & { hidden: boolean })[] {
    const onVisibleCalendars = events.filter(
        (event) => !rules.isCalendarHidden(event.calendarId),
    );
    const filtered = rules.hideDeclined
        ? onVisibleCalendars.filter(
              (event) => event.responseStatus !== 'declined',
          )
        : onVisibleCalendars;

    return dedupeEvents(filtered).map((event) => ({
        ...event,
        hidden: rules.isHidden(event),
    }));
}
