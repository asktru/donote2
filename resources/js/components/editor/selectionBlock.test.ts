import { indentUnit } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { selectionBlock } from './markdownExtensions';

function stateOf(doc: string, anchor: number, head = anchor): EditorState {
    return EditorState.create({
        doc,
        selection: { anchor, head },
        extensions: [indentUnit.of('    ')],
    });
}

describe('selectionBlock', () => {
    it('captures the current line and its nested children when nothing is selected', () => {
        const doc = ['- Parent', '    - Child', '        - Grandchild', '- Sibling'].join(
            '\n',
        );
        // Cursor somewhere inside the "Parent" line.
        const block = selectionBlock(stateOf(doc, 3));

        expect(block.text).toBe(
            ['- Parent', '    - Child', '        - Grandchild'].join('\n'),
        );
        expect(block.from).toBe(0);
    });

    it('captures just the current line when it has no children', () => {
        const doc = ['- Parent', '    - Child', '- Sibling'].join('\n');
        // Cursor on the last line, which has no nested content.
        const block = selectionBlock(stateOf(doc, doc.length));

        expect(block.text).toBe('- Sibling');
    });

    it('captures the full lines a selection spans, even partial ones', () => {
        const doc = ['First line', 'Second line', 'Third line'].join('\n');
        // Select from mid-"First" to mid-"Second".
        const from = doc.indexOf('line'); // inside first line
        const to = doc.indexOf('Second') + 3; // inside second line
        const block = selectionBlock(stateOf(doc, from, to));

        expect(block.text).toBe(['First line', 'Second line'].join('\n'));
    });
});
