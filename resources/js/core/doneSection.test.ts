import { describe, expect, it } from 'vitest';

import {
    appendToBody,
    DONE_HEADING_RE,
    ensureDoneSection,
    findDoneHeading,
    hasFileableWork,
    insertUnderPath,
    liftableBlocks,
    movableBlocks,
    pathOf,
    refileCompleted,
    renderStep,
} from './doneSection';
import { parseNote } from './parser';

describe('DONE_HEADING_RE', () => {
    it('matches the section heading, with or without the fold marker', () => {
        expect(DONE_HEADING_RE.test('# Done')).toBe(true);
        expect(DONE_HEADING_RE.test('# Done …')).toBe(true);
        expect(DONE_HEADING_RE.test('# done')).toBe(true);
    });

    it('does not match a heading that merely mentions done', () => {
        expect(DONE_HEADING_RE.test('## Done')).toBe(false);
        expect(DONE_HEADING_RE.test('# Done deals')).toBe(false);
        expect(DONE_HEADING_RE.test('    # Done')).toBe(false);
        expect(DONE_HEADING_RE.test('- [ ] Done')).toBe(false);
    });
});

describe('findDoneHeading', () => {
    it('finds the last one, so an earlier mention never wins', () => {
        expect(findDoneHeading(['# Done', 'text', '---', '# Done …'])).toBe(3);
    });

    it('returns -1 when the note has no section', () => {
        expect(findDoneHeading(['# Launch', '- [x] a'])).toBe(-1);
    });
});

describe('pathOf', () => {
    const NOTE = [
        '# Launch',
        '## Prep',
        '### Copy',
        '- Meeting notes',
        '    - [x] Write the announcement',
        '# Research',
        '- [x] Read the teardown',
        '- [ ] Skim the docs',
    ].join('\n');

    it('collects the heading trail outermost first, one per level', () => {
        expect(pathOf(parseNote(NOTE), 6, -1)).toEqual([
            { kind: 'heading', level: 1, text: 'Research' },
        ]);
    });

    it('includes bullet ancestors after the headings', () => {
        expect(pathOf(parseNote(NOTE), 4, -1)).toEqual([
            { kind: 'heading', level: 1, text: 'Launch' },
            { kind: 'heading', level: 2, text: 'Prep' },
            { kind: 'heading', level: 3, text: 'Copy' },
            { kind: 'bullet', raw: '- Meeting notes', text: 'Meeting notes' },
        ]);
    });

    it('is empty for a line under nothing', () => {
        expect(pathOf(parseNote('- [x] Loose task'), 0, -1)).toEqual([]);
    });

    it('stops at the line the search starts from', () => {
        // Reading a path inside Done must not escape into the body above it.
        const lines = parseNote(
            ['# Launch', '---', '# Done', '## Research', '- [ ] Reopened'].join(
                '\n',
            ),
        );

        expect(pathOf(lines, 4, 2)).toEqual([
            { kind: 'heading', level: 2, text: 'Research' },
        ]);
    });
});

describe('renderStep', () => {
    it('demotes a heading one level when writing into Done', () => {
        expect(
            renderStep({ kind: 'heading', level: 1, text: 'Launch' }, 0, true),
        ).toBe('## Launch');
        expect(
            renderStep({ kind: 'heading', level: 3, text: 'Copy' }, 0, true),
        ).toBe('#### Copy');
    });

    it('clamps at h6, which cannot demote further', () => {
        expect(
            renderStep({ kind: 'heading', level: 6, text: 'Deep' }, 0, true),
        ).toBe('###### Deep');
    });

    it('writes the level as-is when lifting back into the body', () => {
        expect(
            renderStep({ kind: 'heading', level: 2, text: 'Prep' }, 0, false),
        ).toBe('## Prep');
    });

    it('indents a bullet by its depth and keeps its text verbatim', () => {
        const step = {
            kind: 'bullet' as const,
            raw: '- Meeting notes',
            text: 'Meeting notes',
        };

        expect(renderStep(step, 0, true)).toBe('- Meeting notes');
        expect(renderStep(step, 2, true)).toBe('        - Meeting notes');
    });
});

