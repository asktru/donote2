import { describe, expect, it, vi } from 'vitest';

import { wrapNativePlugin } from './appleCalendar';
import type { AppleCalendar, AppleEvent } from './appleCalendar';

describe('wrapNativePlugin', () => {
    const calendar: AppleCalendar = {
        id: 'cal-1',
        title: 'Home',
        color: '#ff0000',
        source: 'iCloud',
    };
    const event: AppleEvent = {
        id: 'series-1@1700000000',
        seriesId: 'series-1',
        calendarId: 'cal-1',
        calendarTitle: 'Home',
        title: 'Standup',
        start: '2026-07-12T09:00:00Z',
        end: '2026-07-12T09:15:00Z',
        allDay: false,
        location: null,
        isRecurring: true,
    };

    it('unwraps the native { calendars } envelope to a bare array', async () => {
        const bridge = wrapNativePlugin({
            status: vi.fn(),
            requestAccess: vi.fn(),
            calendars: vi.fn().mockResolvedValue({ calendars: [calendar] }),
            events: vi.fn(),
        });

        await expect(bridge.calendars()).resolves.toEqual([calendar]);
    });

    it('passes the date range as an options object and unwraps { events }', async () => {
        const events = vi.fn().mockResolvedValue({ events: [event] });
        const bridge = wrapNativePlugin({
            status: vi.fn(),
            requestAccess: vi.fn(),
            calendars: vi.fn(),
            events,
        });

        const result = await bridge.events('2026-07-12T00:00:00Z', '2026-07-13T00:00:00Z');

        expect(events).toHaveBeenCalledWith({
            from: '2026-07-12T00:00:00Z',
            to: '2026-07-13T00:00:00Z',
        });
        expect(result).toEqual([event]);
    });

    it('passes status and requestAccess through untouched', async () => {
        const bridge = wrapNativePlugin({
            status: vi.fn().mockResolvedValue({ status: 'authorized' }),
            requestAccess: vi.fn().mockResolvedValue({ granted: true }),
            calendars: vi.fn(),
            events: vi.fn(),
        });

        await expect(bridge.status()).resolves.toEqual({ status: 'authorized' });
        await expect(bridge.requestAccess()).resolves.toEqual({ granted: true });
    });
});
