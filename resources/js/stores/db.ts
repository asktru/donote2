import Dexie from 'dexie';
import type { EntityTable } from 'dexie';

import type { NoteType } from '@/core/dates';

export interface LocalNote {
    id: string;
    type: NoteType;
    dateKey: string | null;
    title: string;
    content: string;
    folder: string;
    pinned: 0 | 1;
    /** Last version confirmed by the server (0 for never-synced notes). */
    version: number;
    /** ISO timestamp of the last local edit. */
    updatedAt: string;
    deleted: 0 | 1;
    /** 1 when the note has local changes the server has not seen. */
    dirty: 0 | 1;
}

export interface MetaEntry {
    key: string;
    value: unknown;
}

export interface ReminderState {
    key: string;
    status: 'dismissed' | 'snoozed';
    /** Epoch ms after which a snoozed reminder may fire again. */
    until: number | null;
}

export type WorkspaceDb = Dexie & {
    notes: EntityTable<LocalNote, 'id'>;
    meta: EntityTable<MetaEntry, 'key'>;
    reminders: EntityTable<ReminderState, 'key'>;
};

/** One IndexedDB database per (team, user) workspace. */
export function openWorkspaceDb(teamSlug: string, userId: number): WorkspaceDb {
    const db = new Dexie(`donote-${teamSlug}-${userId}`) as WorkspaceDb;

    db.version(1).stores({
        notes: 'id, type, dateKey, folder, deleted, dirty, [type+dateKey]',
        meta: 'key',
        reminders: 'key',
    });

    return db;
}
