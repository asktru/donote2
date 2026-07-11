import { computed, reactive, ref } from 'vue';
import type { ComputedRef } from 'vue';

import { kindOfKey, todayDailyKey, todayKey } from '@/core/dates';
import type { CalendarKind, NoteType } from '@/core/dates';
import {
    EMPTY_META,
    isReviewDue,
    nextReviewDate,
    noteProgress,
    parseNoteMeta,
    upsertFrontMatterKey,
} from '@/core/frontmatter';
import type { NoteKind, NoteMeta, NoteProgress } from '@/core/frontmatter';
import { parseNote } from '@/core/parser';
import type { ParsedLine } from '@/core/parser';
import { applySyncedLine, changedSyncedLines } from '@/core/syncedLines';
import { openWorkspaceDb } from '@/stores/db';
import type { LocalNote, WorkspaceDb } from '@/stores/db';

export interface WorkspaceConfig {
    teamSlug: string;
    userId: number;
}

interface ParseCacheEntry {
    content: string;
    lines: ParsedLine[];
}

const notes = reactive(new Map<string, LocalNote>());
const extraFolders = ref<string[]>([]);
const ready = ref(false);
const config = ref<WorkspaceConfig | null>(null);

let db: WorkspaceDb | null = null;
const parseCache = new Map<string, ParseCacheEntry>();
const mutationListeners = new Set<() => void>();

function requireDb(): WorkspaceDb {
    if (db === null) {
        throw new Error('Workspace has not been initialized.');
    }

    return db;
}

/** Notify the sync engine (and anyone else) that local data changed. */
export function onWorkspaceMutation(listener: () => void): void {
    mutationListeners.add(listener);
}

function emitMutation(): void {
    for (const listener of mutationListeners) {
        listener();
    }
}

/** Open the workspace database and hydrate the in-memory cache. */
export async function initWorkspace(cfg: WorkspaceConfig): Promise<void> {
    if (
        config.value?.teamSlug === cfg.teamSlug &&
        config.value.userId === cfg.userId &&
        ready.value
    ) {
        return;
    }

    config.value = cfg;
    db = openWorkspaceDb(cfg.teamSlug, cfg.userId);

    const [storedNotes, folderMeta] = await Promise.all([
        db.notes.toArray(),
        db.meta.get('folders'),
    ]);

    notes.clear();

    for (const note of storedNotes) {
        notes.set(note.id, note);
    }

    extraFolders.value = Array.isArray(folderMeta?.value)
        ? (folderMeta.value as string[])
        : [];
    ready.value = true;
}

export function workspaceConfig(): WorkspaceConfig | null {
    return config.value;
}

export function workspaceReady(): ComputedRef<boolean> {
    return computed(() => ready.value);
}

/** Persist a note to IndexedDB and the reactive cache. */
async function persist(note: LocalNote): Promise<void> {
    notes.set(note.id, note);
    await requireDb().notes.put({ ...note });
}

/** Apply an authoritative server copy (does not mark dirty). */
export async function applyServerNote(server: {
    id: string;
    type: NoteType;
    date_key: string | null;
    title: string;
    content: string;
    folder: string;
    pinned: boolean;
    version: number;
    updated_at: string | null;
    deleted: boolean;
}): Promise<void> {
    await persist({
        id: server.id,
        type: server.type,
        dateKey: server.date_key,
        title: server.title,
        content: server.content,
        folder: server.folder,
        pinned: server.pinned ? 1 : 0,
        version: server.version,
        updatedAt: server.updated_at ?? new Date().toISOString(),
        deleted: server.deleted ? 1 : 0,
        dirty: 0,
    });
}

export async function removeLocalNote(id: string): Promise<void> {
    notes.delete(id);
    parseCache.delete(id);
    metaCache.delete(id);
    await requireDb().notes.delete(id);
}

async function mutate(
    id: string,
    changes: Partial<LocalNote>,
): Promise<LocalNote | null> {
    const existing = notes.get(id);

    if (!existing) {
        return null;
    }

    const next: LocalNote = {
        ...existing,
        ...changes,
        updatedAt: new Date().toISOString(),
        dirty: 1,
    };

    await persist(next);
    emitMutation();

    return next;
}

/** All live (non-deleted) notes. */
export const liveNotes = computed<LocalNote[]>(() =>
    [...notes.values()].filter((note) => note.deleted === 0),
);

export const regularNotes = computed<LocalNote[]>(() =>
    liveNotes.value.filter((note) => note.type === 'note'),
);

export const pinnedNotes = computed<LocalNote[]>(() =>
    regularNotes.value.filter((note) => note.pinned === 1),
);

