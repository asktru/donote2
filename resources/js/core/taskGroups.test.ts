import { describe, expect, it } from 'vitest';

import { groupTasksByDate } from './taskGroups';

// Wednesday July 29th 2026 — inside ISO week 2026-W31, which runs Monday
// July 27th to Sunday August 2nd. August therefore starts inside this week.
const ref = new Date(2026, 6, 29, 10, 0);

/** Group bare day keys, which stand in for tasks here. */
function group(keys: (string | null)[]) {
    return groupTasksByDate(keys, (key) => key, ref);
}

/** The section a single day key lands in. */
function sectionOf(key: string | null): string | undefined {
    return group([key])[0]?.label;
}

describe('groupTasksByDate', () => {
    it('puts a task with no day key under No date', () => {
        expect(sectionOf(null)).toBe('No date');
    });

    it.each([
        ['a past day', '2026-07-28'],
        ['a past week', '2026-W30'],
        ['a past month', '2026-06'],
        ['a past year', '2025'],
    ])('puts %s under Overdue', (_case, key) => {
        expect(sectionOf(key)).toBe('Overdue');
    });

    it('puts today under Today', () => {
        expect(sectionOf('2026-07-29')).toBe('Today');
    });

    it('puts tomorrow under Tomorrow', () => {
        expect(sectionOf('2026-07-30')).toBe('Tomorrow');
    });

    it.each([
        ['2026-07-31', 'Friday'],
        ['2026-08-01', 'Saturday'],
        ['2026-08-02', 'Sunday'],
    ])('gives %s its own weekday section', (key, label) => {
        expect(sectionOf(key)).toBe(label);
    });

    it('puts a day after this week under Later', () => {
        expect(sectionOf('2026-08-03')).toBe('Later'); // the following Monday
    });

    it('puts this week’s week key under This week, not a day section', () => {
        expect(sectionOf('2026-W31')).toBe('This week');
    });

    it('puts a future week under Later', () => {
        expect(sectionOf('2026-W32')).toBe('Later');
    });

    it.each([
        ['the current month', '2026-07'],
        ['the current quarter', '2026-Q3'],
        ['the current year', '2026'],
    ])('puts %s under Today', (_case, key) => {
        expect(sectionOf(key)).toBe('Today');
    });

    it('puts next month under Later even though it starts inside this week', () => {
        // August 1st falls on Saturday of this week, but a month-level
        // commitment is not a this-week commitment.
        expect(sectionOf('2026-08')).toBe('Later');
    });

    it('leaves out sections that hold no tasks', () => {
        expect(group(['2026-07-29']).map((section) => section.label)).toEqual([
            'Today',
        ]);
    });

    it('orders sections from most to least imminent', () => {
        const sections = group([
            null,
            '2026-08', // Later
            '2026-W31', // This week
            '2026-08-02', // Sunday
            '2026-07-30', // Tomorrow
            '2026-07-29', // Today
            '2026-07-31', // Friday
            '2026-07-28', // Overdue
        ]);

        expect(sections.map((section) => section.label)).toEqual([
            'Overdue',
            'Today',
            'Tomorrow',
            'Friday',
            'Sunday',
            'This week',
            'Later',
            'No date',
        ]);
    });

    it('keeps every task, gathering the ones that share a section', () => {
        const sections = group(['2026-07-31', '2026-07-30', '2026-07-31']);

        expect(sections).toEqual([
            { label: 'Tomorrow', items: ['2026-07-30'] },
            { label: 'Friday', items: ['2026-07-31', '2026-07-31'] },
        ]);
    });

    it('has no day sections on the last day of the week', () => {
        const sunday = new Date(2026, 7, 2, 10, 0);
        const sections = groupTasksByDate(
            ['2026-08-02', '2026-08-03', '2026-W31'],
            (key) => key,
            sunday,
        );

        expect(sections).toEqual([
            { label: 'Today', items: ['2026-08-02'] },
            { label: 'This week', items: ['2026-W31'] },
            { label: 'Later', items: ['2026-08-03'] },
        ]);
    });
});
