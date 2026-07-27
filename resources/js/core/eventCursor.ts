/**
 * Moving a cursor through the events on screen. The cursor is the selected
 * event — the one the detail panel is showing — so this only has to answer
 * which event comes next, in an order that matches how the grid reads: by
 * start time across the whole visible range, not down one day's column.
 */

/** The shape the cursor needs; the store's CalendarEvent satisfies it. */
export interface CursorEvent {
    key: string;
    /** ISO start, or a bare YYYY-MM-DD for an all-day event. */
    start: string;
    title: string;
}

/** The events of a range in the order the cursor walks them. */
export function orderEvents<T extends CursorEvent>(events: T[]): T[] {
    return [...events].sort(
        (a, b) =>
            new Date(a.start).getTime() - new Date(b.start).getTime() ||
            a.title.localeCompare(b.title),
    );
}

/**
 * The first event starting at or after `now`, or null when the range holds no
 * future. Answers only from what it is given — the caller decides whether to
 * look further afield.
 */
export function upcomingEvent<T extends CursorEvent>(
    events: T[],
    now: Date,
): T | null {
    return (
        orderEvents(events).find(
            (event) => new Date(event.start).getTime() >= now.getTime(),
        ) ?? null
    );
}

/**
 * The first event starting at or after `now`, falling back to the first in
 * range when the view holds no future — somewhere to land when the arrow keys
 * start with nothing selected.
 */
export function nextFromNow<T extends CursorEvent>(
    events: T[],
    now: Date,
): T | null {
    return upcomingEvent(events, now) ?? orderEvents(events)[0] ?? null;
}

/**
 * The event one step from the current selection. With nothing selected (or a
 * selection that has gone out of range) it starts from now: forwards picks the
 * next upcoming event, backwards the last in range. It stops at the ends
 * rather than wrapping — wrapping a week view teleports you from Friday
 * evening to Monday morning with nothing to explain it.
 */
export function stepEvent<T extends CursorEvent>(
    events: T[],
    currentKey: string | null,
    direction: 1 | -1,
    now: Date,
): T | null {
    const ordered = orderEvents(events);

    if (ordered.length === 0) {
        return null;
    }

    const index =
        currentKey === null
            ? -1
            : ordered.findIndex((event) => event.key === currentKey);

    if (index === -1) {
        return direction === 1
            ? nextFromNow(events, now)
            : (ordered[ordered.length - 1] ?? null);
    }

    return ordered[Math.min(ordered.length - 1, Math.max(0, index + direction))];
}
