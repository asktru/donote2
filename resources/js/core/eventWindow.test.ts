import { describe, expect, it } from 'vitest';

import {
    eventMoment,
    eventsInRange,
    horizonRange,
    rangeCovers,
} from '@/core/eventWindow';

const range = (start: string, end: string) => ({
    start: new Date(start),
    end: new Date(end),
});

describe('eventMoment', () => {
    it('reads a bare date as local midnight, not UTC midnight', () => {
        expect(eventMoment('2026-07-15')).toBe(new Date(2026, 6, 15).getTime());
    });

    it('reads a timed ISO string as the instant it names', () => {
        expect(eventMoment('2026-07-15T11:00:00Z')).toBe(
            Date.parse('2026-07-15T11:00:00Z'),
        );
    });
});

describe('eventsInRange', () => {
    const events = [
        {
            key: 'before',
            start: '2026-07-10T10:00:00Z',
            end: '2026-07-10T11:00:00Z',
        },
        {
            key: 'inside',
            start: '2026-07-15T10:00:00Z',
            end: '2026-07-15T11:00:00Z',
        },
        {
            key: 'after',
            start: '2026-07-25T10:00:00Z',
            end: '2026-07-25T11:00:00Z',
        },
    ];

    it('keeps only events overlapping the range', () => {
        const kept = eventsInRange(events, range('2026-07-14', '2026-07-20'));

        expect(kept.map((event) => event.key)).toEqual(['inside']);
    });

    it('keeps an event straddling the range start', () => {
        const straddling = [
            {
                key: 'long',
                start: '2026-07-10T10:00:00Z',
                end: '2026-07-16T11:00:00Z',
            },
        ];

        expect(
            eventsInRange(straddling, range('2026-07-14', '2026-07-20')),
        ).toHaveLength(1);
    });

    it('treats the range end as exclusive', () => {
        const atEnd = [
            {
                key: 'edge',
                start: '2026-07-20T00:00:00Z',
                end: '2026-07-20T01:00:00Z',
            },
        ];

        expect(
            eventsInRange(atEnd, {
                start: new Date('2026-07-14T00:00:00Z'),
                end: new Date('2026-07-20T00:00:00Z'),
            }),
        ).toHaveLength(0);
    });

    it('keeps an all-day event whose exclusive end is the range start plus one', () => {
        const allDay = [{ key: 'day', start: '2026-07-15', end: '2026-07-16' }];
        const day = {
            start: new Date(2026, 6, 15),
            end: new Date(2026, 6, 16),
        };

        expect(eventsInRange(allDay, day)).toHaveLength(1);
    });
});

describe('rangeCovers', () => {
    it('is true when the inner range sits fully inside', () => {
        expect(
            rangeCovers(
                range('2026-07-01', '2026-08-01'),
                range('2026-07-10', '2026-07-17'),
            ),
        ).toBe(true);
    });

    it('is false when the inner range spills past the end', () => {
        expect(
            rangeCovers(
                range('2026-07-01', '2026-08-01'),
                range('2026-07-25', '2026-08-05'),
            ),
        ).toBe(false);
    });

    it('is true when the ranges are identical', () => {
        const same = range('2026-07-01', '2026-08-01');

        expect(rangeCovers(same, same)).toBe(true);
    });
});

describe('horizonRange', () => {
    it('spans four weeks either side of now', () => {
        const now = new Date('2026-07-15T12:00:00Z');
        const { start, end } = horizonRange(now);
        const fourWeeks = 28 * 24 * 60 * 60 * 1000;

        expect(now.getTime() - start.getTime()).toBe(fourWeeks);
        expect(end.getTime() - now.getTime()).toBe(fourWeeks);
    });
});
