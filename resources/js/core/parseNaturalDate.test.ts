import { describe, expect, it } from 'vitest';

import { parseNaturalDate } from './parseNaturalDate';

// A fixed reference: Wednesday, 15 July 2026 (ISO week 29, Q3).
const REF = new Date(2026, 6, 15);

describe('parseNaturalDate', () => {
    it('returns null for blank or unknown input', () => {
        expect(parseNaturalDate('', REF)).toBeNull();
        expect(parseNaturalDate('   ', REF)).toBeNull();
        expect(parseNaturalDate('gibberish', REF)).toBeNull();
        expect(parseNaturalDate('2026-13-40', REF)).toBeNull();
    });

    it('accepts explicit ISO-ish keys', () => {
        expect(parseNaturalDate('2026-07-15', REF)).toBe('2026-07-15');
        expect(parseNaturalDate('2026-08', REF)).toBe('2026-08');
        expect(parseNaturalDate('2026', REF)).toBe('2026');
    });

    it('normalizes week and quarter casing/padding', () => {
        expect(parseNaturalDate('2026-w18', REF)).toBe('2026-W18');
        expect(parseNaturalDate('2026-W5', REF)).toBe('2026-W05');
        expect(parseNaturalDate('2026-q3', REF)).toBe('2026-Q3');
    });

    it('handles shorthand week and quarter', () => {
        expect(parseNaturalDate('w18', REF)).toBe('2026-W18');
        expect(parseNaturalDate('q4', REF)).toBe('2026-Q4');
    });

    it('handles today / tomorrow / yesterday', () => {
        expect(parseNaturalDate('today', REF)).toBe('2026-07-15');
        expect(parseNaturalDate('tomorrow', REF)).toBe('2026-07-16');
        expect(parseNaturalDate('yesterday', REF)).toBe('2026-07-14');
    });

    it('handles this/next period words', () => {
        expect(parseNaturalDate('this month', REF)).toBe('2026-07');
        expect(parseNaturalDate('next month', REF)).toBe('2026-08');
        expect(parseNaturalDate('next quarter', REF)).toBe('2026-Q4');
        expect(parseNaturalDate('next year', REF)).toBe('2027');
        expect(parseNaturalDate('this week', REF)).toBe('2026-W29');
        expect(parseNaturalDate('next week', REF)).toBe('2026-W30');
    });

    it('resolves weekdays (soonest; today counts)', () => {
        // REF is a Wednesday.
        expect(parseNaturalDate('wed', REF)).toBe('2026-07-15');
        expect(parseNaturalDate('fri', REF)).toBe('2026-07-17');
        expect(parseNaturalDate('tue', REF)).toBe('2026-07-21');
        expect(parseNaturalDate('next fri', REF)).toBe('2026-07-24');
    });

    it('resolves month names to the upcoming month', () => {
        expect(parseNaturalDate('sep', REF)).toBe('2026-09');
        expect(parseNaturalDate('september', REF)).toBe('2026-09');
        // June already passed in July → next year.
        expect(parseNaturalDate('jun', REF)).toBe('2027-06');
    });

    it('resolves month + day in either order, rolling past dates forward', () => {
        expect(parseNaturalDate('aug 12', REF)).toBe('2026-08-12');
        expect(parseNaturalDate('12 aug', REF)).toBe('2026-08-12');
        expect(parseNaturalDate('august 12', REF)).toBe('2026-08-12');
        // Jan already passed → next year.
        expect(parseNaturalDate('jan 3', REF)).toBe('2027-01-03');
        // Impossible day.
        expect(parseNaturalDate('feb 30', REF)).toBeNull();
    });

    it('is case-insensitive', () => {
        expect(parseNaturalDate('  Next Fri  ', REF)).toBe('2026-07-24');
        expect(parseNaturalDate('AUG 12', REF)).toBe('2026-08-12');
    });
});
