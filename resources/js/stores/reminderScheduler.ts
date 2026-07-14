import { formatReminderToken, reminderCandidates } from '@/core/reminders';
import {
    notificationId,
    onNotificationSnooze,
    reconcileNotifications,
} from '@/lib/notifications';
import type { DesiredNotification } from '@/lib/notifications';
import { openWorkspaceDb } from '@/stores/db';
import type { WorkspaceDb } from '@/stores/db';
import {
    liveNotes,
    parsedNote,
    rewriteReminderToken,
    workspaceConfig,
} from '@/stores/workspace';

/**
 * App-wide scheduling of local reminder notifications. Runs independently of
 * any page/component so a reminder identified during sync is handed to the OS
 * regardless of which view is open — the schedule then survives the app being
 * closed (on iOS the OS delivers it even after a force-quit).
 *
 * Reads from the cached workspace, so it works even before a fresh sync: once
 * a note has been synced and cached, its reminders can be (re)scheduled from
 * any page on the next reconcile tick.
 */

const RECONCILE_INTERVAL_MS = 30_000;

let db: WorkspaceDb | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

/** Rebuild the desired notification set from every note and apply it. */
export async function reconcileReminderNotifications(): Promise<void> {
    const config = workspaceConfig();

    if (!config) {
        return;
    }

    if (db === null) {
        db = openWorkspaceDb(config.teamSlug, config.userId);
    }

    const now = Date.now();
    const desired: DesiredNotification[] = [];

    for (const note of liveNotes.value) {
        for (const candidate of reminderCandidates(note.id, parsedNote(note.id))) {
            const fireAt = candidate.at.getTime();

            if (fireAt <= now) {
                continue; // past-due reminders surface as an in-app popup
            }

            const state = await db.reminders.get(candidate.key);
            const silenced =
                state?.status === 'dismissed' ||
                (state?.status === 'snoozed' &&
                    state.until !== null &&
                    state.until > now);

            if (silenced) {
                continue;
            }

            desired.push({
                id: notificationId(candidate.key),
                at: fireAt,
                title: candidate.line.title || 'Reminder',
                body: note.title || 'Task reminder',
                noteId: note.id,
                line: candidate.line.index,
            });
        }
    }

    await reconcileNotifications(desired);
}

/**
 * Snooze a task's reminder by rewriting its `@time` token to `minutes` from
 * now, so the note reflects the new time; the next reconcile then reschedules
 * the OS notification accordingly.
 */
async function snoozeReminder(
    noteId: string,
    lineIndex: number,
    minutes: number,
): Promise<void> {
    const line = parsedNote(noteId)[lineIndex];

    if (!line || line.reminderRaw === null) {
        return;
    }

    const at = new Date(Date.now() + minutes * 60_000);

    await rewriteReminderToken(
        noteId,
        line,
        line.reminderRaw,
        formatReminderToken(at),
    );

    await reconcileReminderNotifications();
}

/** Boot once per session; safe to call from every page's onMounted. */
export function startReminderScheduler(): void {
    if (started) {
        return;
    }

    started = true;
    onNotificationSnooze((noteId, line, minutes) => {
        void snoozeReminder(noteId, line, minutes);
    });
    void reconcileReminderNotifications();
    timer = setInterval(
        () => void reconcileReminderNotifications(),
        RECONCILE_INTERVAL_MS,
    );
}

export function stopReminderScheduler(): void {
    if (timer !== null) {
        clearInterval(timer);
        timer = null;
    }

    started = false;
}
