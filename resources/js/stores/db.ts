import Dexie from 'dexie';
import type { EntityTable } from 'dexie';

import type { NoteType } from '@/core/dates';
import type { CalendarEvent } from '@/lib/calendarFetch';
import type { NoteAccess } from '@/lib/noteAccess';

/**
 * A calendar event kept for offline paint. Stored exactly as fetched — the
 * cache is a snapshot of a window, replaced wholesale on refresh, never
 * merged, so an event deleted upstream disappears here too.
 */
export type CachedCalendarEvent = CalendarEvent;

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
    /**
     * Slug of the team that was active when the recording STARTED. Uploads
     * and filing target this team no matter which team is active later —
     * switching teams (or relaunching into another one) must never move a
     * transcript into the wrong workspace.
     */
    teamSlug: string;
    blob: Blob;
    mimeType: string;
    durationSec: number;
    /**
     * `filed` is a retired part whose transcript has been written to a note.
     * Its heavy audio blob is cleared, but the transcript text is retained
     * (purged after a grace period) so a recording is never destroyed the
     * instant it's filed — the earlier hard-delete made any filing hiccup
     * unrecoverable.
     */
    status: 'pending' | 'uploading' | 'failed' | 'done' | 'filed';
    /** Transcribed text, set when this part reaches 'done'. */
    transcript: string | null;
    /**
     * The dedicated transcript note this recording was filed into (in the
     * Transcripts folder). Set once the note is created; used to confirm the
     * transcript is durably saved before the audio blob is cleared, and to
     * avoid creating duplicate notes on retry.
     */
    noteId?: string;
    error: string | null;
    attempts: number;
    createdAt: string;
}

export type WorkspaceDb = Dexie & {
    notes: EntityTable<LocalNote, 'id'>;
    meta: EntityTable<MetaEntry, 'key'>;
    reminders: EntityTable<ReminderState, 'key'>;
    memos: EntityTable<MemoRecord, 'id'>;
    calendarEvents: EntityTable<CachedCalendarEvent, 'key'>;
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

    db.version(5).stores({
        calendarEvents: 'key, start',
    });

    // Memos predating team stamping all live in the DB of the team they were
    // recorded in — this database — so its slug is the correct backfill.
    db.version(6).upgrade((transaction) =>
        transaction
            .table('memos')
            .toCollection()
            .modify((memo: Partial<MemoRecord>) => {
                memo.teamSlug = memo.teamSlug ?? teamSlug;
            }),
    );

    return db;
}
