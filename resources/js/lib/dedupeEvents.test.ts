import { describe, expect, it } from 'vitest';

import { dedupeEvents } from './dedupeEvents';

interface Row {
    title: string;
    start: string | null;
    end: string | null;
    source: string;
}

describe('dedupeEvents', () => {
    it('collapses events with the same title, start, and end', () => {
        const rows: Row[] = [
            { title: 'Standup', start: '09:00', end: '09:15', source: 'google' },
            { title: 'Standup', start: '09:00', end: '09:15', source: 'apple' },
        ];

        const result = dedupeEvents(rows);

        expect(result).toHaveLength(1);
        // The first (Google) wins so its click-through link survives.
        expect(result[0]?.source).toBe('google');
    });

    it('keeps events that differ in title, start, or end', () => {
        const rows: Row[] = [
            { title: 'Standup', start: '09:00', end: '09:15', source: 'a' },
            { title: 'Standup', start: '09:00', end: '09:30', source: 'b' }, // different end
            { title: 'Sync', start: '09:00', end: '09:15', source: 'c' }, // different title
            { title: 'Standup', start: '10:00', end: '10:15', source: 'd' }, // different start
        ];

        expect(dedupeEvents(rows)).toHaveLength(4);
    });

    it('preserves order of the surviving events', () => {
        const rows: Row[] = [
            { title: 'A', start: '1', end: '2', source: 'x' },
            { title: 'B', start: '1', end: '2', source: 'y' },
            { title: 'A', start: '1', end: '2', source: 'z' },
        ];

        expect(dedupeEvents(rows).map((row) => row.title)).toEqual(['A', 'B']);
    });

    it('collapses the same instant expressed in different zones/offsets', () => {
        const rows: Row[] = [
            { title: 'Standup', start: '2026-07-13T07:00:00-04:00', end: '2026-07-13T07:30:00-04:00', source: 'google' },
            { title: 'Standup', start: '2026-07-13T11:00:00Z', end: '2026-07-13T11:30:00Z', source: 'apple' },
        ];

        const result = dedupeEvents(rows);

        expect(result).toHaveLength(1);
        expect(result[0]?.source).toBe('google');
    });

    it('treats null start/end as their own group without collapsing distinct titles', () => {
        const rows: Row[] = [
            { title: 'All day', start: null, end: null, source: 'a' },
            { title: 'All day', start: null, end: null, source: 'b' },
            { title: 'Other', start: null, end: null, source: 'c' },
        ];

        const result = dedupeEvents(rows);

        expect(result.map((row) => row.title)).toEqual(['All day', 'Other']);
    });
});
