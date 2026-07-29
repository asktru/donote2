import { describe, expect, it } from 'vitest';

import { searchEvents } from '@/core/eventSearch';

const NOW = new Date('2026-07-15T12:00:00Z');

function event(
    title: string,
    start: string,
    extra: Partial<{
        location: string | null;
        attendees: { email: string; name: string | null }[];
    }> = {},
) {
    return {
        title,
        start,
        location: extra.location ?? null,
        attendees: extra.attendees ?? [],
    };
}

describe('searchEvents', () => {
    it('returns nothing for an empty query', () => {
        expect(
            searchEvents([event('Standup', '2026-07-15T13:00:00Z')], '   ', NOW),
        ).toEqual([]);
    });

    it('matches the title case-insensitively', () => {
        const events = [
            event('Design Review', '2026-07-15T13:00:00Z'),
            event('Standup', '2026-07-15T14:00:00Z'),
        ];

        expect(searchEvents(events, 'design', NOW).map((e) => e.title)).toEqual([
            'Design Review',
        ]);
    });

    it('matches an attendee name', () => {
        const events = [
            event('Weekly', '2026-07-15T13:00:00Z', {
                attendees: [{ email: 'a@x.com', name: 'Anna Petrova' }],
            }),
            event('Other', '2026-07-15T14:00:00Z'),
        ];

        expect(searchEvents(events, 'anna', NOW).map((e) => e.title)).toEqual([
            'Weekly',
        ]);
    });

    it('matches an attendee email', () => {
        const events = [
            event('Weekly', '2026-07-15T13:00:00Z', {
                attendees: [{ email: 'anna@example.com', name: null }],
            }),
        ];

        expect(searchEvents(events, 'example.com', NOW)).toHaveLength(1);
    });

    it('matches the location', () => {
        const events = [
            event('Sync', '2026-07-15T13:00:00Z', { location: 'Room 4' }),
        ];

        expect(searchEvents(events, 'room 4', NOW)).toHaveLength(1);
    });

    it('orders by distance from now, in either direction', () => {
        const events = [
            event('sync far future', '2026-07-25T12:00:00Z'),
            event('sync near past', '2026-07-15T09:00:00Z'),
            event('sync near future', '2026-07-15T14:00:00Z'),
        ];

        expect(searchEvents(events, 'sync', NOW).map((e) => e.title)).toEqual([
            'sync near future',
            'sync near past',
            'sync far future',
        ]);
    });

    it('puts a future event ahead of a past one at the same distance', () => {
        const events = [
            event('sync past', '2026-07-15T11:00:00Z'),
            event('sync future', '2026-07-15T13:00:00Z'),
        ];

        expect(searchEvents(events, 'sync', NOW).map((e) => e.title)).toEqual([
            'sync future',
            'sync past',
        ]);
    });

    it('honours the result limit', () => {
        const events = Array.from({ length: 10 }, (_, index) =>
            event(`sync ${index}`, `2026-07-16T0${index % 10}:00:00Z`),
        );

        expect(searchEvents(events, 'sync', NOW, 3)).toHaveLength(3);
    });

    it('never matches on a field it was not given', () => {
        const events = [
            {
                ...event('Sync', '2026-07-15T13:00:00Z'),
                description: 'meet.google.com/abc',
            },
        ];

        expect(searchEvents(events, 'meet.google.com', NOW)).toHaveLength(0);
    });
});
