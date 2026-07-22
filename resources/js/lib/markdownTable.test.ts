import { describe, expect, it } from 'vitest';

import { isTableRow, splitTableRow, tableAligns } from './markdownTable';

describe('splitTableRow', () => {
    it('splits cells and strips optional edge pipes', () => {
        expect(splitTableRow('| a | b | c |')).toEqual(['a', 'b', 'c']);
        expect(splitTableRow('a | b')).toEqual(['a', 'b']);
    });

    it('keeps escaped pipes inside a cell', () => {
        expect(splitTableRow('| a \\| b | c |')).toEqual(['a | b', 'c']);
    });
});

describe('tableAligns', () => {
    it('reads per-column alignment from the delimiter row', () => {
        expect(tableAligns('|:---|:---:|---:|---|')).toEqual([
            'left',
            'center',
            'right',
            null,
        ]);
    });

    it('accepts a bare delimiter row without edge pipes', () => {
        expect(tableAligns('--- | ---')).toEqual([null, null]);
    });

    it('rejects rows that are not delimiter rows', () => {
        expect(tableAligns('| Word | Meaning |')).toBeNull();
        expect(tableAligns('just text')).toBeNull();
        expect(tableAligns('| a | --- |')).toBeNull();
    });
});

describe('isTableRow', () => {
    it('is true only for non-blank pipe lines', () => {
        expect(isTableRow('| a | b |')).toBe(true);
        expect(isTableRow('no pipes here')).toBe(false);
        expect(isTableRow('   ')).toBe(false);
    });
});
