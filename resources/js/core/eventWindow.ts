/**
 * Range arithmetic for calendar events, shared by the grid, the cached
 * horizon, and search.
 *
 * Events arrive in two shapes: timed events carry a full ISO instant, all-day
 * events a bare `YYYY-MM-DD` with an *exclusive* end date. `Date.parse` reads
 * a bare date as UTC midnight, which drifts a whole day against the
 * local-midnight boundaries the views use — so bare dates are parsed as local
 * midnight here and everything downstream compares plain epoch numbers.
 */

/** The window the app keeps cached, in weeks either side of now. */
export const HORIZON_WEEKS = 4;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface WindowEvent {
    start: string;
    end: string;
}

export interface DateRange {
    start: Date;
    end: Date;
}

/** Epoch ms for an event boundary, reading bare dates as local midnight. */
export function eventMoment(value: string): number {
    if (DATE_ONLY.test(value)) {
        const [year, month, day] = value.split('-').map(Number);

        return new Date(year, month - 1, day).getTime();
    }

    return Date.parse(value);
}

/** Events overlapping `[range.start, range.end)` — the end is exclusive. */
export function eventsInRange<T extends WindowEvent>(
    events: T[],
    range: DateRange,
): T[] {
    const from = range.start.getTime();
    const to = range.end.getTime();

    return events.filter((event) => {
        const start = eventMoment(event.start);
        const end = eventMoment(event.end);

        return start < to && end > from;
    });
}

/** Whether `inner` sits entirely within `outer`. */
export function rangeCovers(outer: DateRange, inner: DateRange): boolean {
    return (
        outer.start.getTime() <= inner.start.getTime() &&
        outer.end.getTime() >= inner.end.getTime()
    );
}

/** The cached window around `now`. */
export function horizonRange(now: Date, weeks = HORIZON_WEEKS): DateRange {
    return {
        start: new Date(now.getTime() - weeks * WEEK_MS),
        end: new Date(now.getTime() + weeks * WEEK_MS),
    };
}
