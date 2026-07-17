import { registerPlugin } from '@capacitor/core';
import { router } from '@inertiajs/vue3';
import { ref } from 'vue';

import { todayDailyKey } from '@/core/dates';
import { isNativeIos } from '@/lib/platform';
import { switchMethod } from '@/routes/teams';
import { openCalendar, openView } from '@/stores/ui';

/**
 * The native iOS tab bar (DonoteTabBarController + NativeTabsPlugin).
 * Tab taps and FAB-menu actions arrive as plugin events; taps map to app
 * navigation here, actions are re-dispatched as a window CustomEvent
 * ('donote:native-action') that the components owning that behavior
 * (QuickCaptureFab, the calendar page) act on. The web app reports its own
 * navigation back through setActive so the bar highlight follows in-app
 * links too.
 */

export type NativeTabId = 'journal' | 'reminders' | 'tasks' | 'calendar';
export type NativeFabAction =
    | 'meet-with'
    | 'timeblock'
    | 'new-note'
    | 'record'
    | 'attach'
    | 'ai-prompt';

interface NativeTabsPlugin {
    setActive: (options: { id: NativeTabId }) => Promise<void>;
    height: () => Promise<{ height: number }>;
    addListener(
        event: 'tab',
        callback: (data: { id: NativeTabId }) => void,
    ): Promise<{ remove: () => Promise<void> }>;
    addListener(
        event: 'action',
        callback: (data: { id: NativeFabAction }) => void,
    ): Promise<{ remove: () => Promise<void> }>;
    addListener(
        event: 'team',
        callback: (data: { slug: string }) => void,
    ): Promise<{ remove: () => Promise<void> }>;
}

const plugin: NativeTabsPlugin | null = isNativeIos()
    ? registerPlugin<NativeTabsPlugin>('NativeTabs')
    : null;

/** True once the native bar is confirmed present — hides the web FABs. */
export const nativeTabsActive = ref(false);

let registered = false;
let teamSlug = '';
let page: 'notes' | 'calendar' = 'notes';

function onTab(id: NativeTabId): void {
    if (id === 'calendar') {
        if (page !== 'calendar') {
            router.visit(`/${teamSlug}/calendar`);
        }

        return;
    }

    // Journal, Reminders, and Tasks all live on the notes page.
    if (page !== 'notes') {
        const view = id === 'journal' ? `daily:${todayDailyKey()}` : id;

        router.visit(`/${teamSlug}/notes?v=${encodeURIComponent(view)}`);

        return;
    }

    if (id === 'journal') {
        openCalendar('daily', todayDailyKey());
    } else {
        openView({ kind: id });
    }
}

/**
 * Boot/refresh the native-tabs bridge; called from every page's onMounted
 * (listeners register once, the page/team context updates each time).
 */
export function initNativeTabs(options: {
    teamSlug: string;
    page: 'notes' | 'calendar';
}): void {
    teamSlug = options.teamSlug;
    page = options.page;

    if (plugin === null || registered) {
        return;
    }

    registered = true;

    void plugin
        .height()
        .then(({ height }) => {
            if (height <= 0) {
                return;
            }

            nativeTabsActive.value = true;
            document.documentElement.style.setProperty(
                '--native-tabs-height',
                `${Math.round(height)}px`,
            );
            document.documentElement.classList.add('native-tabs');
        })
        .catch(() => {
            // Older installed app without the tab bar — web chrome stays.
        });

    void plugin.addListener('tab', ({ id }) => onTab(id));
    void plugin.addListener('action', ({ id }) => {
        window.dispatchEvent(
            new CustomEvent<{ id: NativeFabAction }>('donote:native-action', {
                detail: { id },
            }),
        );
    });
    // The Team tab's native picker: switch the session's team, then land on
    // the new team's notes (the pages re-publish the team list on mount, so
    // the picker's "current" marker follows).
    void plugin.addListener('team', ({ slug }) => {
        if (slug === teamSlug) {
            return;
        }

        router.visit(switchMethod(slug), {
            onFinish: () => router.visit(`/${slug}/notes`),
        });
    });
}

/** Highlight the tab matching where the user actually navigated. */
export function reportNativeTab(id: NativeTabId): void {
    if (plugin !== null) {
        void plugin.setActive({ id }).catch(() => {
            // Older installed app — nothing to sync.
        });
    }
}
