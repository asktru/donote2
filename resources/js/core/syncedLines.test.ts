import { describe, expect, it } from 'vitest';

import { parseLine } from './parser';
import { buildNextOccurrenceLine } from './repeat';
import {
    applySyncedLine,
    changedSyncedLines,
    collectSyncedLines,
    generateSyncId,
} from './syncedLines';

describe('parseLine — sync ids', () => {
    it('extracts the sync id and strips it from the title', () => {
        const line = parseLine('- [ ] Ship the release ^abc123');

        expect(line.syncId).toBe('abc123');
        expect(line.title).toBe('Ship the release');
    });

    it('works on bullets, text and checklists', () => {
        expect(parseLine('- a bullet ^id42x').syncId).toBe('id42x');
        expect(parseLine('plain paragraph ^zz99aa').syncId).toBe('zz99aa');
        expect(parseLine('+ [ ] pack it ^q1w2e3').syncId).toBe('q1w2e3');
    });

    it('ignores carets elsewhere in the line', () => {
        expect(parseLine('- [ ] math 2^10 stuff').syncId).toBeNull();
        expect(parseLine('- [ ] mid ^abc123 not at end x').syncId).toBeNull();
    });
});

describe('collectSyncedLines', () => {
    it('groups bodies by id, dropping indentation', () => {
        const map = collectSyncedLines(
            ['- [ ] Task one ^aaa111', '    - [ ] Nested ^bbb222', 'text'].join(
                '\n',
            ),
        );

        expect(map.get('aaa111')).toEqual(['- [ ] Task one ^aaa111']);
        expect(map.get('bbb222')).toEqual(['- [ ] Nested ^bbb222']);
    });
});

describe('changedSyncedLines', () => {
    it('detects an edited synced line', () => {
        const before = '- [ ] Draft report ^aaa111\n- [ ] Other ^bbb222';
        const after = '- [x] Draft report v2 ^aaa111\n- [ ] Other ^bbb222';

        const changed = changedSyncedLines(before, after);

        expect(changed.get('aaa111')).toBe('- [x] Draft report v2 ^aaa111');
        expect(changed.has('bbb222')).toBe(false);
    });

    it('detects a newly pasted synced line', () => {
        const changed = changedSyncedLines('nothing', '- [ ] Pasted ^ccc333');

        expect(changed.get('ccc333')).toBe('- [ ] Pasted ^ccc333');
    });

    it('picks the edited copy when a note holds duplicates', () => {
        const before = '- [ ] Same ^aaa111\n- [ ] Same ^aaa111';
        const after = '- [ ] Same ^aaa111\n- [x] Edited copy ^aaa111';

        expect(changedSyncedLines(before, after).get('aaa111')).toBe(
            '- [x] Edited copy ^aaa111',
        );
    });
});

describe('applySyncedLine', () => {
    it('rewrites every occurrence, preserving local indentation', () => {
        const content = [
            '# Note',
            '- [ ] Old text ^aaa111',
            '    - [ ] Old text ^aaa111',
            '- [ ] Unrelated ^bbb222',
        ].join('\n');

        const next = applySyncedLine(
            content,
            'aaa111',
            '- [x] New text ^aaa111',
        );

        expect(next).toBe(
            [
                '# Note',
                '- [x] New text ^aaa111',
                '    - [x] New text ^aaa111',
                '- [ ] Unrelated ^bbb222',
            ].join('\n'),
        );
    });

    it('returns null when nothing changes', () => {
        expect(
            applySyncedLine(
                '- [ ] Same ^aaa111',
                'aaa111',
                '- [ ] Same ^aaa111',
            ),
        ).toBeNull();
        expect(applySyncedLine('no ids here', 'aaa111', 'body')).toBeNull();
    });
});

describe('repeat + synced lines', () => {
    it('drops the sync id from the next occurrence', () => {
        const line = parseLine(
            '- [x] Water plants >2026-07-11 @repeat(3d) ^aaa111',
        );

        expect(buildNextOccurrenceLine(line, '2026-07-11')).toBe(
            '- [ ] Water plants >2026-07-14 @repeat(3d)',
        );
    });
});

describe('generateSyncId', () => {
    it('produces 6-char base36 ids', () => {
        for (let i = 0; i < 20; i++) {
            expect(generateSyncId()).toMatch(/^[a-z0-9]{6}$/);
        }
    });
});
