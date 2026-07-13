import { indentUnit } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { editorLineActions } from './markdownExtensions';

/**
 * A minimal stand-in for EditorView: enough for the line actions, which
 * only read `state` and `dispatch` transactions/specs. Avoids needing a
 * DOM (tests run in the node environment).
 */
function makeView(doc: string, anchor = 0, head = anchor) {
    let state = EditorState.create({
        doc,
        selection: { anchor, head },
        extensions: [indentUnit.of('    ')],
    });

    return {
        get state() {
            return state;
        },
        dispatch(input: unknown) {
            const maybeTransaction = input as { state?: EditorState };
            state =
                maybeTransaction.state ??
                state.update(input as Parameters<EditorState['update']>[0]).state;
        },
        focus() {},
        get doc() {
            return state.doc.toString();
        },
    };
}

function run(view: ReturnType<typeof makeView>, action: keyof typeof editorLineActions) {
    editorLineActions[action](view as unknown as EditorView);
}

describe('editorLineActions', () => {
    it('toggles a line to a task and back', () => {
        const view = makeView('Buy milk', 3);
        run(view, 'task');
        expect(view.doc).toBe('- [ ] Buy milk');
        run(view, 'task');
        expect(view.doc).toBe('Buy milk');
    });

    it('toggles checklist and bullet', () => {
        const cl = makeView('Buy milk');
        run(cl, 'checklist');
        expect(cl.doc).toBe('+ [ ] Buy milk');

        const bl = makeView('Buy milk');
        run(bl, 'bullet');
        expect(bl.doc).toBe('- Buy milk');
        run(bl, 'bullet');
        expect(bl.doc).toBe('Buy milk');
    });

    it('cycles heading level none → # → ## → ### → none', () => {
        const view = makeView('Title');
        run(view, 'heading');
        expect(view.doc).toBe('# Title');
        run(view, 'heading');
        expect(view.doc).toBe('## Title');
        run(view, 'heading');
        expect(view.doc).toBe('### Title');
        run(view, 'heading');
        expect(view.doc).toBe('Title');
    });

    it('turns a task into a heading, dropping the marker', () => {
        const view = makeView('- [ ] Do it');
        run(view, 'heading');
        expect(view.doc).toBe('# Do it');
    });

    it('indents and outdents by the configured unit', () => {
        const view = makeView('note', 2);
        run(view, 'indent');
        expect(view.doc).toBe('    note');
        run(view, 'outdent');
        expect(view.doc).toBe('note');
    });

    it('moves the current line up and down', () => {
        const down = makeView('Alpha\nBravo', 0); // cursor on "Alpha"
        run(down, 'moveDown');
        expect(down.doc).toBe('Bravo\nAlpha');

        const up = makeView('Alpha\nBravo', 6); // cursor on "Bravo"
        run(up, 'moveUp');
        expect(up.doc).toBe('Bravo\nAlpha');
    });

    it('cycles a task priority none → ! → !! → !!! → none', () => {
        const view = makeView('- [ ] Pay invoices', 8);
        run(view, 'priority');
        expect(view.doc).toBe('- [ ] ! Pay invoices');
        run(view, 'priority');
        expect(view.doc).toBe('- [ ] !! Pay invoices');
        run(view, 'priority');
        expect(view.doc).toBe('- [ ] !!! Pay invoices');
        run(view, 'priority');
        expect(view.doc).toBe('- [ ] Pay invoices');
    });

    it('cancels and restores a task', () => {
        const view = makeView('- [ ] Do it', 8);
        run(view, 'cancel');
        expect(view.doc).toBe('- [-] Do it');
        run(view, 'cancel');
        expect(view.doc).toBe('- [ ] Do it');
    });

    it('wraps a selection in bold and highlight, and unwraps bold', () => {
        const bold = makeView('make me bold', 8, 12); // select "bold"
        run(bold, 'bold');
        expect(bold.doc).toBe('make me **bold**');
        run(bold, 'bold');
        expect(bold.doc).toBe('make me bold');

        const hi = makeView('note', 0, 4); // select "note"
        run(hi, 'highlight');
        expect(hi.doc).toBe('==note==');
    });
});
