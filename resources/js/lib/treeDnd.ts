import { moveNoteToFolder, renameFolder } from '@/stores/workspace';

export const TREE_DND_MIME = 'text/x-donote';

/**
 * Move a dragged sidebar item (note or folder) into a destination folder.
 * Payload format: `note:<id>` or `folder:<path>`; destination '' is the root.
 */
export async function acceptTreeDrop(
    payload: string,
    destination: string,
): Promise<void> {
    if (payload.startsWith('note:')) {
        await moveNoteToFolder(payload.slice(5), destination);

        return;
    }

    if (payload.startsWith('folder:')) {
        const source = payload.slice(7);
        const name = source.split('/').pop() ?? source;
        const target = destination === '' ? name : `${destination}/${name}`;

        if (
            source === destination ||
            target === source ||
            destination.startsWith(`${source}/`)
        ) {
            return;
        }

        await renameFolder(source, target);
    }
}
