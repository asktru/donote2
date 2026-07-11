import { SYNC_ID_RE } from './parser';

/**
 * A synced line's body: the full line minus its leading indentation. The
 * indentation stays per-location so the same task can live at different
 * nesting depths in different notes.
 */
function bodyOf(rawLine: string): string {
    return rawLine.replace(/^\s+/, '');
}

/** Every synced-line body in a note, grouped by sync id (in order). */
export function collectSyncedLines(content: string): Map<string, string[]> {
    const byId = new Map<string, string[]>();

    for (const raw of content.split('\n')) {
        const id = raw.match(SYNC_ID_RE)?.[1];

        if (id === undefined) {
            continue;
        }

        const list = byId.get(id) ?? [];
        list.push(bodyOf(raw));
        byId.set(id, list);
    }

    return byId;
}

/**
 * Diff two versions of a note and return the sync ids whose body changed,
 * mapped to the new authoritative body. When a note holds several copies of
 * one id and only one was edited, the edited copy wins.
 */
export function changedSyncedLines(
    oldContent: string,
    newContent: string,
): Map<string, string> {
    const before = collectSyncedLines(oldContent);
    const after = collectSyncedLines(newContent);
    const changed = new Map<string, string>();

    for (const [id, bodies] of after) {
        const oldBodies = new Set(before.get(id) ?? []);
        const fresh = bodies.find((body) => !oldBodies.has(body));

        if (fresh !== undefined) {
            changed.set(id, fresh);
        }
    }

    return changed;
}

/**
 * Replace every line carrying the given sync id with the new body,
 * preserving each occurrence's own indentation. Returns null when nothing
 * changed.
 */
export function applySyncedLine(
    content: string,
    id: string,
    body: string,
): string | null {
    const lines = content.split('\n');
    let changed = false;

    for (let index = 0; index < lines.length; index++) {
        if (lines[index].match(SYNC_ID_RE)?.[1] !== id) {
            continue;
        }

        const indent = lines[index].match(/^\s*/)?.[0] ?? '';
        const next = `${indent}${body}`;

        if (lines[index] !== next) {
            lines[index] = next;
            changed = true;
        }
    }

    return changed ? lines.join('\n') : null;
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Generate a short random sync id (6 chars, base36). */
export function generateSyncId(): string {
    let id = '';

    for (let i = 0; i < 6; i++) {
        id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
    }

    return id;
}
