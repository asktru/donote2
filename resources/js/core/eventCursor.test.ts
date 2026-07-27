import { describe, expect, it } from 'vitest';

import { nextFromNow, orderEvents, stepEvent } from './eventCursor';

const EVENTS = [
    { key: 'c', start: '2026-07-27T09:00:00Z', title: 'Tuesday standup' },
    { key: 'a', start: '2026-07-26T09:00:00Z', title: 'Monday standup' },
    { key: 'b', start: '2026-07-26T09:00:00Z', title: 'Another at nine' },
    { key: 'd', start: '2026-07-26T14:00:00Z', title: 'Monday review' },
];

const NOW = new Date('2026-07-26T10:00:00Z');

describe('orderEvents', () => {
    it('sorts by start, then title, flattened across days', () => {
        expect(orderEvents(EVENTS).map((event) => event.key)).toEqual([
            'b',
            'a',
            'd',
            'c',
        ]);
    });

    it('does not mutate the input', () => {
        const input = [...EVENTS];
        orderEvents(input);

        expect(input.map((event) => event.key)).toEqual(['c', 'a', 'b', 'd']);
    });
});

describe('nextFromNow', () => {
    it('picks the first event starting at or after now', () => {
        expect(nextFromNow(EVENTS, NOW)?.key).toBe('d');
    });

    it('falls back to the first in range when nothing is upcoming', () => {
        const afterEverything = new Date('2026-07-28T00:00:00Z');

        expect(nextFromNow(EVENTS, afterEverything)?.key).toBe('b');
    });

    it('is null for an empty range', () => {
        expect(nextFromNow([], NOW)).toBeNull();
    });
});

describe('stepEvent', () => {
    it('moves to the next and previous event in order', () => {
        expect(stepEvent(EVENTS, 'a', 1, NOW)?.key).toBe('d');
        expect(stepEvent(EVENTS, 'd', -1, NOW)?.key).toBe('a');
    });

    it('stops at the ends rather than wrapping', () => {
        expect(stepEvent(EVENTS, 'c', 1, NOW)?.key).toBe('c');
        expect(stepEvent(EVENTS, 'b', -1, NOW)?.key).toBe('b');
    });

    it('starts from now when nothing is selected', () => {
        expect(stepEvent(EVENTS, null, 1, NOW)?.key).toBe('d');
        expect(stepEvent(EVENTS, null, -1, NOW)?.key).toBe('c');
    });

    it('starts from now when the selection is no longer in range', () => {
        expect(stepEvent(EVENTS, 'gone', 1, NOW)?.key).toBe('d');
    });

    it('is null for an empty range', () => {
        expect(stepEvent([], null, 1, NOW)).toBeNull();
    });
});