/** Folder paths, derived from notes plus explicitly created (possibly empty) folders. */
export const folders = computed<string[]>(() => {
    const set = new Set<string>(extraFolders.value);

    for (const note of regularNotes.value) {
        if (note.folder !== '') {
            const parts = note.folder.split('/');

            for (let i = 1; i <= parts.length; i++) {
                set.add(parts.slice(0, i).join('/'));
            }
        }
    }

    return [...set].sort((a, b) => a.localeCompare(b));
});

export function getNote(id: string): LocalNote | undefined {
    return notes.get(id);
}

export function findCalendarNote(
    kind: CalendarKind,
    dateKey: string,
): LocalNote | undefined {
    for (const note of notes.values()) {
        if (
            note.type === kind &&
            note.dateKey === dateKey &&
            note.deleted === 0
        ) {
            return note;
        }
    }

    return undefined;
}

/**
 * Get or lazily create the calendar note for a period.
 *
 * A freshly created calendar note starts clean (dirty: 0) so that merely
 * viewing a day never pushes an empty note to the server — only a real edit
 * marks it dirty. This also lets a later pull replace it with the server's
 * copy of the same period without conflict.
 */
export async function openCalendarNote(
    kind: CalendarKind,
    dateKey: string,
): Promise<LocalNote> {
    const existing = findCalendarNote(kind, dateKey);

    if (existing) {
        return existing;
    }

    const note: LocalNote = {
        id: crypto.randomUUID(),
        type: kind,
        dateKey,
        title: '',
        content: '',
        folder: '',
        pinned: 0,
        version: 0,
        updatedAt: new Date().toISOString(),
        deleted: 0,
        dirty: 0,
    };

    await persist(note);

    return note;
}

export async function createNote(attrs: {
    title?: string;
    folder?: string;
    content?: string;
}): Promise<LocalNote> {
    const note: LocalNote = {
        id: crypto.randomUUID(),
        type: 'note',
        dateKey: null,
        title: attrs.title ?? 'Untitled',
        content: attrs.content ?? '',
        folder: attrs.folder ?? '',
        pinned: 0,
        version: 0,
        updatedAt: new Date().toISOString(),
        deleted: 0,
        dirty: 1,
    };

    await persist(note);
    emitMutation();

    return note;
}

export async function updateNoteContent(
    id: string,
    content: string,
): Promise<void> {
    const existing = notes.get(id);

    if (!existing) {
        return;
    }

    const changed = changedSyncedLines(existing.content, content);

    // Normalize duplicate copies of an edited synced line within this note.
    let next = content;

    for (const [syncId, body] of changed) {
        next = applySyncedLine(next, syncId, body) ?? next;
    }

    await mutate(id, { content: next });

    if (changed.size === 0) {
        return;
    }

    // Propagate the edited synced lines to every other note holding copies.
    for (const other of liveNotes.value) {
        if (other.id === id) {
            continue;
        }

        let updated: string | null = null;
        let current = other.content;

        for (const [syncId, body] of changed) {
            const applied = applySyncedLine(current, syncId, body);

            if (applied !== null) {
                current = applied;
                updated = current;
            }
        }

        if (updated !== null) {
            await mutate(other.id, { content: updated });
        }
    }
}

export async function renameNote(id: string, title: string): Promise<void> {
    await mutate(id, { title });
}

export async function moveNoteToFolder(
    id: string,
    folder: string,
): Promise<void> {
    await mutate(id, { folder });
}

export async function setNotePinned(
    id: string,
    pinned: boolean,
): Promise<void> {
    await mutate(id, { pinned: pinned ? 1 : 0 });
}

export async function deleteNote(id: string): Promise<void> {
    await mutate(id, { deleted: 1 });
}

export async function createFolder(path: string): Promise<void> {
    if (!extraFolders.value.includes(path)) {
        extraFolders.value = [...extraFolders.value, path];
        await requireDb().meta.put({
            key: 'folders',
            value: [...extraFolders.value],
        });
    }
}

/** Cached parse of one note's markdown. */
export function parsedNote(id: string): ParsedLine[] {
    const note = notes.get(id);

    if (!note) {
        return [];
    }

    const cached = parseCache.get(id);

    if (cached && cached.content === note.content) {
        return cached.lines;
    }

    const lines = parseNote(note.content);
    parseCache.set(id, { content: note.content, lines });

    return lines;
}

