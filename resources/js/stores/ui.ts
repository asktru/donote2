import { ref } from 'vue';

import { addPeriods, todayDailyKey, todayKey } from '@/core/dates';
import type { CalendarKind } from '@/core/dates';
import { getNote, recordVisit } from '@/stores/workspace';

export type PaneView =
    | { kind: 'calendar'; calKind: CalendarKind; dateKey: string }
    | { kind: 'note'; id: string };

export type SplitView =
    | PaneView
    | { kind: 'tag'; tag: string }
    | { kind: 'mention'; mention: string }
    | { kind: 'graph'; noteId: string };

export type MainView =
    | PaneView
    | { kind: 'tasks' }
    | { kind: 'trash' }
    | { kind: 'reminders' }
    | { kind: 'tag'; tag: string }
    | { kind: 'mention'; mention: string };

export const currentView = ref<MainView>({
    kind: 'calendar',
    calKind: 'daily',
    dateKey: todayDailyKey(),
});
export const splitView = ref<SplitView | null>(null);
export const searchOpen = ref(false);
export const shortcutsOpen = ref(false);
/** Off-canvas sidebar state on small screens. */
export const mobileSidebarOpen = ref(false);
/**
 * Expanded sidebar folders. Empty on every app open — the sidebar
 * starts fully collapsed by design.
 */
export const expandedFolders = ref<Set<string>>(new Set());

export function toggleFolder(path: string): void {
    const next = new Set(expandedFolders.value);

    if (next.has(path)) {
        next.delete(path);
    } else {
        next.add(path);
    }

    expandedFolders.value = next;
}

export function expandFolder(path: string): void {
    if (path !== '' && !expandedFolders.value.has(path)) {
        expandedFolders.value = new Set(expandedFolders.value).add(path);
    }
}

/** Expand a folder together with all its ancestors. */
export function expandFolderPath(path: string): void {
    const next = new Set(expandedFolders.value);
    const segments = path.split('/');

    for (let i = 1; i <= segments.length; i++) {
        next.add(segments.slice(0, i).join('/'));
    }

    next.delete('');
    expandedFolders.value = next;
}

export function collapseAllFolders(): void {
    expandedFolders.value = new Set();
}

/** Fullscreen image viewer (clicked inline previews). */
export const lightboxImage = ref<{ url: string; alt: string } | null>(null);
/** Clicked ⟲ glyph: which synced line, and where to anchor the panel. */
export const syncedLinePanel = ref<{
    syncId: string;
    x: number;
    y: number;
} | null>(null);

/** Fullscreen file viewer for text/html/csv attachments. */
export const filePreview = ref<{
    kind: 'text' | 'html' | 'csv';
    name: string;
    url: string;
    content: string;
} | null>(null);
/** Line index the main editor should scroll to after opening a note. */
export const pendingScrollLine = ref<number | null>(null);

function serializeView(view: MainView | SplitView): string {
    switch (view.kind) {
        case 'graph':
            return `graph:${view.noteId}`;
        case 'calendar':
            return `${view.calKind}:${view.dateKey}`;
        case 'note':
            return `note:${view.id}`;
        case 'tasks':
            return 'tasks';
        case 'trash':
            return 'trash';
        case 'reminders':
            return 'reminders';
        case 'tag':
            return `tag:${view.tag}`;
        case 'mention':
            return `mention:${view.mention}`;
    }
}

function deserializeView(raw: string): MainView | SplitView | null {
    const [head, ...rest] = raw.split(':');
    const payload = rest.join(':');

    if (head === 'tasks') {
        return { kind: 'tasks' };
    }

    if (head === 'trash') {
        return { kind: 'trash' };
    }

    if (head === 'reminders') {
        return { kind: 'reminders' };
    }

    if (head === 'graph' && payload !== '') {
        return { kind: 'graph', noteId: payload };
    }

    if (head === 'note' && payload !== '') {
        return { kind: 'note', id: payload };
    }

    if (head === 'tag' && payload !== '') {
        return { kind: 'tag', tag: payload };
    }

    if (head === 'mention' && payload !== '') {
        return { kind: 'mention', mention: payload };
    }

    if (
        ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(head) &&
        payload !== ''
    ) {
        return {
            kind: 'calendar',
            calKind: head as CalendarKind,
            dateKey: payload,
        };
    }

    return null;
}

