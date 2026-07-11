import { describe, expect, it } from 'vitest';

import { parseLine } from './parser';
import type { RepeatRule } from './parser';
import {
    buildNextOccurrenceLine,
    nextOccurrenceDay,
    nextScheduleKey,
} from './repeat';

const interval = (
    amount: number,
    unit: 'd' | 'w' | 'm' | 'y',
    fromCompletion = false,
): RepeatRule => ({
    kind: 'interval',
    amount,
    unit,
    fromCompletion,
    raw: `${fromCompletion ? '+' : ''}${amount}${unit}`,
});

describe('nextOccurrenceDay — intervals', () => {
    it('advances from the scheduled date', () => {
        expect(
            nextOccurrenceDay(interval(3, 'd'), '2026-07-11', '2026-07-14'),
        ).toBe('2026-07-14');
        expect(
            nextOccurrenceDay(interval(1, 'w'), '2026-07-11', '2026-07-20'),
        ).toBe('2026-07-18');
        expect(
            nextOccurrenceDay(interval(2, 'm'), '2026-07-11', '2026-07-11'),
        ).toBe('2026-09-11');
        expect(
            nextOccurrenceDay(interval(1, 'y'), '2026-07-11', '2026-07-11'),
        ).toBe('2027-07-11');
    });

    it('advances from completion when the rule is +N', () => {
        expect(
            nextOccurrenceDay(
                interval(3, 'd', true),
                '2026-07-11',
                '2026-07-20',
            ),
        ).toBe('2026-07-23');
    });

    it('falls back to completion when there is no schedule', () => {
        expect(nextOccurrenceDay(interval(3, 'd'), null, '2026-07-11')).toBe(
            '2026-07-14',
        );
    });
});

describe('nextOccurrenceDay — weekdays', () => {
    const rule: RepeatRule = {
        kind: 'weekdays',
        weekdays: [2, 4],
        raw: 'Tue,Thu',
    }; // Tue, Thu

    it('picks the next listed weekday strictly after the base', () => {
        // 2026-07-11 is a Saturday -> next Tuesday is the 14th
        expect(nextOccurrenceDay(rule, '2026-07-11', '2026-07-11')).toBe(
            '2026-07-14',
        );
        // 2026-07-14 is a Tuesday -> next is Thursday the 16th
        expect(nextOccurrenceDay(rule, '2026-07-14', '2026-07-14')).toBe(
            '2026-07-16',
        );
        // completing late: schedule Tue 14th, completed Fri 17th -> next Tue 21st
        expect(nextOccurrenceDay(rule, '2026-07-14', '2026-07-17')).toBe(
            '2026-07-21',
        );
    });
});

describe('nextOccurrenceDay — month days', () => {
    const rule: RepeatRule = { kind: 'monthday', day: 20, raw: '20th' };

    it('stays in the current month when the day is still ahead', () => {
        expect(nextOccurrenceDay(rule, '2026-07-11', '2026-07-11')).toBe(
            '2026-07-20',
        );
    });

    it('moves to the next month when the day already passed', () => {
        expect(nextOccurrenceDay(rule, '2026-07-20', '2026-07-20')).toBe(
            '2026-08-20',
        );
        expect(nextOccurrenceDay(rule, '2026-07-25', '2026-07-25')).toBe(
            '2026-08-20',
        );
    });

    it('clamps to short months', () => {
        const eom: RepeatRule = { kind: 'monthday', day: 31, raw: '31st' };
        expect(nextOccurrenceDay(eom, '2027-01-31', '2027-01-31')).toBe(
            '2027-02-28',
        );
    });
});

describe('nextScheduleKey — granularity preservation', () => {
    it('repeats week-scheduled tasks into weeks', () => {
        expect(
            nextScheduleKey(interval(1, 'w'), '2026-W28', '2026-07-08'),
        ).toBe('2026-W29');
    });

    it('repeats month-scheduled tasks into months', () => {
        expect(nextScheduleKey(interval(1, 'm'), '2026-07', '2026-07-15')).toBe(
            '2026-08',
        );
    });

    it('keeps daily granularity by default', () => {
        expect(
            nextScheduleKey(interval(3, 'd'), '2026-07-11', '2026-07-11'),
        ).toBe('2026-07-14');
    });
});

describe('buildNextOccurrenceLine', () => {
    it('resets the checkbox and advances the schedule token', () => {
        const line = parseLine('- [x] Water plants >2026-07-11 @repeat(3d)');
        expect(buildNextOccurrenceLine(line, '2026-07-11')).toBe(
            '- [ ] Water plants >2026-07-14 @repeat(3d)',
        );
    });

    it('appends a schedule token when the task had none', () => {
        const line = parseLine('- [x] Journal @repeat(+1d)');
        expect(buildNextOccurrenceLine(line, '2026-07-11')).toBe(
            '- [ ] Journal @repeat(+1d) >2026-07-12',
        );
    });

    it('shifts the due date by the same delta', () => {
        const line = parseLine(
            '- [x] Invoice >2026-07-01 @due(2026-07-05) @repeat(1m)',
        );
        expect(buildNextOccurrenceLine(line, '2026-07-02')).toBe(
            '- [ ] Invoice >2026-08-01 @due(2026-08-05) @repeat(1m)',
        );
    });

    it('preserves indentation and priority text', () => {
        const line = parseLine('    - [x] !! Report >2026-07-11 @repeat(1w)');
        expect(buildNextOccurrenceLine(line, '2026-07-11')).toBe(
            '    - [ ] !! Report >2026-07-18 @repeat(1w)',
        );
    });

    it('returns null for non-repeating tasks', () => {
        expect(
            buildNextOccurrenceLine(parseLine('- [x] Once'), '2026-07-11'),
        ).toBeNull();
    });
});
