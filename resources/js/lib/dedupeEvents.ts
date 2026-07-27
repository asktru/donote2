/**
 * Collapse events that describe the same occurrence — identical title, start,
 * and end — into a single entry, the way Fantastical and Vimcal do. The same
 * meeting frequently lands on more than one calendar (or in both Google and
 * Apple), and showing it once is far less noisy.
 *
 * The first event of each group wins, so callers should order the input by
 * source preference (e.g. Google before Apple, to keep a click-through link).
 */

/**
 * Normalize a start/end value to a stable key part. Timed events from
 * different sources encode the same instant differently (e.g.
 * `2026-07-13T07:00:00-04:00` from Google vs `2026-07-13T11:00:00Z` from
 * Apple), so compare by epoch when parseable, else by the raw string.
 */
function normalizeMoment(value: string | null): string {
    if (value === null || value === '') {
        return '';
    }

    const epoch = Date.parse(value);

    return Number.isNaN(epoch) ? value : String(epoch);
}

/**
 * What makes two entries the same occurrence, independent of which calendar
 * or source they came from. Use this to match an event across two separate
 * fetches, where the copy that represents the group may differ.
 */
export function occurrenceId(event: {
    title: string;
    start: string | null;
    end: string | null;
}): string {
    return `${event.title.trim()}|${normalizeMoment(event.start)}|${normalizeMoment(event.end)}`;
}

export function dedupeEvents<
    T extends { title: string; start: string | null; end: string | null },
>(events: T[]): T[] {
    const seen = new Set<string>();
    const result: T[] = [];

    for (const event of events) {
        const key = occurrenceId(event);

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(event);
    }

    return result;
}
