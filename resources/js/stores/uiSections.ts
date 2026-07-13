import { reactive } from 'vue';

/**
 * Collapsed/expanded state for the sidebar sections (left rail + the right
 * events/tasks/reference panels). These are per-team, per-device UI
 * preferences — kept in localStorage only, never synced to the server —
 * so each team a user belongs to can arrange its sidebars differently.
 *
 * Sections default to expanded; only collapsed ids are stored.
 */

const STORAGE_PREFIX = 'donote:sections:';

/** sectionId → true when collapsed. Reactive so templates re-render. */
const collapsed = reactive<Record<string, boolean>>({});
let teamSlug: string | null = null;

function storageKey(slug: string): string {
    return STORAGE_PREFIX + slug;
}

function persist(): void {
    if (teamSlug === null) {
        return;
    }

    const ids = Object.keys(collapsed).filter((id) => collapsed[id]);

    try {
        localStorage.setItem(storageKey(teamSlug), JSON.stringify(ids));
    } catch {
        // Storage full or unavailable — collapse state is best-effort.
    }
}

/** Load the collapse preferences for a team (call on workspace init). */
export function initSectionPrefs(slug: string): void {
    for (const id of Object.keys(collapsed)) {
        delete collapsed[id];
    }

    teamSlug = slug;

    try {
        const raw = localStorage.getItem(storageKey(slug));
        const ids: unknown = raw !== null ? JSON.parse(raw) : [];

        if (Array.isArray(ids)) {
            for (const id of ids) {
                if (typeof id === 'string') {
                    collapsed[id] = true;
                }
            }
        }
    } catch {
        // Ignore malformed stored state — start fully expanded.
    }
}

export function isSectionCollapsed(id: string): boolean {
    return collapsed[id] === true;
}

export function toggleSection(id: string): void {
    if (collapsed[id]) {
        delete collapsed[id];
    } else {
        collapsed[id] = true;
    }

    persist();
}
