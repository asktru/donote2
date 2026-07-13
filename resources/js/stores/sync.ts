import { ref } from 'vue';

import { apiFetch } from '@/lib/api';
import type { NoteAccess } from '@/lib/noteAccess';
import { notesToPrune } from '@/lib/noteAccess';
import { openWorkspaceDb } from '@/stores/db';
import type { WorkspaceDb } from '@/stores/db';
import type { WorkspaceConfig } from '@/stores/workspace';
import {
    applyServerNote,
    clearCleanLocalNotes,
    dirtyNotes,
    getNote,
    liveNotes,
    markSynced,
    onWorkspaceMutation,
    pruneCalendarDuplicates,
    removeLocalNote,
    workspaceConfig,
} from '@/stores/workspace';

export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'error';

export const syncStatus = ref<SyncStatus>('synced');
export const pendingChanges = ref(0);

/** Diagnostics surfaced by the in-app Sync panel. */
export const syncCursor = ref(0);
export const lastSyncAt = ref<number | null>(null);
export const lastSyncError = ref<string | null>(null);

export interface SyncLogEntry {
    at: number;
    level: 'info' | 'warn' | 'error';
    message: string;
}

export const syncLog = ref<SyncLogEntry[]>([]);

/** Append a capped, newest-last diagnostic line for the Sync panel. */
function logSync(level: SyncLogEntry['level'], message: string): void {
    syncLog.value = [
        ...syncLog.value.slice(-49),
        { at: Date.now(), level, message },
    ];
}

interface ServerNote {
    id: string;
    type: 'note' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
    date_key: string | null;
    title: string;
    content: string;
    folder: string;
    pinned: boolean;
    version: number;
    server_seq: number;
    updated_at: string | null;
    deleted: boolean;
    author_id: number;
    access: NoteAccess;
}

interface PullResponse {
    cursor: number;
    has_more: boolean;
    notes: ServerNote[];
}

interface PushResponse {
    results: {
        id: string;
        status: 'applied' | 'remapped' | 'conflict';
        note: ServerNote;
    }[];
}

let db: WorkspaceDb | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pullTimer: ReturnType<typeof setInterval> | null = null;
let syncing = false;
let started = false;

function apiBase(): string {
    const cfg = workspaceConfig();

    if (!cfg) {
        throw new Error('Workspace is not initialized.');
    }

    return `/api/${cfg.teamSlug}`;
}

async function getCursor(): Promise<number> {
    const entry = await db!.meta.get('sync-cursor');
    const cursor = typeof entry?.value === 'number' ? entry.value : 0;
    syncCursor.value = cursor;

    return cursor;
}

async function setCursor(cursor: number): Promise<void> {
    syncCursor.value = cursor;
    await db!.meta.put({ key: 'sync-cursor', value: cursor });
}

function requireDb(): WorkspaceDb {
    if (!db) {
        db = openWorkspaceDb(requireConfig().teamSlug, requireConfig().userId);
    }

    return db;
}

function requireConfig(): WorkspaceConfig {
    const cfg = workspaceConfig();

    if (!cfg) {
        throw new Error('Workspace is not initialized.');
    }

    return cfg;
}

/**
 * Incorporate a server note. Local dirty edits win when they are newer than
 * the server copy (they will be pushed next); otherwise the server wins.
 */
async function absorb(server: ServerNote): Promise<void> {
    const local = getNote(server.id);

    if (local && local.dirty === 1) {
        const localTime = Date.parse(local.updatedAt);
        const serverTime =
            server.updated_at !== null ? Date.parse(server.updated_at) : 0;

        if (localTime >= serverTime) {
            return;
        }
    }

    await applyServerNote(server);
    await pruneCalendarDuplicates(server.id);
}

