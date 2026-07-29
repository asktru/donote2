import { describe, expect, it } from 'vitest';

import { pickMeetEvent } from '@/core/meetTarget';

const NOW = new Date('2026-07-15T12:00:00Z');

function candidate(
    start: string,
    end: string,
    link: string | null = 'https://meet.google.com/abc',
    allDay = false,
) {
    return { start, end, allDay, hangoutLink: link };
}

describe('pickMeetEvent', () => {
    it('prefers an event in progress', () => {
        const events = [
            candidate(
                '2026-07-15T12:30:00Z',
                '2026-07-15T13:00:00Z',
                'https://meet.google.com/next',
            ),
            candidate(
                '2026-07-15T11:45:00Z',
                '2026-07-15T12:15:00Z',
                'https://meet.google.com/now',
            ),
        ];

        expect(pickMeetEvent(events, NOW)?.hangoutLink).toBe(
            'https://meet.google.com/now',
        );
    });

    it('treats an event starting exactly now as in progress', () => {
        const events = [candidate('2026-07-15T12:00:00Z', '2026-07-15T12:30:00Z')];

        expect(pickMeetEvent(events, NOW)).not.toBeNull();
    });

    it('falls back to the soonest event starting within the hour', () => {
        const events = [
            candidate(
                '2026-07-15T12:50:00Z',
                '2026-07-15T13:20:00Z',
                'https://meet.google.com/later',
            ),
            candidate(
                '2026-07-15T12:10:00Z',
                '2026-07-15T12:40:00Z',
                'https://meet.google.com/soon',
            ),
        ];

        expect(pickMeetEvent(events, NOW)?.hangoutLink).toBe(
            'https://meet.google.com/soon',
        );
    });

    it('ignores an event starting beyond the hour', () => {
        const events = [candidate('2026-07-15T13:30:00Z', '2026-07-15T14:00:00Z')];

        expect(pickMeetEvent(events, NOW)).toBeNull();
    });

    it('skips events with no Meet link', () => {
        const events = [
            candidate('2026-07-15T11:45:00Z', '2026-07-15T12:15:00Z', null),
            candidate(
                '2026-07-15T12:20:00Z',
                '2026-07-15T12:50:00Z',
                'https://meet.google.com/ok',
            ),
        ];

        expect(pickMeetEvent(events, NOW)?.hangoutLink).toBe(
            'https://meet.google.com/ok',
        );
    });

    it('skips an empty-string Meet link', () => {
        const events = [
            candidate('2026-07-15T12:10:00Z', '2026-07-15T12:40:00Z', ''),
        ];

        expect(pickMeetEvent(events, NOW)).toBeNull();
    });

    it('ignores all-day events', () => {
        const events = [
            candidate(
                '2026-07-15',
                '2026-07-16',
                'https://meet.google.com/allday',
                true,
            ),
        ];

        expect(pickMeetEvent(events, NOW)).toBeNull();
    });

    it('returns null for an empty list', () => {
        expect(pickMeetEvent([], NOW)).toBeNull();
    });
});
