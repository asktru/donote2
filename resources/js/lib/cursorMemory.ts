/**
 * Session-scoped memory of the last cursor position per note, so reopening
 * a note puts you back where you were. Falls back to the end of the note
 * for first-time opens (better than the start, which visually reveals the
 * first heading's raw markdown).
 */
const positions = new Map<string, number>();

export function rememberCursor(key: string, position: number): void {
    positions.set(key, position);
}

export function recallCursor(key: string): number | undefined {
    return positions.get(key);
}
