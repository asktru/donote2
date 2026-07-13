import Dexie from 'dexie';
import type { EntityTable } from 'dexie';

import type { NoteType } from '@/core/dates';
import type { NoteAccess } from '@/lib/noteAccess';

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
    /** The author's user id (as a string); the current user for own notes. */
    authorId: string;
    /** The current viewer's access to this note. */
    access: NoteAccess;
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

export interface MemoRecord {
    id: string;
    /**
     * Long recordings are split into ~10-minute parts so each upload
     * stays well under provider size limits; parts share a groupId and
     * their transcripts are stitched in `part` order once all are done.
     */
    groupId: string;
    part: number;
    /** Number of parts in the group; null while recording is ongoing. */
    partsTotal: number | null;
    /** Daily key of the day the memo was recorded. */
    dateKey: string;
    blob: Blob;
    mimeType: string;
    durationSec: number;
    status: 'pending' | 'uploading' | 'failed' | 'done';
    /** Transcribed text, set when this part reaches 'done'. */
    transcript: string | null;
    /**
     * Where the finished transcript goes: inline under [[Audio memo]] in
     * the daily note (default) or into a dedicated linked note — offered
     * for recordings longer than one segment.
     */
    destination?: 'daily' | 'note';
    error: string | null;
    attempts: number;
    createdAt: string;
}

export type WorkspaceDb = Dexie & {
    notes: EntityTable<LocalNote, 'id'>;
    meta: EntityTable<MetaEntry, 'key'>;
    reminders: EntityTable<ReminderState, 'key'>;
    memos: EntityTable<MemoRecord, 'id'>;
};

/** One IndexedDB database per (team, user) workspace. */
export function openWorkspaceDb(teamSlug: string, userId: number): WorkspaceDb {
    const db = new Dexie(`donote-${teamSlug}-${userId}`) as WorkspaceDb;

    db.version(1).stores({
        notes: 'id, type, dateKey, folder, deleted, dirty, [type+dateKey]',
        meta: 'key',
        reminders: 'key',
    });

    db.version(2).stores({
        memos: 'id, status, createdAt',
    });

    db.version(3)
        .stores({
            memos: 'id, status, createdAt, groupId',
        })
        .upgrade((transaction) =>
            transaction
                .table('memos')
                .toCollection()
                .modify((memo: Partial<MemoRecord> & { id: string }) => {
                    memo.groupId = memo.groupId ?? memo.id;
                    memo.part = memo.part ?? 0;
                    memo.partsTotal = memo.partsTotal ?? 1;
                    memo.transcript = memo.transcript ?? null;
                }),
        );

    // Existing notes predate sharing: they're all authored by this user and
    // owned by them.
    db.version(4).upgrade((transaction) =>
        transaction
            .table('notes')
            .toCollection()
            .modify((note: Partial<LocalNote>) => {
                note.authorId = note.authorId ?? String(userId);
                note.access = note.access ?? 'owner';
            }),
    );

    return db;
}
