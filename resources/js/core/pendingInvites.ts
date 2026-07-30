/**
 * Invitations still waiting on an answer.
 *
 * The list drives a red dot in the calendar header, so it has to be quiet:
 * an event you organized is not an invitation, a meeting that already
 * happened cannot be usefully answered, and a daily standup you were invited
 * to is one decision, not forty. Filtering by calendar visibility is the
 * caller's job — the store already owns that pipeline.
 */

import { eventHasPassed, eventMoment } from '@/core/eventWindow';

export interface InviteAttendee {
    response: string;
    organizer: boolean;
    self: boolean;
}

export interface PendingCandidate {
    allDay: boolean;
    start: string;
    end: string;
    responseStatus: string;
    seriesId: string | null;
    attendees: InviteAttendee[];
}

/** The current user's own attendee entry, when they are on the guest list. */
export function selfAttendee<T extends InviteAttendee>(
    attendees: T[],
): T | null {
    return attendees.find((attendee) => attendee.self) ?? null;
}

/** Whether the user can answer this event — invited, and not the organizer. */
export function isInvitation(event: PendingCandidate): boolean {
    const self = selfAttendee(event.attendees);

    return self !== null && !self.organizer;
}

/**
 * Unanswered invitations that are still ahead, one row per series, earliest
 * first.
 */
export function pendingInvites<T extends PendingCandidate>(
    events: T[],
    now: Date,
): T[] {
    const open = events.filter(
        (event) =>
            event.responseStatus === 'needsAction' &&
            !eventHasPassed(event, now) &&
            isInvitation(event),
    );

    const byStart = [...open].sort(
        (a, b) => eventMoment(a.start) - eventMoment(b.start),
    );

    const seenSeries = new Set<string>();

    // Sorted first, so the occurrence kept for a series is its earliest
    // remaining one.
    return byStart.filter((event) => {
        if (event.seriesId === null) {
            return true;
        }

        if (seenSeries.has(event.seriesId)) {
            return false;
        }

        seenSeries.add(event.seriesId);

        return true;
    });
}
