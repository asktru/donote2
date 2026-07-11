import type { EditorView } from '@codemirror/view';
import { shallowRef } from 'vue';

/**
 * The most recently focused CodeMirror view — lets app-level features
 * (AI prompts) read the selection and apply replacements without
 * threading refs through the component tree.
 */
export const activeEditor = shallowRef<EditorView | null>(null);

export function registerEditor(view: EditorView): void {
    activeEditor.value = view;
}

export function unregisterEditor(view: EditorView): void {
    if (activeEditor.value === view) {
        activeEditor.value = null;
    }
}
