import { describe, expect, it } from 'vitest';

import { parseNote } from './parser';
import {
    closedAncestors,
    isClosed,
    isOpen,
    openDescendants,
    withTaskState,
} from './subtreeState';

const NOTE = [
    '- [x] Prepare release',
    '    - [ ] Write changelog',
    '    - [x] Update the docs',
    '        + [ ] Proofread',
    '    context line',
    '- [ ] Ship it',
].join('\n');

describe('isClosed / isOpen', () => {
    it('classifies task states', () => {
        const lines = parseNote(
            ['- [x] a', '- [-] b', '- [ ] c', '- [>] d', '- bullet'].join('\n'),
        );

        expect(lines.map(isClosed)).toEqual([true, true, false, false, false]);
        expect(lines.map(isOpen)).toEqual([false, false, true, true, false]);
    });

    it('counts checklist items as tasks for both', () => {
        const lines = parseNote(['+ [x] a', '+ [ ] b'].join('\n'));

        expect(lines.map(isClosed)).toEqual([true, false]);
        expect(lines.map(isOpen)).toEqual([false, true]);
    });
});

describe('openDescendants', () => {
    it('finds open items at any depth, skipping closed and neutral lines', () => {
        const lines = parseNote(NOTE);

        expect(openDescendants(lines, 0).map((line) => line.title)).toEqual([
            'Write changelog',
            'Proofread',
        ]);
    });

    it('is empty for a leaf', () => {
        expect(openDescendants(parseNote(NOTE), 5)).toEqual([]);
    });
});

describe('closedAncestors', () => {
    it('walks up through every closed ancestor, innermost first', () => {
        const lines = parseNote(NOTE);

        expect(closedAncestors(lines, 3).map((line) => line.title)).toEqual([
            'Update the docs',
            'Prepare release',
        ]);
    });

    it('skips ancestors that are already open or neutral', () => {
        const lines = parseNote(
            ['- bullet', '    - [ ] open', '        - [x] done'].join('\n'),
        );

        expect(closedAncestors(lines, 2)).toEqual([]);
    });
});

describe('withTaskState', () => {
    it('rewrites the checkbox, keeping indentation and the rest of the line', () => {
        expect(withTaskState('    - [ ] Ship it >2026-07-26', 'done')).toBe(
            '    - [x] Ship it >2026-07-26',
        );
        expect(withTaskState('+ [x] Proofread', 'open')).toBe(
            '+ [ ] Proofread',
        );
        expect(withTaskState('- [ ] Drop it', 'cancelled')).toBe(
            '- [-] Drop it',
        );
        expect(withTaskState('- [ ] Later', 'scheduled')).toBe('- [>] Later');
    });

    it('strips priority when closing, since it is meaningless once finished', () => {
        expect(withTaskState('- [ ] !! Pay invoices', 'done')).toBe(
            '- [x] Pay invoices',
        );
        expect(withTaskState('- [ ] !!! Urgent', 'cancelled')).toBe(
            '- [-] Urgent',
        );
    });

    it('leaves a line that is not a task alone', () => {
        expect(withTaskState('- bullet', 'done')).toBe('- bullet');
        expect(withTaskState('# Heading', 'done')).toBe('# Heading');
    });
});
