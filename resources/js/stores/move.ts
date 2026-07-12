import type { EditorView } from '@codemirror/view';
import { ref } from 'vue';

import { selectionBlock } from '@/components/editor/markdownExtensions';
import { activeEditor, activeEditorNoteId } from '@/stores/editorRegistry';
import { searchOpen } from '@/stores/ui';
import { getNote, updateNoteContent } from '@/stores/workspace';

interface PendingMove {
    view: EditorView;
    sourceId: string;
    from: number;
    to: number;
    text: string;
    lineCount: number;
}

/**
 * A move-to-note gesture in flight: content has been captured from the
 * source editor and we're waiting for the search dialog (in picker mode)
 * to name a destination. Null when no move is pending.
 */
export const pendingMove = ref<PendingMove | null>(null);

/**
 * Capture the block to move (the selection's lines, or the current line and
 * its nested children) and open the search dialog to pick a destination.
 * Returns false when there's no focused editor or nothing to move.
 */
export function startMoveToNote(): boolean {
    const view = activeEditor.value;
    const sourceId = activeEditorNoteId.value;

    if (!view || sourceId === null) {
        return false;
    }

    const block = selectionBlock(view.state);

    if (block.text.trim() === '') {
        return false;
    }

    pendingMove.value = {
        view,
        sourceId,
        from: block.from,
        to: block.to,
        text: block.text,
        lineCount: block.text.split('\n').length,
    };
    searchOpen.value = true;

    return true;
}

/**
 * Finish the pending move: append the captured block to the destination
 * note and cut it from the source. No-op when moving into the same note.
 */
export async function completeMoveToNote(destId: string): Promise<void> {
    const move = pendingMove.value;
    pendingMove.value = null;
    searchOpen.value = false;

    if (!move || destId === move.sourceId) {
        return;
    }

    const dest = getNote(destId);

    if (dest !== undefined) {
        const base = dest.content.replace(/\s+$/, '');
        const block = move.text.replace(/\s+$/, '');
        await updateNoteContent(
            destId,
            `${base === '' ? '' : `${base}\n\n`}${block}\n`,
        );
    }

    // Cut from the source through the live editor (source of truth), taking
    // the block's trailing newline so no blank line is left behind.
    const doc = move.view.state.doc;
    const end = move.to < doc.length && doc.sliceString(move.to, move.to + 1) === '\n'
        ? move.to + 1
        : move.to;
    move.view.dispatch({ changes: { from: move.from, to: end, insert: '' } });
}

export function cancelMove(): void {
    pendingMove.value = null;
}
