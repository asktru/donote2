import { addDays, format } from 'date-fns';

import {
    keyRange,
    keyStartDate,
    kindOfKey,
    todayDailyKey,
    todayKey,
} from './dates';

export interface DateGroup<T> {
    label: string;
    items: T[];
}

export const NO_DATE_LABEL = 'No date';
export const OVERDUE_LABEL = 'Overdue';

/**
 * Section labels in the order they are shown, for the week `ref` falls in:
 * the fixed head, then one label per remaining day of that week, then the
 * fixed tail. A day of the week is named for its weekday, except tomorrow.
 */
function sectionLabels(ref: Date): string[] {
    const days: string[] = [];
    const weekEnd = keyRange(todayKey('weekly', ref)).end.getTime();
    const today = keyStartDate(todayDailyKey(ref));

    for (let offset = 1; offset < 7; offset += 1) {
        const day = addDays(today, offset);

        if (day.getTime() >= weekEnd) {
            break;
        }

        days.push(offset === 1 ? 'Tomorrow' : format(day, 'EEEE'));
    }

    return [
        OVERDUE_LABEL,
        'Today',
        ...days,
        'This week',
        'Later',
        NO_DATE_LABEL,
    ];
}

/**
 * The section a task scheduled to `dayKey` belongs in, relative to `ref`.
 *
 * Day-scheduled work is placed by the day itself, so the rest of the current
 * week is broken out day by day; "This week" is left to hold what is scheduled
 * to the week as a whole. Coarser schedules are current-or-later: the month,
 * quarter or year containing today is actionable now, and one that merely
 * starts inside this week is not a this-week commitment.
 */
function sectionFor(dayKey: string | null, ref: Date): string {
    if (dayKey === null) {
        return NO_DATE_LABEL;
    }

    const kind = kindOfKey(dayKey);

    if (kind === null) {
        return NO_DATE_LABEL;
    }

    const today = keyStartDate(todayDailyKey(ref));
    const todayStart = today.getTime();
    const range = keyRange(dayKey);

    if (range.end.getTime() <= todayStart) {
        return OVERDUE_LABEL;
    }

    if (kind === 'daily') {
        const day = range.start;

        if (day.getTime() === todayStart) {
            return 'Today';
        }

        if (day.getTime() >= keyRange(todayKey('weekly', ref)).end.getTime()) {
            return 'Later';
        }

        return day.getTime() === addDays(today, 1).getTime()
            ? 'Tomorrow'
            : format(day, 'EEEE');
    }

    if (kind === 'weekly') {
        return dayKey === todayKey('weekly', ref) ? 'This week' : 'Later';
    }

    return range.start.getTime() <= todayStart ? 'Today' : 'Later';
}

/**
 * Bucket dated items into the Tasks view's sections, most imminent first.
 * Items keep their relative order inside a section, and sections holding
 * nothing are left out.
 */
export function groupTasksByDate<T>(
    items: T[],
    dayKeyOf: (item: T) => string | null,
    ref: Date = new Date(),
): DateGroup<T>[] {
    const buckets = new Map<string, T[]>(
        sectionLabels(ref).map((label) => [label, []]),
    );

    for (const item of items) {
        buckets.get(sectionFor(dayKeyOf(item), ref))!.push(item);
    }

    return [...buckets]
        .filter(([, bucketed]) => bucketed.length > 0)
        .map(([label, bucketed]) => ({ label, items: bucketed }));
}
