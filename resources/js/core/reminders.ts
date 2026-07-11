import { keyStartDate, todayDailyKey } from './dates';
import type { ParsedLine } from './parser';

export interface ReminderCandidate {
    noteId: string;
    line: ParsedLine;
    at: Date;
    key: string;
}

/**
 * Resolve the moment a task's reminder should fire.
 *
 * Reminders attach to the schedule date when the task has one (using the
 * first day of the period for week/month/quarter/year schedules), otherwise
 * they fire today.
 */
export function resolveReminderAt(
    line: ParsedLine,
    ref: Date = new Date(),
): Date | null {
    if (line.reminderMinutes === null || line.state !== 'open') {
        return null;
    }

    const dayKey = line.schedule ?? todayDailyKey(ref);
    const day = keyStartDate(dayKey);

    return new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        0,
        line.reminderMinutes,
    );
}

/**
 * Stable identity of one reminder firing, used to persist dismiss/snooze
 * state. Includes the fire time so a rescheduled task produces a new key.
 */
export function reminderKey(
    noteId: string,
    line: ParsedLine,
    at: Date,
): string {
    return `${noteId}|${line.title}|${at.getTime()}`;
}

/**
 * Format a time as a reminder token: `@9am`, `@2:42pm`, `@12:05am`.
 * Minutes are omitted on the hour.
 */
export function formatReminderToken(date: Date): string {
    const hours24 = date.getHours();
    const minutes = date.getMinutes();
    const meridiem = hours24 >= 12 ? 'pm' : 'am';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

    return minutes === 0
        ? `@${hours12}${meridiem}`
        : `@${hours12}:${String(minutes).padStart(2, '0')}${meridiem}`;
}

/** Collect reminder candidates from a parsed note. */
export function reminderCandidates(
    noteId: string,
    lines: ParsedLine[],
    ref: Date = new Date(),
): ReminderCandidate[] {
    const candidates: ReminderCandidate[] = [];

    for (const line of lines) {
        const at = resolveReminderAt(line, ref);

        if (at === null) {
            continue;
        }

        candidates.push({
            noteId,
            line,
            at,
            key: reminderKey(noteId, line, at),
        });
    }

    return candidates;
}