/** Map of lowercase note title -> note, for wiki link resolution. */
export const titleIndex = computed<Map<string, LocalNote>>(() => {
    const index = new Map<string, LocalNote>();

    for (const note of regularNotes.value) {
        if (note.title !== '') {
            index.set(note.title.toLowerCase(), note);
        }
    }

    return index;
});

/**
 * Resolve a wiki link target to a note. Date-key targets resolve to calendar
 * notes; anything else matches regular note titles case-insensitively.
 */
export function resolveWikiTarget(target: string): {
    note: LocalNote | undefined;
    calendarKey: string | null;
} {
    const kind = kindOfKey(target);

    if (kind !== null) {
        return { note: findCalendarNote(kind, target), calendarKey: target };
    }

    return {
        note: titleIndex.value.get(target.trim().toLowerCase()),
        calendarKey: null,
    };
}

/** Create the note a dangling wiki link points at. */
export async function materializeWikiTarget(
    target: string,
): Promise<LocalNote> {
    const kind = kindOfKey(target);

    if (kind !== null) {
        return openCalendarNote(kind, target);
    }

    return createNote({ title: target.trim() });
}

/** Notes whose content links to the given note. */
export function backlinksTo(
    id: string,
): { note: LocalNote; lines: ParsedLine[] }[] {
    const targetNote = notes.get(id);

    if (!targetNote) {
        return [];
    }

    const targets = new Set<string>();

    if (targetNote.type === 'note' && targetNote.title !== '') {
        targets.add(targetNote.title.toLowerCase());
    }

    if (targetNote.dateKey !== null) {
        targets.add(targetNote.dateKey.toLowerCase());
    }

    if (targets.size === 0) {
        return [];
    }

    const results: { note: LocalNote; lines: ParsedLine[] }[] = [];

    for (const note of liveNotes.value) {
        if (note.id === id) {
            continue;
        }

        const lines = parsedNote(note.id).filter((line) =>
            line.wikiLinks.some((link) =>
                targets.has(link.target.trim().toLowerCase()),
            ),
        );

        if (lines.length > 0) {
            results.push({ note, lines });
        }
    }

    return results;
}

export interface WorkspaceTask {
    noteId: string;
    note: LocalNote;
    line: ParsedLine;
}

/** Every task/checklist line across the workspace. */
export const workspaceTasks = computed<WorkspaceTask[]>(() => {
    const tasks: WorkspaceTask[] = [];

    for (const note of liveNotes.value) {
        for (const line of parsedNote(note.id)) {
            if (line.kind === 'task' || line.kind === 'checklist') {
                tasks.push({ noteId: note.id, note, line });
            }
        }
    }

    return tasks;
});

/** Tag -> occurrence count across live notes. */
export const tagCounts = computed<Map<string, number>>(() => {
    const counts = new Map<string, number>();

    for (const note of liveNotes.value) {
        for (const line of parsedNote(note.id)) {
            for (const tag of line.tags) {
                counts.set(tag, (counts.get(tag) ?? 0) + 1);
            }
        }
    }

    return new Map([...counts.entries()].sort((a, b) => b[1] - a[1]));
});

/** Mention -> occurrence count across live notes. */
export const mentionCounts = computed<Map<string, number>>(() => {
    const counts = new Map<string, number>();

    for (const note of liveNotes.value) {
        for (const line of parsedNote(note.id)) {
            for (const mention of line.mentions) {
                counts.set(mention, (counts.get(mention) ?? 0) + 1);
            }
        }
    }

    return new Map([...counts.entries()].sort((a, b) => b[1] - a[1]));
});

/** The effective daily key a task belongs to (schedule, else its daily note's day). */
export function taskDayKey(task: WorkspaceTask): string | null {
    if (task.line.schedule !== null) {
        return task.line.schedule;
    }

    if (task.note.type === 'daily') {
        return task.note.dateKey;
    }

    return null;
}

/** Search local notes by title and content substring (offline fallback). */
export function searchLocal(query: string, limit = 20): LocalNote[] {
    const needle = query.trim().toLowerCase();

    if (needle === '') {
        return [];
    }

    const scored: { note: LocalNote; score: number }[] = [];

    for (const note of liveNotes.value) {
        const title = note.title.toLowerCase();
        const content = note.content.toLowerCase();

        let score = 0;

        if (title === needle) {
            score = 100;
        } else if (title.startsWith(needle)) {
            score = 60;
        } else if (title.includes(needle)) {
            score = 40;
        } else if (content.includes(needle)) {
            score = 10;
        }

        if (score > 0) {
            scored.push({ note, score });
        }
    }

    return scored
        .sort(
            (a, b) =>
                b.score - a.score ||
                b.note.updatedAt.localeCompare(a.note.updatedAt),
        )
        .slice(0, limit)
        .map((entry) => entry.note);
}

