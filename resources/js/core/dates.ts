import {
    addDays,
    addMonths,
    addQuarters,
    addWeeks,
    addYears,
    format,
    getISOWeek,
    getISOWeekYear,
    getQuarter,
    parseISO,
    startOfISOWeek,
    startOfMonth,
    startOfQuarter,
    startOfYear,
} from 'date-fns';

export type CalendarKind =
    'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type NoteType = 'note' | CalendarKind;

const DAILY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKLY_RE = /^(\d{4})-W(\d{1,2})$/;
const MONTHLY_RE = /^(\d{4})-(\d{2})$/;
const QUARTERLY_RE = /^(\d{4})-Q([1-4])$/;
const YEARLY_RE = /^(\d{4})$/;

/** Determine which calendar kind a date key belongs to, or null when it is not a key. */
export function kindOfKey(key: string): CalendarKind | null {
    if (DAILY_RE.test(key)) {
        return 'daily';
    }

    if (WEEKLY_RE.test(key)) {
        return 'weekly';
    }

    if (MONTHLY_RE.test(key)) {
        return 'monthly';
    }

    if (QUARTERLY_RE.test(key)) {
        return 'quarterly';
    }

    if (YEARLY_RE.test(key)) {
        return 'yearly';
    }

    return null;
}

/** Build the date key of the period containing the given date. */
export function dateKeyFor(kind: CalendarKind, date: Date): string {
    switch (kind) {
        case 'daily':
            return format(date, 'yyyy-MM-dd');
        case 'weekly':
            return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, '0')}`;
        case 'monthly':
            return format(date, 'yyyy-MM');
        case 'quarterly':
            return `${format(date, 'yyyy')}-Q${getQuarter(date)}`;
        case 'yearly':
            return format(date, 'yyyy');
    }
}

/** The key of the current period. */
export function todayKey(kind: CalendarKind, ref: Date = new Date()): string {
    return dateKeyFor(kind, ref);
}

/** The first day (local midnight) of the period a key describes. */
export function keyStartDate(key: string): Date {
    const kind = kindOfKey(key);

    if (kind === 'daily') {
        return parseISO(key);
    }

    if (kind === 'weekly') {
        const match = key.match(WEEKLY_RE)!;
        // January 4th is always inside ISO week 1 of its year.
        const week1 = startOfISOWeek(new Date(Number(match[1]), 0, 4));

        return addWeeks(week1, Number(match[2]) - 1);
    }

    if (kind === 'monthly') {
        return startOfMonth(parseISO(`${key}-01`));
    }

    if (kind === 'quarterly') {
        const match = key.match(QUARTERLY_RE)!;

        return startOfQuarter(
            new Date(Number(match[1]), (Number(match[2]) - 1) * 3, 1),
        );
    }

    if (kind === 'yearly') {
        return startOfYear(new Date(Number(key), 0, 1));
    }

    throw new Error(`Not a date key: ${key}`);
}

/** Inclusive start and exclusive end of a key's period. */
export function keyRange(key: string): { start: Date; end: Date } {
    const start = keyStartDate(key);

    switch (kindOfKey(key)) {
        case 'daily':
            return { start, end: addDays(start, 1) };
        case 'weekly':
            return { start, end: addWeeks(start, 1) };
        case 'monthly':
            return { start, end: addMonths(start, 1) };
        case 'quarterly':
            return { start, end: addQuarters(start, 1) };
        case 'yearly':
            return { start, end: addYears(start, 1) };
        default:
            throw new Error(`Not a date key: ${key}`);
    }
}

/** Move a key forward or backward by whole periods of its own kind. */
export function addPeriods(key: string, amount: number): string {
    const kind = kindOfKey(key);
    const start = keyStartDate(key);

    switch (kind) {
        case 'daily':
            return dateKeyFor(kind, addDays(start, amount));
        case 'weekly':
            return dateKeyFor(kind, addWeeks(start, amount));
        case 'monthly':
            return dateKeyFor(kind, addMonths(start, amount));
        case 'quarterly':
            return dateKeyFor(kind, addQuarters(start, amount));
        case 'yearly':
            return dateKeyFor(kind, addYears(start, amount));
        default:
            throw new Error(`Not a date key: ${key}`);
    }
}

/** Order two keys by the start of their periods (earlier first). */
export function compareDateKeys(a: string, b: string): number {
    return keyStartDate(a).getTime() - keyStartDate(b).getTime();
}

const ORDINALS = ['th', 'st', 'nd', 'rd'];

function ordinal(day: number): string {
    const mod100 = day % 100;
    const suffix =
        ORDINALS[(mod100 - 20) % 10] ?? ORDINALS[mod100] ?? ORDINALS[0];

    return `${day}${suffix}`;
}

/** Human friendly label for a date key, e.g. "Sat, July 11th, 2026" or "Week 28, 2026". */
export function humanizeKey(key: string): string {
    const kind = kindOfKey(key);
    const start = keyStartDate(key);

    switch (kind) {
        case 'daily':
            return `${format(start, 'EEE, MMMM')} ${ordinal(start.getDate())}, ${format(start, 'yyyy')}`;
        case 'weekly':
            return `Week ${getISOWeek(start)}, ${getISOWeekYear(start)}`;
        case 'monthly':
            return format(start, 'MMMM yyyy');
        case 'quarterly':
            return `Q${getQuarter(start)} ${format(start, 'yyyy')}`;
        case 'yearly':
            return format(start, 'yyyy');
        default:
            return key;
    }
}

/** Short label used in navigation chrome. */
export function shortLabelForKey(key: string): string {
    const kind = kindOfKey(key);
    const start = keyStartDate(key);

    switch (kind) {
        case 'daily':
            return format(start, 'EEE, MMM d');
        case 'weekly':
            return `W${getISOWeek(start)} ${getISOWeekYear(start)}`;
        default:
            return humanizeKey(key);
    }
}

/**
 * Resolve a `>token` schedule payload into a date key.
 * Supports every key kind plus `today`.
 */
export function resolveScheduleToken(
    token: string,
    ref: Date = new Date(),
): string | null {
    if (token === 'today') {
        return dateKeyFor('daily', ref);
    }

    return kindOfKey(token) !== null ? token : null;
}

/** Does the period of `key` contain the given daily date key? */
export function keyContainsDay(key: string, dayKey: string): boolean {
    const day = keyStartDate(dayKey);
    const { start, end } = keyRange(key);

    return day.getTime() >= start.getTime() && day.getTime() < end.getTime();
}

/** Today's daily key. */
export function todayDailyKey(ref: Date = new Date()): string {
    return dateKeyFor('daily', ref);
}
