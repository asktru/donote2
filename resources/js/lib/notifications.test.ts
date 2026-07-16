import { describe, expect, it } from 'vitest';

import { notificationId, staleNotificationIds } from './notifications';

describe('staleNotificationIds', () => {
    it('cancels the current team’s reminders that are no longer desired', () => {
        expect(
            staleNotificationIds(
                [
                    { id: 1, teamSlug: 'alpha' },
                    { id: 2, teamSlug: 'alpha' },
                ],
                new Set([2]),
                'alpha',
            ),
        ).toEqual([1]);
    });

    it('leaves other teams’ scheduled reminders alone', () => {
        // Opening team B must not wipe team A's schedule — B's desired set
        // simply doesn't contain A's notes.
        expect(
            staleNotificationIds(
                [
                    { id: 1, teamSlug: 'alpha' },
                    { id: 2, teamSlug: 'beta' },
                ],
                new Set(),
                'beta',
            ),
        ).toEqual([2]);
    });

    it('treats legacy untagged reminders as the current team’s', () => {
        expect(
            staleNotificationIds([{ id: 7, teamSlug: null }], new Set(), 'alpha'),
        ).toEqual([7]);
    });

    it('never cancels reminders that are still desired', () => {
        expect(
            staleNotificationIds(
                [{ id: 1, teamSlug: 'alpha' }],
                new Set([1]),
                'alpha',
            ),
        ).toEqual([]);
    });
});

describe('notificationId', () => {
    it('is deterministic for the same reminder key', () => {
        const key = 'note-1|Water plants|1752566400000';

        expect(notificationId(key)).toBe(notificationId(key));
    });

    it('changes when the reminder key changes (e.g. rescheduled time)', () => {
        const base = 'note-1|Water plants|';

        expect(notificationId(`${base}1752566400000`)).not.toBe(
            notificationId(`${base}1752652800000`),
        );
    });

    it('always produces a non-negative 31-bit integer', () => {
        for (const key of ['', 'a', 'note|Very long title '.repeat(20), '🔥']) {
            const id = notificationId(key);

            expect(Number.isInteger(id)).toBe(true);
            expect(id).toBeGreaterThanOrEqual(0);
            expect(id).toBeLessThan(0x7fffffff);
        }
    });
});
