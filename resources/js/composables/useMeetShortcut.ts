import { onMounted } from 'vue';

import { pickMeetEvent } from '@/core/meetTarget';
import { donoteDesktop } from '@/lib/desktop';
import { horizonEvents, refreshHorizon } from '@/stores/eventHorizon';

/**
 * A native notification rather than an in-app toast: ⌘⇧J is a global
 * shortcut, so it usually fires while Donote is behind another window and a
 * toast would go unseen.
 */
function announce(body: string): void {
    if (typeof Notification === 'undefined') {
        return;
    }

    if (Notification.permission === 'granted') {
        new Notification('Donote', { body });

        return;
    }

    if (Notification.permission === 'default') {
        void Notification.requestPermission().then((permission) => {
            if (permission === 'granted') {
                new Notification('Donote', { body });
            }
        });
    }
}

/**
 * Handle the desktop shell's global ⌘⇧J: open the Meet link of the meeting
 * in progress, or the one starting within the hour. `window.open` with
 * `_blank` is routed to the system browser by the shell's window-open
 * handler, so there is nothing platform-specific here.
 *
 * A no-op outside the Electron shell.
 */
export function useMeetShortcut(): void {
    onMounted(() => {
        if (!donoteDesktop?.onOpenMeet) {
            return;
        }

        donoteDesktop.onOpenMeet(() => {
            const target = pickMeetEvent(horizonEvents.value, new Date());

            if (target?.hangoutLink) {
                window.open(target.hangoutLink, '_blank', 'noopener');
            } else {
                announce('No Meet link on your current or next meeting.');
            }

            // Correct the window behind the press, so the next one is fresh.
            void refreshHorizon();
        });
    });
}
