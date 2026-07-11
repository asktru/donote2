import { describe, expect, it } from 'vitest';

import {
    daysUntil,
    dueLabel,
    frontMatterBounds,
    isReviewDue,
    nextReviewDate,
    noteProgress,
    parseNoteMeta,
    startsInFuture,
    upsertFrontMatterKey,
} from './frontmatter';
import { parseNote } from './parser';

const PROJECT = [
    '---',
    'type: project',
    'start: 2026-07-01',
    'due: 2026-08-15',
    'review: 1w',
    'reviewed: 2026-07-05',
    '---',
    '# AIR Platform',
    '- [ ] Ship it',
].join('\n');

describe('parseNoteMeta', () => {
    it('parses a full project front matter', () => {
        const meta = parseNoteMeta(PROJECT);

        expect(meta.type).toBe('project');
        expect(meta.start).toBe('2026-07-01');
        expect(meta.due).toBe('2026-08-15');
        expect(meta.review).toMatchObject({
            kind: 'interval',
            amount: 1,
            unit: 'w',
        });
        expect(meta.reviewed).toBe('2026-07-05');
        expect(meta.endLine).toBe(6);
    });

    it('parses weekday review rules', () => {
        const meta = parseNoteMeta('---\ntype: area\nreview: Sat\n---\nBody');

        expect(meta.type).toBe('area');
        expect(meta.review).toMatchObject({ kind: 'weekdays', weekdays: [6] });
    });

    it('returns empty meta without front matter', () => {
        const meta = parseNoteMeta('# Just a note\n- [ ] Task');

        expect(meta.type).toBeNull();
        expect(meta.endLine).toBe(-1);
    });

    it('ignores unknown types and malformed dates', () => {
        const meta = parseNoteMeta('---\ntype: banana\ndue: soon\n---\n');

        expect(meta.type).toBeNull();
        expect(meta.due).toBeNull();
    });

    it('requires the block to start on the first line', () => {
        expect(
            frontMatterBounds(['# Title', '---', 'type: list', '---']),
        ).toBeNull();
    });
});

describe('upsertFrontMatterKey', () => {
    it('updates an existing key', () => {
        const next = upsertFrontMatterKey(PROJECT, 'reviewed', '2026-07-11');

        expect(next).toContain('reviewed: 2026-07-11');
        expect(next).not.toContain('reviewed: 2026-07-05');
    });

    it('inserts a new key before the closing delimiter', () => {
        const next = upsertFrontMatterKey(
            '---\ntype: list\n---\nBody',
            'reviewed',
            '2026-07-11',
        );

        expect(next.split('\n')).toEqual([
            '---',
            'type: list',
            'reviewed: 2026-07-11',
            '---',
            'Body',
        ]);
    });

    it('creates a front matter block when missing', () => {
        const next = upsertFrontMatterKey('# Note', 'type', 'project');

        expect(next.split('\n')).toEqual([
            '---',
            'type: project',
            '---',
            '# Note',
        ]);
    });

    it('removes a key when the value is empty', () => {
        const next = upsertFrontMatterKey(
            '---\ntype: list\n---\nBody',
            'type',
            '',
        );

        expect(next.split('\n')).toEqual(['---', '---', 'Body']);
    });
});

describe('review scheduling', () => {
    it('is due immediately when never reviewed', () => {
        const meta = parseNoteMeta('---\nreview: 2w\n---\n');

        expect(nextReviewDate(meta, '2026-07-11')).toBe('2026-07-11');
        expect(isReviewDue(meta, '2026-07-11')).toBe(true);
    });

    it('applies interval cadences from the reviewed date', () => {
        const meta = parseNoteMeta(
            '---\nreview: 2w\nreviewed: 2026-07-01\n---\n',
        );

        expect(nextReviewDate(meta, '2026-07-11')).toBe('2026-07-15');
        expect(isReviewDue(meta, '2026-07-11')).toBe(false);
        expect(isReviewDue(meta, '2026-07-15')).toBe(true);
    });

    it('applies weekday cadences (review every Saturday)', () => {
        // Reviewed on Saturday July 4th -> next review Saturday July 11th.
        const meta = parseNoteMeta(
            '---\nreview: Sat\nreviewed: 2026-07-04\n---\n',
        );

        expect(nextReviewDate(meta, '2026-07-10')).toBe('2026-07-11');
        expect(isReviewDue(meta, '2026-07-10')).toBe(false);
        expect(isReviewDue(meta, '2026-07-11')).toBe(true);
    });

    it('has no review date without a review property', () => {
        expect(nextReviewDate(parseNoteMeta('body'), '2026-07-11')).toBeNull();
    });
});

describe('noteProgress', () => {
    it('counts tasks only, excluding cancelled and checklists', () => {
        const lines = parseNote(
            [
                '- [x] done task',
                '- [ ] open task',
                '- [>] forwarded task',
                '- [-] cancelled task',
                '+ [x] done checklist item',
                '+ [ ] open checklist item',
                '- plain bullet',
            ].join('\n'),
        );

        const progress = noteProgress(lines);

        expect(progress.total).toBe(3);
        expect(progress.done).toBe(1);
        expect(progress.fraction).toBeCloseTo(1 / 3);
    });

    it('reports null fraction with no tasks', () => {
        expect(noteProgress(parseNote('just text')).fraction).toBeNull();
    });
});

describe('due date math', () => {
    it('computes signed day distances', () => {
        expect(daysUntil('2026-07-25', '2026-07-11')).toBe(14);
        expect(daysUntil('2026-07-11', '2026-07-11')).toBe(0);
        expect(daysUntil('2026-07-08', '2026-07-11')).toBe(-3);
    });

    it('renders Things-style labels', () => {
        expect(dueLabel('2026-07-25', '2026-07-11')).toBe('14d left');
        expect(dueLabel('2026-07-11', '2026-07-11')).toBe('due today');
        expect(dueLabel('2026-07-12', '2026-07-11')).toBe('due tomorrow');
        expect(dueLabel('2026-07-08', '2026-07-11')).toBe('3d overdue');
        expect(dueLabel('2026-07-10', '2026-07-11')).toBe('1d overdue');
    });

    it('detects future starts', () => {
        expect(
            startsInFuture(
                parseNoteMeta('---\nstart: 2026-08-01\n---\n'),
                '2026-07-11',
            ),
        ).toBe(true);
        expect(
            startsInFuture(
                parseNoteMeta('---\nstart: 2026-07-11\n---\n'),
                '2026-07-11',
            ),
        ).toBe(false);
    });
});
