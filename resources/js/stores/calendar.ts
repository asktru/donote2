import { addDays, addMonths, addWeeks, endOfWeek, format, startOfDay, startOfWeek } from 'date-fns';
import { computed, ref } from 'vue';

export type CalendarViewKind = 'day' | 'week' | 'month';

/** Weeks start on Monday, matching the app's ISO-week date math elsewhere. */
const WEEK_STARTS_ON = 1;

export const calendarView = ref<CalendarViewKind>('week');

/** The day the current view is anchored on (local midnight). */
export const anchor = ref<Date>(startOfDay(new Date()));

export function setCalendarView(view: CalendarViewKind): void {
    calendarView.value = view;
}

export function goToday(): void {
    anchor.value = startOfDay(new Date());
}

/** Move one period (day/week/month) forward (+1) or back (-1). */
export function stepCalendar(delta: number): void {
    const current = anchor.value;

    anchor.value =
        calendarView.value === 'day'
            ? addDays(current, delta)
            : calendarView.value === 'week'
              ? addWeeks(current, delta)
              : addMonths(current, delta);
}

/** The [start, end) day range the current view covers. */
export const visibleRange = computed<{ start: Date; end: Date }>(() => {
    const day = startOfDay(anchor.value);

    if (calendarView.value === 'day') {
        return { start: day, end: addDays(day, 1) };
    }

    if (calendarView.value === 'week') {
        const start = startOfWeek(day, { weekStartsOn: WEEK_STARTS_ON });

        return { start, end: addDays(start, 7) };
    }

    // Month view shows whole weeks around the anchor's month.
    const monthStart = new Date(day.getFullYear(), day.getMonth(), 1);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON });
    const monthEnd = new Date(day.getFullYear(), day.getMonth() + 1, 0);
    const gridEnd = addDays(endOfWeek(monthEnd, { weekStartsOn: WEEK_STARTS_ON }), 1);

    return { start: gridStart, end: gridEnd };
});

export const anchorLabel = computed<string>(() => {
    const day = anchor.value;

    if (calendarView.value === 'month') {
        return format(day, 'MMMM yyyy');
    }

    if (calendarView.value === 'day') {
        return format(day, 'EEE, MMM d, yyyy');
    }

    const start = startOfWeek(day, { weekStartsOn: WEEK_STARTS_ON });
    const end = addDays(start, 6);
    const sameMonth = start.getMonth() === end.getMonth();

    return sameMonth
        ? `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`
        : `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
});
