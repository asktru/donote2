/**
 * A viewer's access to a note, as sent by the server. The client never holds
 * a note it can't read, so 'none' never reaches it.
 */
export type NoteAccess = 'owner' | 'write' | 'read';

/**
 * Whether the current user may edit a note right now. Owners always can;
 * write-collaborators only while online (shared notes have no offline edit
 * queue — offline is read-only); read recipients never can.
 */
export function canEditNote(access: NoteAccess, online: boolean): boolean {
    return access === 'owner' || (access === 'write' && online);
}

/** Ids in `localIds` that are no longer visible and safe to drop locally. */
export function notesToPrune(
    localIds: string[],
    visibleIds: Set<string>,
    dirtyIds: Set<string>,
): string[] {
    return localIds.filter(
        (id) => !visibleIds.has(id) && !dirtyIds.has(id),
    );
}
