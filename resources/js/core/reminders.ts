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

/**
 * How long after its time a missed reminder still pops up — reminders from
 * more than half a day ago are stale rather than missed.
 */
export const REMINDER_GRACE_MS = 12 * 3600 * 1000;

/** Whether a reminder should be on screen right now. */
export function isReminderDue(
    candidate: ReminderCandidate,
    now: number,
): boolean {
    const at = candidate.at.getTime();

    return at <= now && now - at <= REMINDER_GRACE_MS;
}

/**
 * The task a popup is pinned to, independent of its text: the popup follows
 * the line as it's edited instead of being replaced (which would re-fire a
 * reminder mid-keystroke, since a reminder's key includes its title).
 */
export function reminderSlot(candidate: ReminderCandidate): string {
    return `${candidate.noteId}:${candidate.line.index}`;
}

/**
 * Bring the reminders on screen back in line with the notes, as they stand
 * after an edit or a sync: a reminder whose task was completed, cancelled,
 * deleted, rescheduled or stripped of its `@time` is dropped, and the ones
 * that remain are replaced by their current version so the popup shows the
 * task's live title and time.
 */
export function refreshDueReminders(
    active: ReminderCandidate[],
    live: Map<string, ReminderCandidate>,
    now: number,
): ReminderCandidate[] {
    return active.flatMap((candidate) => {
        const fresh = live.get(reminderSlot(candidate));

        return fresh && isReminderDue(fresh, now) ? [fresh] : [];
    });
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
