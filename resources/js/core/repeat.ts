import {
    addDays,
    addMonths,
    addWeeks,
    addYears,
    differenceInCalendarDays,
    format,
    lastDayOfMonth,
    parseISO,
    setDate,
} from 'date-fns';

import { dateKeyFor, keyStartDate, kindOfKey } from './dates';
import type { CalendarKind } from './dates';
import { SYNC_ID_RE } from './parser';
import type { ParsedLine, RepeatRule } from './parser';

function toDailyKey(date: Date): string {
    return format(date, 'yyyy-MM-dd');
}

function isoWeekday(date: Date): number {
    const jsDay = date.getDay();

    return jsDay === 0 ? 7 : jsDay;
}

/** Clamp a desired day-of-month to what the month actually has. */
function withMonthDay(date: Date, day: number): Date {
    return setDate(date, Math.min(day, lastDayOfMonth(date).getDate()));
}

/**
 * Compute the next occurrence date (as a daily key) for a repeating task.
 *
 * Interval rules advance from the task's scheduled date, or from the
 * completion date when the rule is marked `+` (from completion) or the task
 * has no schedule. Weekday and month-day rules pick the next matching day
 * strictly after the later of schedule/completion.
 */
export function nextOccurrenceDay(
    rule: RepeatRule,
    schedule: string | null,
    completionDay: string,
): string {
    const completion = parseISO(completionDay);
    const scheduled = schedule !== null ? keyStartDate(schedule) : null;

    if (rule.kind === 'interval') {
        const base =
            rule.fromCompletion || scheduled === null ? completion : scheduled;

        switch (rule.unit) {
            case 'd':
                return toDailyKey(addDays(base, rule.amount));
            case 'w':
                return toDailyKey(addWeeks(base, rule.amount));
            case 'm':
                return toDailyKey(addMonths(base, rule.amount));
            case 'y':
                return toDailyKey(addYears(base, rule.amount));
        }
    }

    const base =
        scheduled !== null && scheduled.getTime() > completion.getTime()
            ? scheduled
            : completion;

    if (rule.kind === 'weekdays') {
        for (let offset = 1; offset <= 7; offset++) {
            const candidate = addDays(base, offset);

            if (rule.weekdays.includes(isoWeekday(candidate))) {
                return toDailyKey(candidate);
            }
        }
    }

    if (rule.kind === 'monthday') {
        const sameMonth = withMonthDay(base, rule.day);

        if (sameMonth.getTime() > base.getTime()) {
            return toDailyKey(sameMonth);
        }

        return toDailyKey(
            withMonthDay(addMonths(setDate(base, 1), 1), rule.day),
        );
    }

    return completionDay;
}

/**
 * The schedule key of the next occurrence, preserving the granularity of the
 * original schedule (a task scheduled for a week repeats into a week).
 */
export function nextScheduleKey(
    rule: RepeatRule,
    schedule: string | null,
    completionDay: string,
): string {
    const day = nextOccurrenceDay(rule, schedule, completionDay);
    const kind: CalendarKind =
        schedule !== null ? (kindOfKey(schedule) ?? 'daily') : 'daily';

    return kind === 'daily' ? day : dateKeyFor(kind, parseISO(day));
}

const CHECKBOX_RE = /^(\s*[-*+]\s\[)[ xX>-](\])/;
const SCHEDULE_TOKEN_RE =
    />(\d{4}-\d{2}-\d{2}|\d{4}-W\d{1,2}|\d{4}-Q[1-4]|\d{4}-\d{2}|\d{4}|today)\b/;
const DUE_TOKEN_RE = /@due\((\d{4}-\d{2}-\d{2})\)/;

/**
 * Build the markdown line for the next occurrence of a completed repeating
 * task: open checkbox, advanced schedule token, due date shifted by the same
 * number of days the schedule moved.
 */
export function buildNextOccurrenceLine(
    line: ParsedLine,
    completionDay: string,
): string | null {
    if (line.repeat === null) {
        return null;
    }

    const newDay = nextOccurrenceDay(line.repeat, line.schedule, completionDay);
    const newKey = nextScheduleKey(line.repeat, line.schedule, completionDay);

    // The next occurrence is a new task instance — it must not share a
    // synced-line id with the completed one.
    let raw = line.raw.replace(CHECKBOX_RE, '$1 $2').replace(SYNC_ID_RE, '');

    if (SCHEDULE_TOKEN_RE.test(raw)) {
        raw = raw.replace(SCHEDULE_TOKEN_RE, `>${newKey}`);
    } else {
        raw = `${raw.trimEnd()} >${newKey}`;
    }

    if (line.due !== null) {
        const oldBase =
            line.schedule !== null
                ? keyStartDate(line.schedule)
                : parseISO(completionDay);
        const delta = differenceInCalendarDays(parseISO(newDay), oldBase);
        const newDue = toDailyKey(addDays(parseISO(line.due), delta));
        raw = raw.replace(DUE_TOKEN_RE, `@due(${newDue})`);
    }

    return raw;
}
