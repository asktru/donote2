import { describe, expect, it } from 'vitest';

import { meetWithEscape } from '@/core/meetWith';

describe('meetWithEscape', () => {
    it('clears a typed query first', () => {
        expect(meetWithEscape({ typed: true, selected: 0 })).toBe('clear');
    });

    it('clears the overlaid people when nothing is typed', () => {
        expect(meetWithEscape({ typed: false, selected: 2 })).toBe('clear');
    });

    it('dismisses once there is nothing left to clear', () => {
        expect(meetWithEscape({ typed: false, selected: 0 })).toBe('dismiss');
    });
});