async function pull(): Promise<number> {
    let cursor = await getCursor();
    let hasMore = true;
    let received = 0;

    while (hasMore) {
        const page = await apiFetch<PullResponse>(
            `${apiBase()}/notes/sync?since=${cursor}`,
        );

        for (const note of page.notes) {
            await absorb(note);
        }

        received += page.notes.length;
        cursor = page.cursor;
        hasMore = page.has_more;
        await setCursor(cursor);
    }

    return received;
}

async function push(): Promise<void> {
    // Read-only shared notes must never be pushed back to the server.
    const dirty = dirtyNotes()
        .filter((note) => note.access !== 'read')
        .slice(0, 200);
    pendingChanges.value = dirty.length;

    if (dirty.length === 0) {
        return;
    }

    const snapshots = new Map(dirty.map((note) => [note.id, note.updatedAt]));

    const response = await apiFetch<PushResponse>(`${apiBase()}/notes/sync`, {
        method: 'POST',
        body: JSON.stringify({
            changes: dirty.map((note) => ({
                id: note.id,
                type: note.type,
                date_key: note.dateKey,
                title: note.title,
                content: note.content,
                folder: note.folder,
                pinned: note.pinned === 1,
                base_version: note.version,
                deleted: note.deleted === 1,
                client_updated_at: note.updatedAt,
            })),
        }),
    });

    for (const result of response.results) {
        if (result.status === 'remapped' && result.note.id !== result.id) {
            // A duplicate calendar note was merged into the canonical server
            // copy — drop the local duplicate and adopt the server note.
            await removeLocalNote(result.id);
            await applyServerNote(result.note);
            continue;
        }

        if (result.status === 'conflict') {
            await absorb(result.note);
            continue;
        }

        await markSynced(
            result.id,
            snapshots.get(result.id) ?? '',
            result.note.version,
        );
    }

    pendingChanges.value = dirtyNotes().length;
}

/**
 * Drop local notes the server no longer shares with this user (a revoked
 * share, a note flipped back to private, a departed collaborator). Own notes
 * and dirty notes are always kept.
 */
export async function reconcileVisibility(): Promise<number> {
    const { ids } = await apiFetch<{ ids: string[] }>(
        `${apiBase()}/notes/visible-ids`,
    );

    // A transient empty/short response would otherwise wipe real notes that
    // the cursor can never re-fetch. Never prune against an empty set — a
    // workspace with zero visible notes has nothing local to reconcile either.
    if (ids.length === 0) {
        if (liveNotes.value.length > 0) {
            logSync(
                'warn',
                'Skipped visibility prune: server returned no visible notes.',
            );
        }

        return 0;
    }

    const visible = new Set(ids);
    const dirty = new Set(dirtyNotes().map((note) => note.id));
    const localIds = liveNotes.value.map((note) => note.id);

    let pruned = 0;

    for (const id of notesToPrune(localIds, visible, dirty)) {
        await removeLocalNote(id);
        pruned += 1;
    }

    return pruned;
}

/** Run one full sync cycle (push local changes, then pull remote ones). */
export async function syncNow(): Promise<void> {
    if (syncing) {
        return;
    }

    if (!navigator.onLine) {
        syncStatus.value = 'offline';

        return;
    }

    syncing = true;
    syncStatus.value = 'syncing';

    try {
        await push();
        const received = await pull();
        const pruned = await reconcileVisibility();

        syncStatus.value = 'synced';
        lastSyncAt.value = Date.now();
        lastSyncError.value = null;

        if (received > 0 || pruned > 0) {
            logSync(
                'info',
                `Synced: pulled ${received}, pruned ${pruned} (cursor ${syncCursor.value}).`,
            );
        }
    } catch (error) {
        syncStatus.value = navigator.onLine ? 'error' : 'offline';
        lastSyncError.value = error instanceof Error ? error.message : String(error);
        logSync('error', `Sync failed: ${lastSyncError.value}`);
        console.warn('[donote] sync failed', error);
    } finally {
        syncing = false;
        pendingChanges.value = dirtyNotes().length;
    }
}