describe('movableBlocks', () => {
    /** Titles of the lines each block covers, for readable assertions. */
    function moved(note: string): string[][] {
        const lines = parseNote(note);

        return movableBlocks(lines, lines.length).map((block) =>
            lines
                .slice(block.start, block.end + 1)
                .map((line) => line.title || line.raw),
        );
    }

    it('moves a closed task whose subtree is closed', () => {
        expect(moved(['- [x] Tag v1.0', '- [ ] Ship it'].join('\n'))).toEqual([
            ['Tag v1.0'],
        ]);
    });

    it('treats cancelled as closed and scheduled as open', () => {
        expect(moved(['- [-] Dropped', '- [>] Later'].join('\n'))).toEqual([
            ['Dropped'],
        ]);
    });

    it('keeps a closed parent that still holds open work', () => {
        expect(
            moved(
                [
                    '- [x] Prepare release',
                    '    - [ ] Write changelog',
                    '    - [x] Update the docs',
                ].join('\n'),
            ),
        ).toEqual([]);
    });

    it('keeps a closed subtask under an open parent', () => {
        expect(
            moved(
                ['- [ ] Prepare release', '    - [x] Update the docs'].join(
                    '\n',
                ),
            ),
        ).toEqual([]);
    });

    it('takes the whole subtree when the outermost line qualifies', () => {
        expect(
            moved(
                [
                    '- [x] Prepare release',
                    '    - [x] Update the docs',
                    '        context',
                    '    + [-] Proofread',
                ].join('\n'),
            ),
        ).toEqual([
            ['Prepare release', 'Update the docs', 'context', 'Proofread'],
        ]);
    });

    it('moves a closed task under a bullet — bullets are neutral', () => {
        expect(
            moved(
                ['- Meeting notes', '    - [x] Write the announcement'].join(
                    '\n',
                ),
            ),
        ).toEqual([['Write the announcement']]);
    });

    it('stops at the limit, so the Done section is never re-filed', () => {
        const lines = parseNote(
            ['- [x] Body task', '---', '# Done', '- [x] Filed'].join('\n'),
        );

        expect(movableBlocks(lines, 1)).toEqual([{ start: 0, end: 0 }]);
    });
});

describe('liftableBlocks', () => {
    it('lifts an outermost re-opened item with its subtree', () => {
        const lines = parseNote(
            [
                '# Launch',
                '---',
                '# Done',
                '## Launch',
                '- [ ] Write changelog',
                '    - [x] Draft it',
                '- [x] Tag v1.0',
            ].join('\n'),
        );

        expect(liftableBlocks(lines, 2)).toEqual([{ start: 4, end: 5 }]);
    });

    it('leaves a closed section alone', () => {
        const lines = parseNote(['---', '# Done', '- [x] Tag v1.0'].join('\n'));

        expect(liftableBlocks(lines, 1)).toEqual([]);
    });
});

describe('appendToBody', () => {
    it('appends above the Done section, not into it', () => {
        const note = [
            '# Launch',
            '- [ ] Ship it',
            '',
            '---',
            '# Done …',
            '## Launch',
            '- [x] Tag v1.0',
        ].join('\n');

        expect(appendToBody(note, '- [ ] From the agenda').split('\n')).toEqual([
            '# Launch',
            '- [ ] Ship it',
            '',
            '- [ ] From the agenda',
            '',
            '---',
            '# Done …',
            '## Launch',
            '- [x] Tag v1.0',
        ]);
    });

    it('appends at the end when there is no section', () => {
        expect(appendToBody('# Launch\n- [ ] Ship it', '- [ ] New')).toBe(
            '# Launch\n- [ ] Ship it\n\n- [ ] New\n',
        );
    });

    it('handles a note that is nothing but a Done section', () => {
        const note = ['---', '# Done …', '- [x] Tag v1.0'].join('\n');

        expect(appendToBody(note, '- [ ] New').split('\n')).toEqual([
            '- [ ] New',
            '',
            '---',
            '# Done …',
            '- [x] Tag v1.0',
        ]);
    });

    it('starts an empty note without a leading blank line', () => {
        expect(appendToBody('', '- [ ] New')).toBe('- [ ] New\n');
    });

    it('leaves the note alone when the block is empty', () => {
        expect(appendToBody('# Launch', '   ')).toBe('# Launch');
    });
});

