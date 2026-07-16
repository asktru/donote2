import { describe, expect, it } from 'vitest';

import { canEditNote, isMassPrune, notesToPrune } from './noteAccess';

describe('isMassPrune', () => {
    it('flags a prune that would remove most of the workspace', () => {
        expect(isMassPrune(1580, 1580)).toBe(true);
        expect(isMassPrune(800, 1000)).toBe(true);
    });

    it('allows ordinary revocation-sized prunes', () => {
        expect(isMassPrune(1, 1580)).toBe(false);
        expect(isMassPrune(25, 1580)).toBe(false);
        expect(isMassPrune(100, 1580)).toBe(false);
    });

    it('allows clearing out a tiny workspace', () => {
        // Small absolute counts are never a catastrophe — don't block them.
        expect(isMassPrune(5, 5)).toBe(false);
        expect(isMassPrune(25, 30)).toBe(false);
    });
});

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

const synced = (id: string) => ({ id, version: 3, dirty: 0 });

describe('notesToPrune', () => {
    it('drops notes that are no longer visible', () => {
        expect(
            notesToPrune(
                [synced('a'), synced('b'), synced('c')],
                new Set(['a', 'c']),
            ),
        ).toEqual(['b']);
    });

    it('keeps notes that are still visible', () => {
        expect(
            notesToPrune([synced('a'), synced('b')], new Set(['a', 'b'])),
        ).toEqual([]);
    });

    it('never prunes a dirty note, even if not yet visible on the server', () => {
        expect(
            notesToPrune(
                [{ id: 'new-local', version: 0, dirty: 1 }, synced('revoked')],
                new Set(),
            ),
        ).toEqual(['revoked']);
    });

    it('never prunes a never-synced note (calendar placeholders)', () => {
        // A lazily created daily-note placeholder is clean (dirty: 0) and has
        // version 0 — the server has never seen it, so its absence from the
        // visible set is expected, not evidence of remote deletion.
        expect(
            notesToPrune(
                [{ id: 'placeholder', version: 0, dirty: 0 }, synced('revoked')],
                new Set(),
            ),
        ).toEqual(['revoked']);
    });
});
