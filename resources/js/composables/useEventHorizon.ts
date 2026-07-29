import { onBeforeUnmount, onMounted } from 'vue';

import {
    initEventHorizon,
    loadCachedHorizon,
    refreshHorizon,
} from '@/stores/eventHorizon';

/**
 * Keeps the shared event window warm for as long as the page lives: hydrate
 * from IndexedDB, refresh in the background, and refresh again whenever the
 * user comes back to the window or the machine regains connectivity.
 *
 * Hydration starts during setup — not on mount — and the returned promise
 * lets a caller that needs the cache before it does anything else (the
 * calendar grid) await it.
 */
export function useEventHorizon(
    teamSlug: string,
    userId: number,
): { hydrated: Promise<void> } {
    initEventHorizon(teamSlug, userId);

    const hydrated = loadCachedHorizon();

    function revalidate(): void {
        void refreshHorizon();
    }

    onMounted(() => {
        void hydrated.then(() => refreshHorizon(true));
        window.addEventListener('focus', revalidate);
        window.addEventListener('online', revalidate);
    });

    onBeforeUnmount(() => {
        window.removeEventListener('focus', revalidate);
        window.removeEventListener('online', revalidate);
    });

    return { hydrated };
}