/** Dirty notes waiting to be pushed. */
export function dirtyNotes(): LocalNote[] {
    return [...notes.values()].filter((note) => note.dirty === 1);
}

/**
 * Drop clean local duplicates of a calendar period (a lazily created empty
 * note that the server's authoritative copy has since superseded). Dirty
 * duplicates are kept — pushing them lets the server remap and merge them.
 */
export async function pruneCalendarDuplicates(
    canonicalId: string,
): Promise<void> {
    const canonical = notes.get(canonicalId);

    if (!canonical || canonical.type === 'note' || canonical.dateKey === null) {
        return;
    }

    for (const note of [...notes.values()]) {
        if (
            note.id !== canonical.id &&
            note.type === canonical.type &&
            note.dateKey === canonical.dateKey &&
            note.dirty === 0
        ) {
            await removeLocalNote(note.id);
        }
    }
}

/** Mark a note clean after a successful push of the given snapshot. */
export async function markSynced(
    id: string,
    snapshotUpdatedAt: string,
    serverVersion: number,
): Promise<void> {
    const note = notes.get(id);

    if (!note) {
        return;
    }

    const stillSame = note.updatedAt === snapshotUpdatedAt;

    await persist({
        ...note,
        version: serverVersion,
        dirty: stillSame ? 0 : 1,
    });
}

/**
 * Toggle a task/checklist line inside a note's markdown (used by the Tasks
 * view). Completing a repeating task inserts its next occurrence after the
 * task's indented children, mirroring the editor behavior.
 */
export async function toggleTaskLine(
    noteId: string,
    lineIndex: number,
): Promise<void> {
    const note = notes.get(noteId);

    if (!note) {
        return;
    }

    const rawLines = note.content.split('\n');
    const parsed = parsedNote(noteId);
    const line = parsed[lineIndex];

    if (!line || (line.kind !== 'task' && line.kind !== 'checklist')) {
        return;
    }

    const completing = line.state !== 'done';
    const nextChar = completing ? 'x' : ' ';
    rawLines[lineIndex] = rawLines[lineIndex].replace(
        /^(\s*[-*+]\s\[)[ xX>-](\])/,
        `$1${nextChar}$2`,
    );

    if (completing && line.repeat !== null) {
        const { buildNextOccurrenceLine } = await import('@/core/repeat');
        const { todayDailyKey } = await import('@/core/dates');
        const nextLine = buildNextOccurrenceLine(line, todayDailyKey());

        if (nextLine !== null) {
            let insertAfter = lineIndex;

            for (let i = lineIndex + 1; i < parsed.length; i++) {
                if (
                    parsed[i].kind === 'empty' ||
                    parsed[i].indent <= line.indent
                ) {
                    break;
                }

                insertAfter = i;
            }

            rawLines.splice(insertAfter + 1, 0, nextLine);
        }
    }

    await updateNoteContent(noteId, rawLines.join('\n'));
}

/** Today's calendar keys for navigation defaults. */
export function currentPeriodKeys(): Record<CalendarKind, string> {
    return {
        daily: todayKey('daily'),
        weekly: todayKey('weekly'),
        monthly: todayKey('monthly'),
        quarterly: todayKey('quarterly'),
        yearly: todayKey('yearly'),
    };
}

/* ------------------------------------------------------------------ */
/* Folder, tag and mention management                                  */
/* ------------------------------------------------------------------ */

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rename (or move) a folder: rewrites the folder path of every contained
 * note and of explicitly created (possibly empty) subfolders.
 */
export async function renameFolder(
    oldPath: string,
    newPath: string,
): Promise<void> {
    if (
        oldPath === '' ||
        newPath === oldPath ||
        newPath.startsWith(`${oldPath}/`)
    ) {
        return;
    }

    for (const note of [...notes.values()]) {
        if (note.folder === oldPath) {
            await mutate(note.id, { folder: newPath });
        } else if (note.folder.startsWith(`${oldPath}/`)) {
            await mutate(note.id, {
                folder: newPath + note.folder.slice(oldPath.length),
            });
        }
    }

    extraFolders.value = [
        ...new Set(
            extraFolders.value.map((folder) => {
                if (folder === oldPath) {
                    return newPath;
                }

                if (folder.startsWith(`${oldPath}/`)) {
                    return newPath + folder.slice(oldPath.length);
                }

                return folder;
            }),
        ),
    ];
    await requireDb().meta.put({
        key: 'folders',
        value: [...extraFolders.value],
    });
}

