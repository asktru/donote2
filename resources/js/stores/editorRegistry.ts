import type { EditorView } from '@codemirror/view';
import { ref, shallowRef } from 'vue';

/**
 * The most recently focused CodeMirror view — lets app-level features
 * (AI prompts) read the selection and apply replacements without
 * threading refs through the component tree.
 */
export const activeEditor = shallowRef<EditorView | null>(null);

/** The note id backing the active editor (its state key), for move/etc. */
export const activeEditorNoteId = shallowRef<string | null>(null);

/** Whether an editor currently holds focus (drives the mobile toolbar). */
export const editorFocused = ref(false);

/**
 * Mark an editor as the active one (for selection-reading features) without
 * implying it holds focus. Called when an editor mounts.
 */
export function registerEditor(view: EditorView, noteId?: string): void {
    activeEditor.value = view;

    if (noteId !== undefined) {
        activeEditorNoteId.value = noteId;
    }
}

/** An editor actually gained focus (drives the mobile toolbar's visibility). */
export function focusEditor(view: EditorView, noteId?: string): void {
    registerEditor(view, noteId);
    editorFocused.value = true;
}

/** An editor lost focus (blur) — but keep it as the active one. */
export function blurEditor(view: EditorView): void {
    if (activeEditor.value === view) {
        editorFocused.value = false;
    }
}

export function unregisterEditor(view: EditorView): void {
    if (activeEditor.value === view) {
        activeEditor.value = null;
        editorFocused.value = false;
    }
}
