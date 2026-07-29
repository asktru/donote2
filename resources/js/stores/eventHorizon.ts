/**
 * The ±4-week window of calendar events the app keeps warm.
 *
 * One cache serves three callers: the grid paints from it before the network
 * answers, event search treats it as its corpus, and the global Meet shortcut
 * reads it without waiting on a fetch. It is persisted so a cold launch — or
 * the desktop shell's twelve-hourly reload — shows a calendar rather than a
 * blank grid.
 *
 * Every IndexedDB call is best-effort. A browser in private mode or over
 * quota simply falls back to the network-only behaviour that came before.
 */

import { ref } from 'vue';

import { eventsInRange, horizonRange, rangeCovers } from '@/core/eventWindow';
import type { DateRange } from '@/core/eventWindow';
import { fetchEventRange } from '@/lib/calendarFetch';
import type { CalendarEvent } from '@/lib/calendarFetch';
import { openWorkspaceDb } from '@/stores/db';
import type { WorkspaceDb } from '@/stores/db';

/** Don't re-hit Google for a window fetched this recently. */
const REFRESH_THROTTLE_MS = 60 * 1000;

/** Where the window's anchor time is kept between sessions. */
const ANCHOR_KEY = 'calendar:horizon-anchor';

export const horizonEvents = ref<CalendarEvent[]>([]);
export const horizonFetchedAt = ref<number | null>(null);

/**
 * The `now` the loaded window was built around — persisted, because a cache
 * written five days ago covers `then ± 4 weeks`, not `now ± 4 weeks`. Anchor
 * it to the present on load and the store would claim coverage of a stretch
 * of next month it never fetched.
 */
const anchoredAt = ref<Date | null>(null);

let db: WorkspaceDb | null = null;
let refreshing: Promise<void> | null = null;

/**
 * Point the horizon at a workspace. Called by the pages, which know the team
 * and user from their Inertia props — the workspace store may not have
 * booted yet when the calendar mounts.
 */
export function initEventHorizon(teamSlug: string, userId: number): void {
    db = openWorkspaceDb(teamSlug, userId);
}

/** Read the persisted window into memory. Silent on failure. */
export async function loadCachedHorizon(): Promise<void> {
    if (db === null) {
        return;
    }

    // A live refresh that landed first always wins.
    if (anchoredAt.value !== null) {
        return;
    }

    try {
        const [cached, anchor] = await Promise.all([
            db.calendarEvents.toArray(),
            db.meta.get(ANCHOR_KEY),
        ]);

        if (
            anchoredAt.value === null &&
            cached.length > 0 &&
            typeof anchor?.value === 'number'
        ) {
            horizonEvents.value = cached;
            anchoredAt.value = new Date(anchor.value);
        }
    } catch {
        // No cache available — the network path still works.
    }
}

/**
 * Fetch the window afresh and persist it. Concurrent calls share one
 * in-flight request; repeat calls inside the throttle are dropped unless
 * forced.
 */
export async function refreshHorizon(force = false): Promise<void> {
    if (db === null) {
        return;
    }

    if (refreshing !== null) {
        return refreshing;
    }

    const fetchedAt = horizonFetchedAt.value;

    if (
        !force &&
        fetchedAt !== null &&
        Date.now() - fetchedAt < REFRESH_THROTTLE_MS
    ) {
        return;
    }

    refreshing = (async () => {
        const now = new Date();
        const range = horizonRange(now);

        try {
            const found = await fetchEventRange(range.start, range.end);

            horizonEvents.value = found;
            horizonFetchedAt.value = Date.now();
            anchoredAt.value = now;

            try {
                await db!.transaction(
                    'rw',
                    db!.calendarEvents,
                    db!.meta,
                    async () => {
                        await db!.calendarEvents.clear();
                        await db!.calendarEvents.bulkPut(found);
                        await db!.meta.put({
                            key: ANCHOR_KEY,
                            value: now.getTime(),
                        });
                    },
                );
            } catch {
                // Persisting is a nicety; the in-memory window still works.
            }
        } catch {
            // Keep whatever is cached rather than emptying the window.
        } finally {
            refreshing = null;
        }
    })();

    return refreshing;
}

/**
 * The cached events for a view's range, or null when the window does not
 * fully cover it. Partial coverage deliberately returns null: half a month
 * rendered from cache reads as a month with events missing, which is worse
 * than a brief wait.
 */
export function seedFromHorizon(range: DateRange): CalendarEvent[] | null {
    const anchor = anchoredAt.value;

    if (anchor === null || horizonEvents.value.length === 0) {
        return null;
    }

    if (!rangeCovers(horizonRange(anchor), range)) {
        return null;
    }

    return eventsInRange(horizonEvents.value, range);
}
