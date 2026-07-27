import { describe, expect, it } from 'vitest';

import { visibleEvents } from './eventVisibility';

/** A meeting that lands on two calendars, as sync meetings tend to. */
const ON_TWO_CALENDARS = [
    {
        key: 'google:work:abc',
        calendarId: 'work',
        responseStatus: 'accepted',
        title: 'Sync Timur / Olga',
        start: '2026-07-27T07:00:00Z',
        end: '2026-07-27T08:00:00Z',
    },
    {
        key: 'google:personal:def',
        calendarId: 'personal',
        responseStatus: 'accepted',
        title: 'Sync Timur / Olga',
        start: '2026-07-27T07:00:00Z',
        end: '2026-07-27T08:00:00Z',
    },
];

const ALL_VISIBLE = {
    isCalendarHidden: () => false,
    hideDeclined: false,
    isHidden: () => false,
};

describe('visibleEvents', () => {
    it('collapses an occurrence that sits on more than one calendar', () => {
        const result = visibleEvents(ON_TWO_CALENDARS, ALL_VISIBLE);

        expect(result).toHaveLength(1);
        expect(result[0].key).toBe('google:work:abc');
    });

    it('represents it by the copy on a visible calendar, not the hidden one', () => {
        // The bug this pins: deduping before filtering lets the hidden copy
        // win its group and then be filtered away, so two code paths running
        // the pipeline in different orders disagree about which copy is "the"
        // event — and anything matching them up by key silently fails.
        const result = visibleEvents(ON_TWO_CALENDARS, {
            ...ALL_VISIBLE,
            isCalendarHidden: (id) => id === 'work',
        });

        expect(result).toHaveLength(1);
        expect(result[0].key).toBe('google:personal:def');
    });

    it('drops declined events only when the filter is on', () => {
        const declined = [
            { ...ON_TWO_CALENDARS[0], responseStatus: 'declined' },
        ];

        expect(visibleEvents(declined, ALL_VISIBLE)).toHaveLength(1);
        expect(
            visibleEvents(declined, { ...ALL_VISIBLE, hideDeclined: true }),
        ).toHaveLength(0);
    });

    it('flags individually hidden events rather than removing them', () => {
        const result = visibleEvents([ON_TWO_CALENDARS[0]], {
            ...ALL_VISIBLE,
            isHidden: () => true,
        });

        expect(result).toHaveLength(1);
        expect(result[0].hidden).toBe(true);
    });

    it('leaves distinct events alone', () => {
        const two = [
            ON_TWO_CALENDARS[0],
            { ...ON_TWO_CALENDARS[1], title: 'Something else' },
        ];

        expect(visibleEvents(two, ALL_VISIBLE)).toHaveLength(2);
    });
});
