import { describe, expect, it } from 'vitest';

import { PRIORITY_COLORS, priorityColor } from './priority';

describe('priorityColor', () => {
    it('has no colour for priority 0', () => {
        expect(priorityColor(0)).toBeNull();
    });

    it('maps each priority to its palette colour', () => {
        expect(priorityColor(1)).toBe(PRIORITY_COLORS[1]);
        expect(priorityColor(2)).toBe(PRIORITY_COLORS[2]);
        expect(priorityColor(3)).toBe(PRIORITY_COLORS[3]);
    });

    it('climbs blue → orange → red with urgency', () => {
        expect(PRIORITY_COLORS[1]).toBe('#246fe0');
        expect(PRIORITY_COLORS[2]).toBe('#eb8909');
        expect(PRIORITY_COLORS[3]).toBe('#dc4c3e');
    });
});
