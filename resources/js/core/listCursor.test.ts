import { describe, expect, it } from 'vitest';

import { wrapIndex } from '@/core/listCursor';

describe('wrapIndex', () => {
    it('steps forward and back', () => {
        expect(wrapIndex(0, 1, 3)).toBe(1);
        expect(wrapIndex(2, -1, 3)).toBe(1);
    });

    it('wraps past the end round to the start', () => {
        expect(wrapIndex(2, 1, 3)).toBe(0);
    });

    it('wraps before the start round to the end', () => {
        expect(wrapIndex(0, -1, 3)).toBe(2);
    });

    it('stays at zero for an empty list', () => {
        expect(wrapIndex(0, 1, 0)).toBe(0);
        expect(wrapIndex(0, -1, 0)).toBe(0);
    });

    it('keeps a stale index inside the list', () => {
        expect(wrapIndex(7, 1, 3)).toBe(2);
    });
});