/** Last-view memory, keyed by pathname so each team remembers its own. */
function lastViewKey(): string {
    return `donote:last-view:${window.location.pathname}`;
}

function pushUrl(): void {
    const params = new URLSearchParams(window.location.search);
    params.set('v', serializeView(currentView.value));

    if (splitView.value !== null) {
        params.set('s', serializeView(splitView.value));
    } else {
        params.delete('s');
    }

    window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}?${params}`,
    );

    // Any navigation dismisses the off-canvas sidebar on small screens.
    mobileSidebarOpen.value = false;

    try {
        localStorage.setItem(lastViewKey(), params.toString());
    } catch {
        // Storage full or unavailable — last-view memory is best-effort.
    }
}

/**
 * Restore the selection encoded in the URL (deep links, reloads), falling
 * back to the last remembered view when the URL carries none.
 */
export function initViewFromUrl(): void {
    let params = new URLSearchParams(window.location.search);

    let fromMemory = false;

    if (!params.has('v')) {
        const remembered = localStorage.getItem(lastViewKey());

        if (remembered !== null) {
            params = new URLSearchParams(remembered);
            fromMemory = true;
        }
    }

    const main = params.get('v');
    const split = params.get('s');

    if (main !== null) {
        const view = deserializeView(main);

        if (view !== null && view.kind !== 'graph') {
            if (view.kind === 'calendar' && fromMemory) {
                // A fresh launch lands on the current period, not the one
                // that happened to be open last time.
                view.dateKey = todayKey(view.calKind);
            }

            currentView.value = view;
        }
    }

    if (split !== null) {
        const view = deserializeView(split);

        if (
            view !== null &&
            view.kind !== 'tasks' &&
            view.kind !== 'trash' &&
            view.kind !== 'reminders'
        ) {
            splitView.value = view;
        }
    }
}

export function openView(view: MainView): void {
    currentView.value = view;

    if (view.kind === 'note') {
        recordVisit({ kind: 'note', id: view.id });
    } else if (view.kind === 'calendar') {
        recordVisit({
            kind: 'calendar',
            calKind: view.calKind,
            dateKey: view.dateKey,
        });
    }

    pushUrl();
}

export function openNote(
    id: string,
    options: { split?: boolean; line?: number } = {},
): void {
    // Calendar notes opened by id (tag rows, backlinks, synced-line
    // jumps…) get their real calendar view — date header, prev/next —
    // instead of rendering as an "Untitled" regular note.
    const note = getNote(id);

    if (note && note.type !== 'note' && note.dateKey !== null) {
        if (options.line !== undefined && !options.split) {
            pendingScrollLine.value = options.line;
        }

        openCalendar(note.type, note.dateKey, { split: options.split });

        return;
    }

    if (options.split) {
        splitView.value = { kind: 'note', id };
        recordVisit({ kind: 'note', id });
    } else {
        if (options.line !== undefined) {
            pendingScrollLine.value = options.line;
        }

        openView({ kind: 'note', id });
    }

    pushUrl();
}

/**
 * Move the main calendar view to an adjacent period (the next/previous day,
 * week, month, …). No-op unless a calendar note is the current main view.
 * Returns whether it stepped, so gesture handlers know it was consumed.
 */
export function stepCalendar(delta: number): boolean {
    const view = currentView.value;

    if (view.kind !== 'calendar') {
        return false;
    }

    openCalendar(view.calKind, addPeriods(view.dateKey, delta));

    return true;
}

export function openCalendar(
    calKind: CalendarKind,
    dateKey: string,
    options: { split?: boolean } = {},
): void {
    if (options.split) {
        splitView.value = { kind: 'calendar', calKind, dateKey };
        recordVisit({ kind: 'calendar', calKind, dateKey });
    } else {
        openView({ kind: 'calendar', calKind, dateKey });
    }

    pushUrl();
}

export function openTagView(tag: string, split = false): void {
    if (split) {
        splitView.value = { kind: 'tag', tag };
    } else {
        currentView.value = { kind: 'tag', tag };
    }

    pushUrl();
}

export function openMentionView(mention: string, split = false): void {
    if (split) {
        splitView.value = { kind: 'mention', mention };
    } else {
        currentView.value = { kind: 'mention', mention };
    }

    pushUrl();
}

export function openGraphView(noteId: string): void {
    splitView.value = { kind: 'graph', noteId };
    pushUrl();
}

export function closeSplit(): void {
    splitView.value = null;
    pushUrl();
}
