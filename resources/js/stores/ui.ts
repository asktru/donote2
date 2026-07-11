import { ref } from 'vue';

import { todayDailyKey } from '@/core/dates';
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
}

/** Restore the selection encoded in the URL (deep links, reloads). */
export function initViewFromUrl(): void {
    const params = new URLSearchParams(window.location.search);
    const main = params.get('v');
    const split = params.get('s');

    if (main !== null) {
        const view = deserializeView(main);

        if (view !== null && view.kind !== 'graph') {
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
