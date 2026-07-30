import { describe, expect, it } from 'vitest';

import { parseLine, parseNote } from './parser';
import {
    formatReminderToken,
    isReminderDue,
    refreshDueReminders,
    REMINDER_GRACE_MS,
    reminderCandidates,
    reminderSlot,
    resolveReminderAt,
} from './reminders';

// Sat July 11th 2026 — the day key of the note a task sits in.
const today = '2026-07-11';

describe('resolveReminderAt', () => {
    it('fires on its note’s day when the task has no schedule', () => {
        const at = resolveReminderAt(parseLine('- [ ] Standup @8am'), today);
        expect(at?.getFullYear()).toBe(2026);
        expect(at?.getMonth()).toBe(6);
        expect(at?.getDate()).toBe(11);
        expect(at?.getHours()).toBe(8);
    });

    it('follows the task to another daily note', () => {
        // Moving the line is what reschedules it: nothing about the line
        // itself changes, only the note holding it.
        const at = resolveReminderAt(parseLine('- [ ] Standup @8am'), '2026-07-15');

        expect(at?.getDate()).toBe(15);
        expect(at?.getHours()).toBe(8);
    });

    it('does not fire at all without a schedule or a daily note', () => {
        expect(resolveReminderAt(parseLine('- [ ] Standup @8am'), null)).toBeNull();
    });

    it('fires on the scheduled day', () => {
        const at = resolveReminderAt(
            parseLine('- [ ] Call @2:30pm >2026-07-15'),
            today,
        );
        expect(at?.getDate()).toBe(15);
        expect(at?.getHours()).toBe(14);
        expect(at?.getMinutes()).toBe(30);
    });

    it('lets an explicit schedule win over the note’s own day', () => {
        const at = resolveReminderAt(
            parseLine('- [ ] Call @2:30pm >2026-07-15'),
            '2026-07-20',
        );

        expect(at?.getDate()).toBe(15);
    });

    it('uses the first day of week schedules', () => {
        const at = resolveReminderAt(
            parseLine('- [ ] Weekly review @9am >2026-W29'),
            today,
        );
        expect(at?.getDate()).toBe(13); // Monday July 13th
    });

    it('returns null for done tasks and tasks without reminders', () => {
        expect(
            resolveReminderAt(parseLine('- [x] Done @8am'), today),
        ).toBeNull();
        expect(resolveReminderAt(parseLine('- [ ] No time'), today)).toBeNull();
        expect(resolveReminderAt(parseLine('- [ ] No time'), null)).toBeNull();
    });
});

describe('formatReminderToken', () => {
    it('formats am/pm tokens the parser understands', () => {
        expect(formatReminderToken(new Date(2026, 6, 11, 9, 0))).toBe('@9am');
        expect(formatReminderToken(new Date(2026, 6, 11, 14, 42))).toBe(
            '@2:42pm',
        );
        expect(formatReminderToken(new Date(2026, 6, 11, 0, 5))).toBe(
            '@12:05am',
        );
        expect(formatReminderToken(new Date(2026, 6, 11, 12, 0))).toBe('@12pm');
    });

    it('round-trips through parseLine', () => {
        const token = formatReminderToken(new Date(2026, 6, 11, 15, 7));
        const line = parseLine(`- [ ] Task ${token}`);

        expect(line.reminderMinutes).toBe(15 * 60 + 7);
    });
});

describe('reminderCandidates', () => {
    it('collects open reminders with stable keys', () => {
        const lines = parseNote(
            [
                '- [ ] Standup @9am',
                '- [x] Done thing @8am',
                '- [ ] Plain task',
            ].join('\n'),
        );
        const candidates = reminderCandidates('note-1', lines, today);

        expect(candidates).toHaveLength(1);
        expect(candidates[0].key).toContain('note-1');
        expect(candidates[0].at.getHours()).toBe(9);
    });

    it('collects nothing from a note that is not a daily note', () => {
        // A project note's `@9am` has no day to fire on.
        const lines = parseNote('- [ ] Standup @9am');

        expect(reminderCandidates('note-1', lines, null)).toEqual([]);
    });

    it('still collects a scheduled reminder from a non-daily note', () => {
        const lines = parseNote('- [ ] Standup @9am >2026-07-15');

        expect(reminderCandidates('note-1', lines, null)).toHaveLength(1);
    });
});

/** The reminders a note currently holds, keyed by slot — what a popup tracks. */
function liveFrom(noteId: string, markdown: string, dayKey = today) {
    return new Map(
        reminderCandidates(noteId, parseNote(markdown), dayKey).map(
            (candidate) => [reminderSlot(candidate), candidate],
        ),
    );
}

describe('isReminderDue', () => {
    const [candidate] = reminderCandidates(
        'note-1',
        parseNote('- [ ] Standup @9am'),
        today,
    );
    const at = candidate.at.getTime();

    it('is due from its time until the grace window closes', () => {
        expect(isReminderDue(candidate, at - 60_000)).toBe(false);
        expect(isReminderDue(candidate, at)).toBe(true);
        expect(isReminderDue(candidate, at + REMINDER_GRACE_MS)).toBe(true);
        expect(isReminderDue(candidate, at + REMINDER_GRACE_MS + 1)).toBe(
            false,
        );
    });
});

describe('refreshDueReminders', () => {
    const noteId = 'note-1';
    const shownAt = new Date(2026, 6, 11, 9, 30).getTime(); // half an hour late

    /** A reminder popped up for "- [ ] Standup @9am". */
    function shown() {
        return [...liveFrom(noteId, '- [ ] Standup @9am').values()];
    }

    it('keeps a reminder whose task is still open', () => {
        const live = liveFrom(noteId, '- [ ] Standup @9am');

        expect(refreshDueReminders(shown(), live, shownAt)).toHaveLength(1);
    });

    it.each([
        ['completed', '- [x] Standup @9am'],
        ['cancelled', '- [-] Standup @9am'],
        ['stripped of its reminder', '- [ ] Standup'],
        ['turned into plain text', 'Standup'],
    ])('drops a reminder whose task was %s', (_case, markdown) => {
        const live = liveFrom(noteId, markdown);

        expect(refreshDueReminders(shown(), live, shownAt)).toEqual([]);
    });

    it('drops a reminder whose note is gone', () => {
        expect(refreshDueReminders(shown(), new Map(), shownAt)).toEqual([]);
    });

    it('drops a reminder rescheduled into the future', () => {
        // Snoozed by rewriting the token — the popup goes away rather than
        // lingering with the old time.
        const live = liveFrom(noteId, '- [ ] Standup @11am');

        expect(refreshDueReminders(shown(), live, shownAt)).toEqual([]);
    });

    it('drops a reminder that has aged past the grace window', () => {
        const live = liveFrom(noteId, '- [ ] Standup @9am');
        const stale = shownAt + REMINDER_GRACE_MS;

        expect(refreshDueReminders(shown(), live, stale)).toEqual([]);
    });

    it('follows an edited task instead of re-firing it', () => {
        // The key carries the title, so an edit yields a different key — the
        // popup has to track the line, and pick up the new text in place.
        const live = liveFrom(noteId, '- [ ] Standup with the team @9am');
        const [refreshed] = refreshDueReminders(shown(), live, shownAt);

        expect(refreshed.line.title).toBe('Standup with the team');
        expect(refreshed.key).not.toBe(shown()[0].key);
    });

    it('keeps each note’s reminders apart', () => {
        const live = liveFrom('note-2', '- [ ] Standup @9am');

        expect(refreshDueReminders(shown(), live, shownAt)).toEqual([]);
    });
});
