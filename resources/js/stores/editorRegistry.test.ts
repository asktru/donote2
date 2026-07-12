import type { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it } from 'vitest';

import {
    activeEditor,
    activeEditorNoteId,
    blurEditor,
    editorFocused,
    focusEditor,
    registerEditor,
    unregisterEditor,
} from './editorRegistry';

// The registry only ever compares views by identity, so a bare object cast
// to EditorView is enough for these tests.
const viewA = {} as EditorView;
const viewB = {} as EditorView;

beforeEach(() => {
    activeEditor.value = null;
    activeEditorNoteId.value = null;
    editorFocused.value = false;
});

describe('editorRegistry', () => {
    it('registering an editor makes it active but NOT focused', () => {
        registerEditor(viewA, 'note-1');

        expect(activeEditor.value).toBe(viewA);
        expect(activeEditorNoteId.value).toBe('note-1');
        expect(editorFocused.value).toBe(false);
    });

    it('focusEditor marks it focused', () => {
        focusEditor(viewA, 'note-1');

        expect(activeEditor.value).toBe(viewA);
        expect(editorFocused.value).toBe(true);
    });

    it('blur clears focus but keeps the editor active', () => {
        focusEditor(viewA);
        blurEditor(viewA);

        expect(editorFocused.value).toBe(false);
        expect(activeEditor.value).toBe(viewA);
    });

    it('a blur from a different (stale) view does not clear focus', () => {
        focusEditor(viewA);
        blurEditor(viewB);

        expect(editorFocused.value).toBe(true);
    });

    it('unregistering the active editor clears it and its focus', () => {
        focusEditor(viewA);
        unregisterEditor(viewA);

        expect(activeEditor.value).toBeNull();
        expect(editorFocused.value).toBe(false);
    });
});