export interface ServerStats {
    visibleCount: number;
    maxSeq: number;
}

/** Ask the server how many notes the caller can see and its cursor ceiling. */
export async function fetchServerStats(): Promise<ServerStats> {
    const stats = await apiFetch<{ visible_count: number; max_seq: number }>(
        `${apiBase()}/notes/sync-stats`,
    );

    return { visibleCount: stats.visible_count, maxSeq: stats.max_seq };
}

/**
 * Force a full re-pull: push pending edits, reset the cursor to 0, and
 * re-download the entire workspace. Non-destructive — unpushed local edits
 * are pushed first and then protected by last-write-wins on the re-pull.
 */
export async function forceFullResync(): Promise<void> {
    if (syncing) {
        return;
    }

    db = requireDb();
    syncing = true;
    syncStatus.value = 'syncing';
    logSync('info', 'Force full resync started (cursor reset to 0).');

    try {
        await push();
        await setCursor(0);
        const received = await pull();
        const pruned = await reconcileVisibility();

        syncStatus.value = 'synced';
        lastSyncAt.value = Date.now();
        lastSyncError.value = null;
        logSync('info', `Force resync done: pulled ${received}, pruned ${pruned}.`);
    } catch (error) {
        syncStatus.value = navigator.onLine ? 'error' : 'offline';
        lastSyncError.value = error instanceof Error ? error.message : String(error);
        logSync('error', `Force resync failed: ${lastSyncError.value}`);

        throw error;
    } finally {
        syncing = false;
        pendingChanges.value = dirtyNotes().length;
    }
}

/**
 * Nuclear recovery for a corrupted local database: push pending edits, drop
 * every clean note from the local cache, reset the cursor, and re-download
 * everything. Notes with unpushed edits are kept so no local work is lost.
 */
export async function rebuildLocalCopy(): Promise<void> {
    if (syncing) {
        return;
    }

    db = requireDb();
    syncing = true;
    syncStatus.value = 'syncing';
    logSync('warn', 'Rebuilding local copy from the server…');

    try {
        await push();
        const removed = await clearCleanLocalNotes();
        await setCursor(0);
        const received = await pull();
        await reconcileVisibility();

        syncStatus.value = 'synced';
        lastSyncAt.value = Date.now();
        lastSyncError.value = null;
        logSync(
            'info',
            `Rebuild done: cleared ${removed}, re-downloaded ${received}.`,
        );
    } catch (error) {
        syncStatus.value = navigator.onLine ? 'error' : 'offline';
        lastSyncError.value = error instanceof Error ? error.message : String(error);
        logSync('error', `Rebuild failed: ${lastSyncError.value}`);

        throw error;
    } finally {
        syncing = false;
        pendingChanges.value = dirtyNotes().length;
    }
}

function schedulePush(): void {
    pendingChanges.value = dirtyNotes().length;

    if (pushTimer !== null) {
        clearTimeout(pushTimer);
    }

    pushTimer = setTimeout(() => {
        pushTimer = null;
        void syncNow();
    }, 1500);
}

/** Boot the sync engine: initial pull, mutation-driven pushes, periodic pulls. */
export async function startSync(): Promise<void> {
    if (started) {
        await syncNow();

        return;
    }

    started = true;
    const cfg = workspaceConfig();

    if (!cfg) {
        return;
    }

    db = openWorkspaceDb(cfg.teamSlug, cfg.userId);

    onWorkspaceMutation(schedulePush);

    window.addEventListener('online', () => void syncNow());
    window.addEventListener('offline', () => {
        syncStatus.value = 'offline';
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            void syncNow();
        }
    });

    pullTimer = setInterval(() => void syncNow(), 30000);

    await syncNow();
}

export function stopSync(): void {
    if (pullTimer !== null) {
        clearInterval(pullTimer);
        pullTimer = null;
    }

    started = false;
}
