import { describe, expect, it } from 'vitest';

import { notificationId } from './notifications';

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
