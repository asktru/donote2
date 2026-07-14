import {
    addDays,
    addMonths,
    addQuarters,
    addWeeks,
    addYears,
    getDay,
    getISOWeek,
    getISOWeekYear,
    parse,
    startOfDay,
} from 'date-fns';

import { dateKeyFor, kindOfKey } from './dates';

/**
 * Turn a free-text date into one of the app's canonical calendar keys
 * (`2026-07-15`, `2026-W18`, `2026-08`, `2026-Q3`, `2026`) or null when it
 * can't be understood. Powers the date-picker's text input so scheduling
 * accepts natural language as well as visual selection.
 *
 * Understood forms:
 * - ISO-ish keys, case-insensitive: 2026-07-15, 2026-08, 2026-w18, 2026-q3, 2026
 * - shorthand: w18 (this week-year), q4 (this year)
 * - month names: sep / september (nearest upcoming), "aug 12" / "12 aug"
 * - weekdays: mon … sunday (soonest, today counts), "next fri" (following week)
 * - relative: today, tomorrow, tmr, yesterday, this/next week|month|quarter|year
 */

const MONTHS: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
};

const WEEKDAYS: Record<string, number> = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    weds: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
};

const daily = (date: Date): string => dateKeyFor('daily', date);

/** True when a `yyyy-MM-dd` key names a real calendar day. */
function isRealDay(key: string): boolean {
    const parsed = parse(key, 'yyyy-MM-dd', new Date());

    return !Number.isNaN(parsed.getTime()) && daily(parsed) === key;
}

/** Normalize an explicit ISO-ish key's casing/padding, or return null. */
function normalizeKey(raw: string): string | null {
    let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (match) {
        return isRealDay(raw) ? raw : null;
    }

    match = raw.match(/^(\d{4})-[wW](\d{1,2})$/);

    if (match) {
        return `${match[1]}-W${match[2].padStart(2, '0')}`;
    }

    match = raw.match(/^(\d{4})-[qQ]([1-4])$/);

    if (match) {
        return `${match[1]}-Q${match[2]}`;
    }

    match = raw.match(/^(\d{4})-(\d{2})$/);

    if (match) {
        return raw;
    }

    match = raw.match(/^(\d{4})$/);

    if (match) {
        return raw;
    }

    return null;
}

/** Soonest date on the given weekday (today counts); +1 week when `next`. */
function onWeekday(base: Date, weekday: number, next: boolean): Date {
    let delta = (weekday - getDay(base) + 7) % 7;

    if (next) {
        delta += 7;
    }

    return addDays(base, delta);
}

/** A month in the current year, or next year if it has already passed. */
function upcomingMonth(base: Date, monthIndex: number): Date {
    const year =
        monthIndex < base.getMonth()
            ? base.getFullYear() + 1
            : base.getFullYear();

    return new Date(year, monthIndex, 1);
}

/** A month/day this year, rolling to next year if already past. */
function upcomingMonthDay(base: Date, monthIndex: number, day: number): Date | null {
    let candidate = new Date(base.getFullYear(), monthIndex, day);

    if (candidate.getMonth() !== monthIndex || candidate.getDate() !== day) {
        return null; // e.g. Feb 30
    }

    if (startOfDay(candidate) < base) {
        candidate = new Date(base.getFullYear() + 1, monthIndex, day);
    }

    return candidate;
}

export function parseNaturalDate(input: string, ref: Date = new Date()): string | null {
    const raw = input.trim();

    if (raw === '') {
        return null;
    }

    const base = startOfDay(ref);

    // Explicit ISO-ish keys.
    const normalized = normalizeKey(raw);

    if (normalized !== null && kindOfKey(normalized) !== null) {
        return normalized;
    }

    const lower = raw.toLowerCase();

    if (lower === 'today' || lower === 'tod') {
        return daily(base);
    }

    if (lower === 'tomorrow' || lower === 'tmr' || lower === 'tom') {
        return daily(addDays(base, 1));
    }

    if (lower === 'yesterday') {
        return daily(addDays(base, -1));
    }

    // this / next week|month|quarter|year
    const period = lower.match(/^(this|next)\s+(week|month|quarter|year)$/);

    if (period) {
        const step = period[1] === 'next' ? 1 : 0;

        switch (period[2]) {
            case 'week':
                return dateKeyFor('weekly', addWeeks(base, step));
            case 'month':
                return dateKeyFor('monthly', addMonths(base, step));
            case 'quarter':
                return dateKeyFor('quarterly', addQuarters(base, step));
            default:
                return dateKeyFor('yearly', addYears(base, step));
        }
    }

    // Shorthand week / quarter.
    const week = lower.match(/^w(\d{1,2})$/);

    if (week) {
        const number = Number(week[1]);

        if (number >= 1 && number <= 53) {
            return `${getISOWeekYear(base)}-W${String(number).padStart(2, '0')}`;
        }
    }

    const quarter = lower.match(/^q([1-4])$/);

    if (quarter) {
        return `${base.getFullYear()}-Q${quarter[1]}`;
    }

    // Weekday, optionally prefixed with this/next.
    const weekday = lower.match(/^(next|this)?\s*([a-z]+)$/);

    if (weekday && weekday[2] in WEEKDAYS) {
        return daily(onWeekday(base, WEEKDAYS[weekday[2]], weekday[1] === 'next'));
    }

    // Bare month name.
    if (lower in MONTHS) {
        return dateKeyFor('monthly', upcomingMonth(base, MONTHS[lower]));
    }

    // Month + day, either order ("aug 12" / "12 aug").
    let name: string | null = null;
    let day: number | null = null;
    const nameDay = lower.match(/^([a-z]{3,9})\s+(\d{1,2})$/);
    const dayName = lower.match(/^(\d{1,2})\s+([a-z]{3,9})$/);

    if (nameDay) {
        name = nameDay[1];
        day = Number(nameDay[2]);
    } else if (dayName) {
        name = dayName[2];
        day = Number(dayName[1]);
    }

    if (name !== null && day !== null && name in MONTHS) {
        const date = upcomingMonthDay(base, MONTHS[name], day);

        return date !== null ? daily(date) : null;
    }

    return null;
}

/** ISO week number of a date — re-exported for the picker's week column. */
export function isoWeekOf(date: Date): number {
    return getISOWeek(date);
}
