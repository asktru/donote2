import { apiFetch } from '@/lib/api';
import type { NoteSharing } from '@/lib/noteAccess';
import { workspaceConfig } from '@/stores/workspace';

function shareUrl(noteId: string): string {
    const cfg = workspaceConfig();

    if (!cfg) {
        throw new Error('Workspace is not initialized.');
    }

    return `/api/${cfg.teamSlug}/notes/${noteId}/share`;
}

/** Fetch a note's current sharing (author only). */
export function getNoteSharing(noteId: string): Promise<NoteSharing> {
    return apiFetch<NoteSharing>(shareUrl(noteId));
}

/** Replace a note's sharing (author only); returns the saved state. */
export function updateNoteSharing(
    noteId: string,
    sharing: NoteSharing,
): Promise<NoteSharing> {
    return apiFetch<NoteSharing>(shareUrl(noteId), {
        method: 'PUT',
        body: JSON.stringify(sharing),
    });
}
