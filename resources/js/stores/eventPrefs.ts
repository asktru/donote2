import { ref } from 'vue';

import { workspaceConfig } from '@/stores/workspace';

/**
 * Sidebar event preferences: which Apple calendars are switched off and
 * which events (single or whole repeating series) the user has hidden.
 * Stored per workspace in localStorage — device-local by design.
 */

export const disabledCalendars = ref<Set<string>>(new Set());
/** hide-key -> event title (kept so hidden events stay recognizable). */
export const hiddenEvents = ref<Map<string, string>>(new Map());
/** Session-only toggle that reveals hidden events for unhiding. */
export const showHiddenEvents = ref(false);

let loadedFor: string | null = null;

function storageKey(): string | null {
    const config = workspaceConfig();

    return config
        ? `donote:event-prefs:${config.teamSlug}:${config.userId}`
        : null;
}

interface StoredPrefs {
    disabledCalendars?: string[];
    hidden?: { key: string; title: string }[];
}

export function loadEventPrefs(): void {
    const key = storageKey();

    if (key === null || key === loadedFor) {
        return;
    }

    loadedFor = key;

    try {
        const raw = localStorage.getItem(key);

        if (raw === null) {
            return;
        }

        const parsed = JSON.parse(raw) as StoredPrefs;
        disabledCalendars.value = new Set(parsed.disabledCalendars ?? []);
        hiddenEvents.value = new Map(
            (parsed.hidden ?? []).map((entry) => [entry.key, entry.title]),
        );
    } catch {
        // Corrupt or unavailable storage — start from defaults.
    }
}

function persist(): void {
    const key = storageKey();

    if (key === null) {
        return;
    }

    const payload: StoredPrefs = {
        disabledCalendars: [...disabledCalendars.value],
        hidden: [...hiddenEvents.value.entries()].map(([hideKey, title]) => ({
            key: hideKey,
            title,
        })),
    };

    try {
        localStorage.setItem(key, JSON.stringify(payload));
    } catch {
        // Best-effort.
    }
}

export function toggleCalendar(calendarId: string): void {
    const next = new Set(disabledCalendars.value);

    if (next.has(calendarId)) {
        next.delete(calendarId);
    } else {
        next.add(calendarId);
    }

    disabledCalendars.value = next;
    persist();
}

export function hideEvent(hideKey: string, title: string): void {
    const next = new Map(hiddenEvents.value);
    next.set(hideKey, title);
    hiddenEvents.value = next;
    persist();
}

export function unhideEvent(hideKey: string): void {
    const next = new Map(hiddenEvents.value);
    next.delete(hideKey);
    hiddenEvents.value = next;
    persist();
}
