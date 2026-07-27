import { describe, expect, it } from 'vitest';

import { searchZones, zoneCity, zoneOffsetLabel } from './timezones';

const ZONES = [
    'Europe/Kiev',
    'Europe/Lisbon',
    'Europe/London',
    'America/New_York',
    'Asia/Kolkata',
    'Pacific/Auckland',
];

describe('zoneCity', () => {
    it('takes the last segment and un-underscores it', () => {
        expect(zoneCity('America/New_York')).toBe('New York');
        expect(zoneCity('Europe/Kiev')).toBe('Kiev');
        expect(zoneCity('UTC')).toBe('UTC');
    });
});

describe('zoneOffsetLabel', () => {
    const winter = new Date('2026-01-15T12:00:00Z');

    it('labels whole-hour offsets either side of UTC', () => {
        expect(zoneOffsetLabel('Europe/London', winter)).toBe('UTC+0');
        expect(zoneOffsetLabel('Europe/Kiev', winter)).toBe('UTC+2');
        expect(zoneOffsetLabel('America/New_York', winter)).toBe('UTC−5');
    });

    it('labels half-hour offsets', () => {
        expect(zoneOffsetLabel('Asia/Kolkata', winter)).toBe('UTC+5:30');
    });
});

describe('searchZones', () => {
    it('matches the city, case-insensitively', () => {
        expect(searchZones(ZONES, 'kiev')).toEqual(['Europe/Kiev']);
        expect(searchZones(ZONES, 'NEW YORK')).toEqual(['America/New_York']);
    });

    it('matches across the underscore the id uses', () => {
        expect(searchZones(ZONES, 'new_york')).toEqual(['America/New_York']);
    });

    it('matches the region too', () => {
        expect(searchZones(ZONES, 'europe')).toEqual([
            'Europe/Kiev',
            'Europe/Lisbon',
            'Europe/London',
        ]);
    });

    it('ranks a city that starts with the query above one that contains it', () => {
        expect(
            searchZones(['Europe/London', 'Europe/Londrina'], 'lond'),
        ).toEqual(['Europe/London', 'Europe/Londrina']);
        expect(
            searchZones(['America/Fort_Nelson', 'Europe/Lisbon'], 'lis'),
        ).toEqual(['Europe/Lisbon']);
    });

    it('returns everything for an empty query, capped', () => {
        expect(searchZones(ZONES, '  ')).toEqual(ZONES);
        expect(searchZones(ZONES, '', 2)).toHaveLength(2);
    });
});
