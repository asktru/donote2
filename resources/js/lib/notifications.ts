import { isNativeIos } from '@/lib/platform';

/**
 * Local, time-based reminder notifications — scheduled entirely on-device,
 * no server or APNs. On iOS the OS holds the schedule so notifications fire
 * even when the app is closed; on Electron/web we keep in-process timers, so
 * they fire while the app is running.
 *
 * Callers hand `reconcile()` the full set of *desired* future reminders; it
 * schedules new ones and cancels any that disappeared (a completed, edited,
 * or deleted task drops out of the set on the next reconcile).
 */

export interface DesiredNotification {
    /** Deterministic id derived from the reminder key. */
    id: number;
    /** Epoch ms the notification should fire. */
    at: number;
    title: string;
    body: string;
}

/** iOS keeps at most 64 pending local notifications; stay well under. */
const MAX_PENDING = 50;

/** Stable 31-bit positive id from a reminder key. */
export function notificationId(key: string): number {
    let hash = 0;

    for (let i = 0; i < key.length; i++) {
        hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
    }

    return Math.abs(hash) % 0x7fffffff;
}

let permissionAsked = false;

/** Trim to the soonest MAX_PENDING future notifications. */
function prepare(desired: DesiredNotification[]): DesiredNotification[] {
    const now = Date.now();
    const future = desired
        .filter((entry) => entry.at > now)
        .sort((a, b) => a.at - b.at);

    if (future.length > MAX_PENDING) {
        console.warn(
            `[donote] ${future.length} reminders exceed the ${MAX_PENDING} cap; scheduling the soonest.`,
        );
    }

    return future.slice(0, MAX_PENDING);
}

/* ------------------------------------------------------------------ */
/* iOS (Capacitor LocalNotifications)                                  */
/* ------------------------------------------------------------------ */

async function reconcileIos(desired: DesiredNotification[]): Promise<void> {
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    // Ask once, lazily — only reached when there's something to schedule.
    let permission = await LocalNotifications.checkPermissions();

    if (permission.display === 'prompt' && !permissionAsked) {
        permissionAsked = true;
        permission = await LocalNotifications.requestPermissions();
    }

    if (permission.display !== 'granted') {
        return;
    }

    const pending = await LocalNotifications.getPending();
    const pendingIds = new Set(pending.notifications.map((entry) => entry.id));
    const desiredIds = new Set(desired.map((entry) => entry.id));

    const stale = pending.notifications
        .filter((entry) => !desiredIds.has(entry.id))
        .map((entry) => ({ id: entry.id }));

    if (stale.length > 0) {
        await LocalNotifications.cancel({ notifications: stale });
    }

    const toSchedule = desired.filter((entry) => !pendingIds.has(entry.id));

    if (toSchedule.length > 0) {
        await LocalNotifications.schedule({
            notifications: toSchedule.map((entry) => ({
                id: entry.id,
                title: entry.title,
                body: entry.body,
                schedule: { at: new Date(entry.at) },
            })),
        });
    }
}

/* ------------------------------------------------------------------ */
/* Electron / web (in-process timers + Notification API)               */
/* ------------------------------------------------------------------ */

const timers = new Map<number, ReturnType<typeof setTimeout>>();

function notificationsSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
}

async function reconcileTimer(desired: DesiredNotification[]): Promise<void> {
    if (!notificationsSupported()) {
        return;
    }

    if (Notification.permission === 'default' && !permissionAsked) {
        permissionAsked = true;
        await Notification.requestPermission();
    }

    if (Notification.permission !== 'granted') {
        return;
    }

    const desiredIds = new Set(desired.map((entry) => entry.id));

    // Drop timers for reminders that are no longer wanted.
    for (const [id, timer] of timers) {
        if (!desiredIds.has(id)) {
            clearTimeout(timer);
            timers.delete(id);
        }
    }

    const now = Date.now();

    for (const entry of desired) {
        if (timers.has(entry.id)) {
            continue;
        }

        const timer = setTimeout(
            () => {
                timers.delete(entry.id);

                try {
                    new Notification(entry.title, { body: entry.body });
                } catch {
                    // Notification construction can throw if permission was
                    // revoked mid-session — ignore.
                }
            },
            Math.max(0, entry.at - now),
        );

        timers.set(entry.id, timer);
    }
}

/**
 * Reconcile scheduled reminder notifications to match `desired`. Safe to call
 * repeatedly (e.g. after every sync) — it only diffs and applies changes.
 */
export async function reconcileNotifications(
    desired: DesiredNotification[],
): Promise<void> {
    const wanted = prepare(desired);

    // Nothing to do and nothing scheduled locally — don't trigger a prompt.
    if (wanted.length === 0 && timers.size === 0 && !isNativeIos()) {
        return;
    }

    try {
        if (isNativeIos()) {
            await reconcileIos(wanted);
        } else {
            await reconcileTimer(wanted);
        }
    } catch (error) {
        console.warn('[donote] reminder notification reconcile failed', error);
    }
}
