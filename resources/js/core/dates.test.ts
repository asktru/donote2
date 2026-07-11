import { describe, expect, it } from 'vitest';

import {
    addPeriods,
    compareDateKeys,
    dateKeyFor,
    humanizeKey,
    keyContainsDay,
    keyRange,
    keyStartDate,
    kindOfKey,
    resolveScheduleToken,
    todayKey,
} from './dates';

describe('kindOfKey', () => {
    it('recognizes every key kind', () => {
        expect(kindOfKey('2026-07-11')).toBe('daily');
        expect(kindOfKey('2026-W28')).toBe('weekly');
        expect(kindOfKey('2026-07')).toBe('monthly');
        expect(kindOfKey('2026-Q3')).toBe('quarterly');
        expect(kindOfKey('2026')).toBe('yearly');
    });

    it('rejects non-keys', () => {
        expect(kindOfKey('hello')).toBeNull();
        expect(kindOfKey('2026-13-99x')).toBeNull();
        expect(kindOfKey('2026-Q5')).toBeNull();
    });
});

describe('dateKeyFor', () => {
    const date = new Date(2026, 6, 11); // Sat July 11 2026

    it('formats each kind', () => {
        expect(dateKeyFor('daily', date)).toBe('2026-07-11');
        expect(dateKeyFor('weekly', date)).toBe('2026-W28');
        expect(dateKeyFor('monthly', date)).toBe('2026-07');
        expect(dateKeyFor('quarterly', date)).toBe('2026-Q3');
        expect(dateKeyFor('yearly', date)).toBe('2026');
    });

    it('uses the ISO week year at year boundaries', () => {
        // Dec 29 2025 is in ISO week 1 of 2026
        expect(dateKeyFor('weekly', new Date(2025, 11, 29))).toBe('2026-W01');
        // Jan 1 2027 is in ISO week 53 of 2026
        expect(dateKeyFor('weekly', new Date(2027, 0, 1))).toBe('2026-W53');
    });
});

describe('keyStartDate / keyRange', () => {
    it('finds the Monday of a week key', () => {
        const start = keyStartDate('2026-W28');
        expect(start.getFullYear()).toBe(2026);
        expect(start.getMonth()).toBe(6);
        expect(start.getDate()).toBe(6); // Monday July 6th 2026
        expect(start.getDay()).toBe(1);
    });

    it('computes quarter ranges', () => {
        const { start, end } = keyRange('2026-Q3');
        expect(start.getMonth()).toBe(6);
        expect(end.getMonth()).toBe(9);
    });

    it('daily range spans exactly one day', () => {
        const { start, end } = keyRange('2026-07-11');
        expect(end.getTime() - start.getTime()).toBe(24 * 3600 * 1000);
    });
});

describe('addPeriods', () => {
    it('adds days, weeks, months, quarters, years', () => {
        expect(addPeriods('2026-07-11', 1)).toBe('2026-07-12');
        expect(addPeriods('2026-07-11', -11)).toBe('2026-06-30');
        expect(addPeriods('2026-W28', 2)).toBe('2026-W30');
        expect(addPeriods('2026-07', 6)).toBe('2027-01');
        expect(addPeriods('2026-Q4', 1)).toBe('2027-Q1');
        expect(addPeriods('2026', -1)).toBe('2025');
    });

    it('crosses ISO week-year boundaries', () => {
        expect(addPeriods('2026-W53', 1)).toBe('2027-W01');
        expect(addPeriods('2027-W01', -1)).toBe('2026-W53');
    });
});

describe('humanizeKey', () => {
    it('renders friendly labels', () => {
        expect(humanizeKey('2026-07-11')).toBe('Sat, July 11th, 2026');
        expect(humanizeKey('2026-07-01')).toBe('Wed, July 1st, 2026');
        expect(humanizeKey('2026-07-22')).toBe('Wed, July 22nd, 2026');
        expect(humanizeKey('2026-07-13')).toBe('Mon, July 13th, 2026');
        expect(humanizeKey('2026-W28')).toBe('Week 28, 2026');
        expect(humanizeKey('2026-07')).toBe('July 2026');
        expect(humanizeKey('2026-Q3')).toBe('Q3 2026');
        expect(humanizeKey('2026')).toBe('2026');
    });
});

describe('resolveScheduleToken', () => {
    it('passes through valid keys and resolves today', () => {
        expect(resolveScheduleToken('2026-09')).toBe('2026-09');
        expect(resolveScheduleToken('today', new Date(2026, 6, 11))).toBe(
            '2026-07-11',
        );
        expect(resolveScheduleToken('never')).toBeNull();
    });
});

describe('keyContainsDay', () => {
    it('checks period membership', () => {
        expect(keyContainsDay('2026-W28', '2026-07-06')).toBe(true);
        expect(keyContainsDay('2026-W28', '2026-07-12')).toBe(true);
        expect(keyContainsDay('2026-W28', '2026-07-13')).toBe(false);
        expect(keyContainsDay('2026-Q3', '2026-08-15')).toBe(true);
        expect(keyContainsDay('2026', '2026-01-01')).toBe(true);
    });
});

describe('compareDateKeys', () => {
    it('orders mixed key kinds by period start', () => {
        expect(compareDateKeys('2026-07-11', '2026-W28')).toBeGreaterThan(0);
        expect(compareDateKeys('2026-07-06', '2026-W28')).toBe(0);
        expect(compareDateKeys('2026-Q1', '2026-07')).toBeLessThan(0);
    });
});

describe('todayKey', () => {
    it('respects the reference date', () => {
        expect(todayKey('quarterly', new Date(2026, 11, 31))).toBe('2026-Q4');
    });
});
