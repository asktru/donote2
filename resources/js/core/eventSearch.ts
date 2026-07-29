/**
 * Finding an event by name, by who is on it, or by where it is.
 *
 * Ranking is by distance from the present moment rather than by match
 * quality: the thing you are looking for is nearly always the meeting either
 * side of right now, not the best string match three weeks out. Descriptions
 * are deliberately not searched — Meet boilerplate and pasted agendas match
 * almost anything and would drown the ranking.
 */

import { eventMoment } from '@/core/eventWindow';

/** How many rows the dialog will render. */
const DEFAULT_LIMIT = 50;

export interface SearchableAttendee {
    email: string;
    name: string | null;
}

export interface SearchableEvent {
    title: string;
    location: string | null;
    start: string;
    attendees: SearchableAttendee[];
}

/** Every string an event can be found by, lowercased. */
function haystack(event: SearchableEvent): string {
    const parts = [event.title, event.location ?? ''];

    for (const attendee of event.attendees) {
        parts.push(attendee.name ?? '', attendee.email);
    }

    return parts.join(' ').toLowerCase();
}

/** Matching events, nearest to `now` first. An empty query matches nothing. */
export function searchEvents<T extends SearchableEvent>(
    events: T[],
    query: string,
    now: Date,
    limit = DEFAULT_LIMIT,
): T[] {
    const needle = query.trim().toLowerCase();

    if (needle === '') {
        return [];
    }

    const at = now.getTime();

    return events
        .filter((event) => haystack(event).includes(needle))
        .sort((a, b) => {
            const aStart = eventMoment(a.start);
            const bStart = eventMoment(b.start);
            const byDistance = Math.abs(aStart - at) - Math.abs(bStart - at);

            if (byDistance !== 0) {
                return byDistance;
            }

            // Same distance: the one still to come is the likelier target.
            const aFuture = aStart >= at ? 0 : 1;
            const bFuture = bStart >= at ? 0 : 1;

            return aFuture - bFuture || a.title.localeCompare(b.title);
        })
        .slice(0, limit);
}
