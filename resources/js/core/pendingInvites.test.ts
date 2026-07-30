import { describe, expect, it } from 'vitest';

import { pendingInvites } from '@/core/pendingInvites';
import type { PendingCandidate } from '@/core/pendingInvites';

const NOW = new Date('2026-07-15T12:00:00Z');

function invite(
    start: string,
    extra: Partial<PendingCandidate> = {},
): PendingCandidate {
    return {
        allDay: extra.allDay ?? false,
        start,
        end: extra.end ?? start,
        responseStatus: extra.responseStatus ?? 'needsAction',
        seriesId: extra.seriesId ?? null,
        attendees: extra.attendees ?? [
            { response: 'accepted', organizer: true, self: false },
            { response: 'needsAction', organizer: false, self: true },
        ],
    };
}

describe('pendingInvites', () => {
    it('keeps an unanswered invitation that is still ahead', () => {
        const event = invite('2026-07-15T14:00:00Z', {
            end: '2026-07-15T15:00:00Z',
        });

        expect(pendingInvites([event], NOW)).toEqual([event]);
    });

    it('drops invitations that have already ended', () => {
        const event = invite('2026-07-15T09:00:00Z', {
            end: '2026-07-15T10:00:00Z',
        });

        expect(pendingInvites([event], NOW)).toEqual([]);
    });

    it('keeps an event that started but has not ended', () => {
        const event = invite('2026-07-15T11:30:00Z', {
            end: '2026-07-15T12:30:00Z',
        });

        expect(pendingInvites([event], NOW)).toHaveLength(1);
    });

    it('drops events that already carry an answer', () => {
        const answered = ['accepted', 'declined', 'tentative'].map((status) =>
            invite('2026-07-15T14:00:00Z', {
                end: '2026-07-15T15:00:00Z',
                responseStatus: status,
            }),
        );

        expect(pendingInvites(answered, NOW)).toEqual([]);
    });

    it('drops events the user organized', () => {
        const event = invite('2026-07-15T14:00:00Z', {
            end: '2026-07-15T15:00:00Z',
            attendees: [
                { response: 'needsAction', organizer: true, self: true },
                { response: 'needsAction', organizer: false, self: false },
            ],
        });

        expect(pendingInvites([event], NOW)).toEqual([]);
    });

    it('drops events with no attendee entry for the user', () => {
        const event = invite('2026-07-15T14:00:00Z', {
            end: '2026-07-15T15:00:00Z',
            attendees: [],
        });

        expect(pendingInvites([event], NOW)).toEqual([]);
    });

    it('collapses a series to its earliest remaining occurrence', () => {
        const second = invite('2026-07-17T09:00:00Z', {
            end: '2026-07-17T09:15:00Z',
            seriesId: 'standup',
        });
        const first = invite('2026-07-16T09:00:00Z', {
            end: '2026-07-16T09:15:00Z',
            seriesId: 'standup',
        });

        expect(pendingInvites([second, first], NOW)).toEqual([first]);
    });

    it('keeps distinct series separate', () => {
        const standup = invite('2026-07-16T09:00:00Z', {
            end: '2026-07-16T09:15:00Z',
            seriesId: 'standup',
        });
        const retro = invite('2026-07-16T15:00:00Z', {
            end: '2026-07-16T16:00:00Z',
            seriesId: 'retro',
        });

        expect(pendingInvites([retro, standup], NOW)).toEqual([standup, retro]);
    });

    it('sorts by start, earliest first', () => {
        const later = invite('2026-07-20T10:00:00Z', {
            end: '2026-07-20T11:00:00Z',
        });
        const sooner = invite('2026-07-15T18:00:00Z', {
            end: '2026-07-15T19:00:00Z',
        });

        expect(pendingInvites([later, sooner], NOW)).toEqual([sooner, later]);
    });

    it('keeps an all-day invitation through its last day', () => {
        const today = invite('2026-07-15', {
            allDay: true,
            end: '2026-07-16',
        });
        const yesterday = invite('2026-07-14', {
            allDay: true,
            end: '2026-07-15',
        });

        expect(pendingInvites([today, yesterday], NOW)).toEqual([today]);
    });
});