describe('ensureDoneSection', () => {
    it('appends a collapsed section with a separator', () => {
        expect(ensureDoneSection('# Launch\n- [ ] Ship it')).toBe(
            ['# Launch', '- [ ] Ship it', '', '---', '# Done …', ''].join('\n'),
        );
    });

    it('adopts a section the note already has', () => {
        const content = ['# Launch', '', '---', '# Done …', '- [x] a'].join(
            '\n',
        );

        expect(ensureDoneSection(content)).toBe(content);
    });
});

describe('insertUnderPath', () => {
    const BASE = ['# Launch', '- [ ] Ship it', '', '---', '# Done …', ''].join(
        '\n',
    );

    it('rebuilds a missing heading path, demoted, and appends the block', () => {
        const next = insertUnderPath(
            BASE,
            [{ kind: 'heading', level: 1, text: 'Launch' }],
            ['- [x] Tag v1.0'],
            'done',
        );

        expect(next.split('\n')).toEqual([
            '# Launch',
            '- [ ] Ship it',
            '',
            '---',
            '# Done …',
            '## Launch',
            '- [x] Tag v1.0',
            '',
        ]);
    });

    it('merges into a group that is already there', () => {
        const once = insertUnderPath(
            BASE,
            [{ kind: 'heading', level: 1, text: 'Launch' }],
            ['- [x] Tag v1.0'],
            'done',
        );
        const twice = insertUnderPath(
            once,
            [{ kind: 'heading', level: 1, text: 'Launch' }],
            ['- [x] Write the docs'],
            'done',
        );

        expect(twice.split('\n').slice(4)).toEqual([
            '# Done …',
            '## Launch',
            '- [x] Tag v1.0',
            '- [x] Write the docs',
            '',
        ]);
    });

    it('nests a deeper path under the group it belongs to', () => {
        const once = insertUnderPath(
            BASE,
            [{ kind: 'heading', level: 1, text: 'Launch' }],
            ['- [x] Tag v1.0'],
            'done',
        );
        const twice = insertUnderPath(
            once,
            [
                { kind: 'heading', level: 1, text: 'Launch' },
                { kind: 'heading', level: 3, text: 'Copy' },
            ],
            ['- [x] Write the announcement'],
            'done',
        );

        expect(twice.split('\n').slice(4)).toEqual([
            '# Done …',
            '## Launch',
            '- [x] Tag v1.0',
            '#### Copy',
            '- [x] Write the announcement',
            '',
        ]);
    });

    it('reproduces a bullet ancestor and indents the block under it', () => {
        const next = insertUnderPath(
            BASE,
            [
                { kind: 'heading', level: 1, text: 'Launch' },
                {
                    kind: 'bullet',
                    raw: '- Meeting notes',
                    text: 'Meeting notes',
                },
            ],
            ['    - [x] Write the announcement'],
            'done',
        );

        expect(next.split('\n').slice(4)).toEqual([
            '# Done …',
            '## Launch',
            '- Meeting notes',
            '    - [x] Write the announcement',
            '',
        ]);
    });

    it('puts a path-less block directly under the heading', () => {
        const next = insertUnderPath(BASE, [], ['- [x] Loose task'], 'done');

        expect(next.split('\n').slice(4)).toEqual([
            '# Done …',
            '- [x] Loose task',
            '',
        ]);
    });

    it('inserts into the body above the Done section when lifting out', () => {
        const next = insertUnderPath(
            BASE,
            [{ kind: 'heading', level: 1, text: 'Launch' }],
            ['- [ ] Write changelog'],
            'body',
        );

        expect(next.split('\n')).toEqual([
            '# Launch',
            '- [ ] Ship it',
            '- [ ] Write changelog',
            '',
            '---',
            '# Done …',
            '',
        ]);
    });

    it('recreates a heading the body no longer has', () => {
        const next = insertUnderPath(
            BASE,
            [{ kind: 'heading', level: 2, text: 'Research' }],
            ['- [ ] Read the teardown'],
            'body',
        );

        expect(next.split('\n')).toEqual([
            '# Launch',
            '- [ ] Ship it',
            '## Research',
            '- [ ] Read the teardown',
            '',
            '---',
            '# Done …',
            '',
        ]);
    });
});

