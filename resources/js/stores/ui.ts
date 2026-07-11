import { ref } from 'vue';

import { todayDailyKey, todayKey } from '@/core/dates';
import type { CalendarKind } from '@/core/dates';
import { recordVisit } from '@/stores/workspace';

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
