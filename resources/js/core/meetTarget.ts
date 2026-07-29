/**
 * Which meeting ⌘⇧J should join.
 *
 * The shortcut fires from anywhere in macOS, often while the app is not even
 * visible, so it has to be predictable: the call you are in, or the one about
 * to start. The one-hour bound is what keeps it from opening tomorrow's
 * standup when today is over.
 */

import { eventMoment } from '@/core/eventWindow';

/** How far ahead a not-yet-started meeting still counts as "now". */
export const MEET_LOOKAHEAD_MS = 60 * 60 * 1000;

export interface MeetCandidate {
    start: string;
    end: string;
    allDay: boolean;
    hangoutLink: string | null;
    /** The user's own RSVP; a declined meeting is not one they are joining. */
    responseStatus?: string | null;
}

/** Timed events that actually have somewhere to join. */
function joinable<T extends MeetCandidate>(events: T[]): T[] {
    return events.filter(
        (event) =>
            !event.allDay &&
            event.responseStatus !== 'declined' &&
            event.hangoutLink !== null &&
            event.hangoutLink !== '',
    );
}

function byStart<T extends MeetCandidate>(events: T[]): T[] {
    return [...events].sort(
        (a, b) => eventMoment(a.start) - eventMoment(b.start),
    );
}

/**
 * The meeting in progress, else the soonest starting within the hour, else
 * null — the caller says "no upcoming Meet link" rather than guessing.
 */
export function pickMeetEvent<T extends MeetCandidate>(
    events: T[],
    now: Date,
): T | null {
    const at = now.getTime();
    const candidates = byStart(joinable(events));

    const inProgress = candidates.find(
        (event) => eventMoment(event.start) <= at && eventMoment(event.end) > at,
    );

    if (inProgress) {
        return inProgress;
    }

    return (
        candidates.find((event) => {
            const start = eventMoment(event.start);

            return start > at && start - at <= MEET_LOOKAHEAD_MS;
        }) ?? null
    );
}
