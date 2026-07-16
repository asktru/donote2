/**
 * A viewer's access to a note, as sent by the server. The client never holds
 * a note it can't read, so 'none' never reaches it.
 */
export type NoteAccess = 'owner' | 'write' | 'read';

/** One recipient of an explicit share. */
export interface NoteShareEntry {
    user_id: number;
    access: 'read' | 'write';
}

/** A note's sharing state, as managed by its author. */
export interface NoteSharing {
    team_readable: boolean;
    shares: NoteShareEntry[];
}

/**
 * Whether the current user may edit a note right now. Owners always can;
 * write-collaborators only while online (shared notes have no offline edit
 * queue — offline is read-only); read recipients never can.
 */
export function canEditNote(access: NoteAccess, online: boolean): boolean {
    return access === 'owner' || (access === 'write' && online);
}

/**
 * Ids of local notes that are no longer visible and safe to drop locally.
 *
 * Only notes the server has seen (version > 0) qualify: for those, absence
 * from the visible set means remote deletion or an unshare. A version-0 note
 * only exists locally — a not-yet-pushed draft (dirty) or a lazily created
 * calendar placeholder (clean) — so the server not listing it proves nothing,
 * and pruning it would yank the note out from under an open editor.
 */
export function notesToPrune(
    localNotes: { id: string; version: number; dirty: number }[],
    visibleIds: Set<string>,
): string[] {
    return localNotes
        .filter(
            (note) =>
                !visibleIds.has(note.id) &&
                note.dirty === 0 &&
                note.version > 0,
        )
        .map((note) => note.id);
}
