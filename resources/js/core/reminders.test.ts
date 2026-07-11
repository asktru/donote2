import { describe, expect, it } from 'vitest';

import { parseLine, parseNote } from './parser';
import { reminderCandidates, resolveReminderAt } from './reminders';

const ref = new Date(2026, 6, 11, 6, 0); // Sat July 11 2026, 06:00

describe('resolveReminderAt', () => {
    it('fires today when the task has no schedule', () => {
        const at = resolveReminderAt(parseLine('- [ ] Standup @8am'), ref);
        expect(at?.getFullYear()).toBe(2026);
        expect(at?.getMonth()).toBe(6);
        expect(at?.getDate()).toBe(11);
        expect(at?.getHours()).toBe(8);
    });

    it('fires on the scheduled day', () => {
        const at = resolveReminderAt(
            parseLine('- [ ] Call @2:30pm >2026-07-15'),
            ref,
        );
        expect(at?.getDate()).toBe(15);
        expect(at?.getHours()).toBe(14);
        expect(at?.getMinutes()).toBe(30);
    });

    it('uses the first day of week schedules', () => {
        const at = resolveReminderAt(
            parseLine('- [ ] Weekly review @9am >2026-W29'),
            ref,
        );
        expect(at?.getDate()).toBe(13); // Monday July 13th
    });

    it('returns null for done tasks and tasks without reminders', () => {
        expect(resolveReminderAt(parseLine('- [x] Done @8am'), ref)).toBeNull();
        expect(resolveReminderAt(parseLine('- [ ] No time'), ref)).toBeNull();
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
        const candidates = reminderCandidates('note-1', lines, ref);

        expect(candidates).toHaveLength(1);
        expect(candidates[0].key).toContain('note-1');
        expect(candidates[0].at.getHours()).toBe(9);
    });
});
