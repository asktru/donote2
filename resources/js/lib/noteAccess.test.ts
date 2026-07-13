import { describe, expect, it } from 'vitest';

import { canEditNote, notesToPrune } from './noteAccess';

describe('canEditNote', () => {
    it('lets owners edit online or offline', () => {
        expect(canEditNote('owner', true)).toBe(true);
        expect(canEditNote('owner', false)).toBe(true);
    });

    it('lets write collaborators edit only while online', () => {
        expect(canEditNote('write', true)).toBe(true);
        expect(canEditNote('write', false)).toBe(false);
    });

    it('never lets read recipients edit', () => {
        expect(canEditNote('read', true)).toBe(false);
        expect(canEditNote('read', false)).toBe(false);
    });
});

describe('notesToPrune', () => {
    it('drops notes that are no longer visible', () => {
        expect(
            notesToPrune(['a', 'b', 'c'], new Set(['a', 'c']), new Set()),
        ).toEqual(['b']);
    });

    it('keeps notes that are still visible', () => {
        expect(
            notesToPrune(['a', 'b'], new Set(['a', 'b']), new Set()),
        ).toEqual([]);
    });

    it('never prunes a dirty note, even if not yet visible on the server', () => {
        expect(
            notesToPrune(['new-local', 'revoked'], new Set(), new Set(['new-local'])),
        ).toEqual(['revoked']);
    });
});