/** Delete a folder, moving its notes and subfolders up to its parent. */
export async function deleteFolder(path: string): Promise<void> {
    const parent = path.includes('/')
        ? path.slice(0, path.lastIndexOf('/'))
        : '';

    for (const note of [...notes.values()]) {
        if (note.folder === path) {
            await mutate(note.id, { folder: parent });
        } else if (note.folder.startsWith(`${path}/`)) {
            const suffix = note.folder.slice(path.length + 1);
            await mutate(note.id, {
                folder: parent === '' ? suffix : `${parent}/${suffix}`,
            });
        }
    }

    extraFolders.value = extraFolders.value
        .filter((folder) => folder !== path)
        .map((folder) => {
            if (folder.startsWith(`${path}/`)) {
                const suffix = folder.slice(path.length + 1);

                return parent === '' ? suffix : `${parent}/${suffix}`;
            }

            return folder;
        });
    await requireDb().meta.put({
        key: 'folders',
        value: [...extraFolders.value],
    });
}

/** Create a copy of a note next to the original. */
export async function duplicateNote(id: string): Promise<LocalNote | null> {
    const source = notes.get(id);

    if (!source) {
        return null;
    }

    return createNote({
        title: source.title === '' ? '' : `${source.title} copy`,
        folder: source.folder,
        content: source.content,
    });
}

/**
 * Rename a tag (or a whole tag subtree) across every note in the workspace:
 * renaming `q3` rewrites `#q3` and `#q3/okrs` alike.
 */
export async function renameTag(oldTag: string, newTag: string): Promise<void> {
    await renameToken('#', oldTag, newTag);
}

/** Rename a mention (or mention subtree) across the workspace. */
export async function renameMention(
    oldMention: string,
    newMention: string,
): Promise<void> {
    await renameToken('@', oldMention, newMention);
}

async function renameToken(
    sigil: '#' | '@',
    oldName: string,
    newName: string,
): Promise<void> {
    const cleanNew = newName.replace(/^[#@]/, '').trim();

    if (cleanNew === '' || cleanNew === oldName) {
        return;
    }

    const pattern = new RegExp(
        `${sigil}${escapeRegExp(oldName)}(?=[\\s/]|$)`,
        'gm',
    );

    for (const note of liveNotes.value) {
        if (!pattern.test(note.content)) {
            pattern.lastIndex = 0;
            continue;
        }

        pattern.lastIndex = 0;
        await mutate(note.id, {
            content: note.content.replace(pattern, `${sigil}${cleanNew}`),
        });
    }
}

/* ------------------------------------------------------------------ */
/* Typed notes (front matter): projects, areas, lists                  */
/* ------------------------------------------------------------------ */

const metaCache = new Map<string, { content: string; meta: NoteMeta }>();

/** Cached front matter metadata of a note. */
export function noteMetaFor(id: string): NoteMeta {
    const note = notes.get(id);

    if (!note) {
        return EMPTY_META;
    }

    const cached = metaCache.get(id);

    if (cached && cached.content === note.content) {
        return cached.meta;
    }

    const meta = parseNoteMeta(note.content);
    metaCache.set(id, { content: note.content, meta });

    return meta;
}

/** Task completion progress of a note (projects and lists). */
export function noteProgressFor(id: string): NoteProgress {
    return noteProgress(parsedNote(id));
}

/** Notes whose review is due, most overdue first. */
export const reviewQueue = computed<LocalNote[]>(() => {
    const today = todayDailyKey();

    return regularNotes.value
        .filter((note) => {
            const meta = noteMetaFor(note.id);

            return meta.review !== null && isReviewDue(meta, today);
        })
        .sort((a, b) => {
            const nextA = nextReviewDate(noteMetaFor(a.id), today) ?? today;
            const nextB = nextReviewDate(noteMetaFor(b.id), today) ?? today;

            return nextA.localeCompare(nextB) || a.title.localeCompare(b.title);
        });
});

/** Stamp today's date into the note's `reviewed:` front matter property. */
export async function markReviewed(id: string): Promise<void> {
    const note = notes.get(id);

    if (note) {
        await updateNoteContent(
            id,
            upsertFrontMatterKey(note.content, 'reviewed', todayDailyKey()),
        );
    }
}

/** Set (or clear) the note's special type via front matter. */
export async function setNoteType(
    id: string,
    kind: NoteKind | null,
): Promise<void> {
    const note = notes.get(id);

    if (note) {
        await updateNoteContent(
            id,
            upsertFrontMatterKey(note.content, 'type', kind ?? ''),
        );
    }
}
