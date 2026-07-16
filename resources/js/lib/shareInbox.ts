import { Capacitor, registerPlugin } from '@capacitor/core';

import { todayDailyKey } from '@/core/dates';
import { uploadAttachment, attachmentMarkdown } from '@/lib/attachments';
import { isNativeIos } from '@/lib/platform';
import {
    createNote,
    openCalendarNote,
    updateNoteContent,
    workspaceConfig,
} from '@/stores/workspace';

/**
 * Drains the queue the iOS share extension writes into the App Group
 * container (see `ios/App/DonoteShare/ShareViewController.swift` and
 * `ShareInboxPlugin.swift`). Shared web pages and text become notes in the
 * Inbox folder; shared photos/files are uploaded as attachments and linked
 * from today's daily note. Items are removed from the queue only after they
 * were ingested, so a failure (e.g. offline during an upload) retries on the
 * next app foreground.
 */

export interface ShareInboxItem {
    id: string;
    kind: 'url' | 'text' | 'file';
    createdAt?: string;
    /** Team workspace picked in the share sheet; absent on legacy items. */
    teamSlug?: string;
    title?: string;
    url?: string;
    description?: string;
    comment?: string;
    fileName?: string;
    mimeType?: string;
    filePath?: string;
}

interface ShareInboxPlugin {
    list: () => Promise<{ items: ShareInboxItem[] }>;
    remove: (options: { id: string }) => Promise<void>;
    publishTeams: (options: {
        current: string;
        teams: { slug: string; name: string }[];
    }) => Promise<void>;
}

/**
 * Items the open workspace may ingest: ones routed to it in the share sheet,
 * plus untagged legacy items. Shares aimed at other teams stay queued until
 * that team is opened — notes and daily-note appends only exist in the
 * active workspace's local store.
 */
export function itemsForTeam(
    items: ShareInboxItem[],
    teamSlug: string,
): ShareInboxItem[] {
    return items.filter(
        (item) => !item.teamSlug || item.teamSlug === teamSlug,
    );
}

/** Folder shared pages land in — easy to triage, out of the notes tree root. */
export const SHARE_INBOX_FOLDER = 'Inbox';

/** Note title for a shared page/text: page title, else host, else a stub. */
export function sharedNoteTitle(item: ShareInboxItem): string {
    const title = item.title?.trim();

    if (title) {
        return title;
    }

    if (item.url) {
        try {
            return new URL(item.url).hostname.replace(/^www\./, '');
        } catch {
            // Unparsable URL — fall through to the stub.
        }
    }

    return item.kind === 'text' ? 'Shared text' : 'Shared link';
}

/** Note body for a shared page/text: link, quoted description, comment. */
export function sharedNoteContent(item: ShareInboxItem): string {
    const parts: string[] = [];
    const description = item.description?.trim() ?? '';
    const comment = item.comment?.trim() ?? '';

    if (item.url) {
        parts.push(item.url);
    }

    if (description !== '') {
        parts.push(
            item.kind === 'text'
                ? description
                : description
                      .split('\n')
                      .map((line) => `> ${line}`)
                      .join('\n'),
        );
    }

    if (comment !== '') {
        parts.push(comment);
    }

    return parts.join('\n\n');
}

/** The daily-note line for a shared attachment, comment inline after it. */
export function sharedAttachmentLine(
    markdown: string,
    comment: string | undefined,
): string {
    const note = comment?.trim() ?? '';

    return note === '' ? markdown : `${markdown} ${note}`;
}

/** Append `line` to note content, exactly one newline apart, no stray blanks. */
export function appendLine(content: string, line: string): string {
    const trimmed = content.replace(/\s+$/, '');

    return trimmed === '' ? `${line}\n` : `${trimmed}\n${line}\n`;
}

const plugin: ShareInboxPlugin | null = isNativeIos()
    ? registerPlugin<ShareInboxPlugin>('ShareInbox')
    : null;

let processing = false;
let watcherRegistered = false;

async function ingestUrlOrText(item: ShareInboxItem): Promise<void> {
    await createNote({
        title: sharedNoteTitle(item),
        folder: SHARE_INBOX_FOLDER,
        content: sharedNoteContent(item),
    });
}

async function ingestFile(item: ShareInboxItem): Promise<void> {
    if (!item.filePath) {
        return; // Payload never made it into the container — nothing to save.
    }

    const response = await fetch(Capacitor.convertFileSrc(item.filePath));

    if (!response.ok) {
        throw new Error(`Could not read shared file (${response.status}).`);
    }

    const blob = await response.blob();
    const file = new File([blob], item.fileName || 'shared', {
        type: item.mimeType || blob.type || 'application/octet-stream',
    });

    const daily = await openCalendarNote('daily', todayDailyKey());
    const attachment = await uploadAttachment(file, daily.id);

    await updateNoteContent(
        daily.id,
        appendLine(
            daily.content,
            sharedAttachmentLine(attachmentMarkdown(attachment), item.comment),
        ),
    );
}

/**
 * Ingest every queued share. Safe to call repeatedly; failures keep their
 * queue entries for the next run.
 */
export async function processShareInbox(): Promise<void> {
    const config = workspaceConfig();

    if (plugin === null || processing || !config) {
        return;
    }

    processing = true;

    try {
        const { items } = await plugin.list();

        for (const item of itemsForTeam(items, config.teamSlug)) {
            try {
                if (item.kind === 'file') {
                    await ingestFile(item);
                } else {
                    await ingestUrlOrText(item);
                }

                await plugin.remove({ id: item.id });
            } catch (error) {
                console.warn('[donote] share ingest failed', item.id, error);
            }
        }
    } catch (error) {
        console.warn('[donote] share inbox unavailable', error);
    } finally {
        processing = false;
    }
}

/**
 * Publish the team list into the shared container so the share sheet can
 * offer a "Team" picker. Fire-and-forget, refreshed on every page boot.
 */
export function publishShareTargets(
    teams: { slug: string; name: string }[],
    current: string,
): void {
    if (plugin === null || teams.length === 0) {
        return;
    }

    void plugin
        .publishTeams({
            current,
            teams: teams.map(({ slug, name }) => ({ slug, name })),
        })
        .catch(() => {
            // Older installed app without the method — the picker just
            // won't appear until the native app is updated.
        });
}

/**
 * Process now and on every app foreground — the moment a user shares from
 * Safari/Photos and switches back to Donote.
 */
export function startShareInboxWatcher(): void {
    if (plugin === null) {
        return;
    }

    void processShareInbox();

    if (!watcherRegistered) {
        watcherRegistered = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                void processShareInbox();
            }
        });
    }
}
