import { ref } from 'vue';

import { apiFetch } from '@/lib/api';
import { openWorkspaceDb } from '@/stores/db';
import type { WorkspaceDb } from '@/stores/db';
import {
    applyServerNote,
    dirtyNotes,
    getNote,
    markSynced,
    onWorkspaceMutation,
    pruneCalendarDuplicates,
    removeLocalNote,
    workspaceConfig,
} from '@/stores/workspace';

export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'error';

export const syncStatus = ref<SyncStatus>('synced');
export const pendingChanges = ref(0);

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

    return typeof entry?.value === 'number' ? entry.value : 0;
}

async function setCursor(cursor: number): Promise<void> {
    await db!.meta.put({ key: 'sync-cursor', value: cursor });
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

async function pull(): Promise<void> {
    let cursor = await getCursor();
    let hasMore = true;

    while (hasMore) {
        const page = await apiFetch<PullResponse>(
            `${apiBase()}/notes/sync?since=${cursor}`,
        );

        for (const note of page.notes) {
            await absorb(note);
        }

        cursor = page.cursor;
        hasMore = page.has_more;
        await setCursor(cursor);
    }
}

async function push(): Promise<void> {
    const dirty = dirtyNotes().slice(0, 200);
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
        await pull();
        syncStatus.value = 'synced';
    } catch (error) {
        syncStatus.value = navigator.onLine ? 'error' : 'offline';
        console.warn('[donote] sync failed', error);
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