describe('refileCompleted', () => {
    it('files closed work under a rebuilt, demoted path', () => {
        const note = [
            '# Launch',
            '- [ ] Ship the thing',
            '- [x] Tag v1.0',
            '',
            '### Copy',
            '- [x] Write the announcement',
        ].join('\n');

        expect(refileCompleted(note).split('\n')).toEqual([
            '# Launch',
            '- [ ] Ship the thing',
            '',
            '### Copy',
            '',
            '---',
            '# Done …',
            '## Launch',
            '- [x] Tag v1.0',
            '#### Copy',
            '- [x] Write the announcement',
            '',
        ]);
    });

    it('leaves a note with nothing to file byte for byte alone', () => {
        const note = [
            '---',
            'type: project',
            '---',
            '# Launch',
            '- [ ] Ship it',
            '    - [x] Sub-step under an open parent',
            '',
            '```js',
            'const done = true;',
            '```',
            '| a | b |',
            '| - | - |',
        ].join('\n');

        expect(refileCompleted(note)).toBe(note);
        expect(hasFileableWork(note)).toBe(false);
    });

    it('merges a second run into the groups the first one made', () => {
        const once = refileCompleted(
            ['# Launch', '- [x] Tag v1.0', '- [ ] Ship it'].join('\n'),
        );
        const twice = refileCompleted(
            once.replace('- [ ] Ship it', '- [x] Ship it'),
        );

        expect(twice.split('\n').slice(-4)).toEqual([
            '## Launch',
            '- [x] Tag v1.0',
            '- [x] Ship it',
            '',
        ]);
    });

    it('lifts a re-opened item back out and clears the group it left', () => {
        const note = [
            '# Launch',
            '- [ ] Ship it',
            '',
            '---',
            '# Done …',
            '## Launch',
            '- [ ] Write changelog',
        ].join('\n');

        expect(refileCompleted(note).split('\n')).toEqual([
            '# Launch',
            '- [ ] Ship it',
            '- [ ] Write changelog',
        ]);
    });

    it('keeps sync ids and fold markers on the lines it moves', () => {
        const note = [
            '# Launch',
            '- [x] Tag v1.0 ^abc123',
            '- [x] Prepare release …',
            '    - [x] Update the docs',
        ].join('\n');
        const filed = refileCompleted(note);

        expect(filed).toContain('- [x] Tag v1.0 ^abc123');
        expect(filed).toContain('- [x] Prepare release …');
        expect(filed).toContain('    - [x] Update the docs');
    });

    it('reports whether there is anything to do', () => {
        expect(hasFileableWork('- [x] Tag v1.0')).toBe(true);
        expect(hasFileableWork('- [ ] Ship it')).toBe(false);
        expect(
            hasFileableWork(['---', '# Done', '- [ ] Reopened'].join('\n')),
        ).toBe(true);
    });
});
