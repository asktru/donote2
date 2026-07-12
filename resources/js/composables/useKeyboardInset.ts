import { Keyboard } from '@capacitor/keyboard';
import { onBeforeUnmount, onMounted, ref } from 'vue';

import { isNativeIos } from '@/lib/platform';

/**
 * Height (px) the on-screen keyboard currently occupies, tracked via the
 * visual viewport so a toolbar can sit just above it. 0 when hidden. A
 * module singleton so every consumer shares one set of listeners.
 */
export const keyboardHeight = ref(0);

function measure(): void {
    const vv = window.visualViewport;

    if (!vv) {
        keyboardHeight.value = 0;

        return;
    }

    const inset = Math.round(window.innerHeight - vv.height - vv.offsetTop);
    // Ignore small insets (a collapsing browser chrome bar isn't a keyboard).
    keyboardHeight.value = inset > 120 ? inset : 0;
}

/** Track the keyboard height while the calling component is mounted. */
export function useKeyboardInset(): typeof keyboardHeight {
    onMounted(() => {
        window.visualViewport?.addEventListener('resize', measure);
        window.visualViewport?.addEventListener('scroll', measure);
        measure();
    });

    onBeforeUnmount(() => {
        window.visualViewport?.removeEventListener('resize', measure);
        window.visualViewport?.removeEventListener('scroll', measure);
    });

    return keyboardHeight;
}

/**
 * Hide iOS's built-in keyboard accessory bar (the prev/next/Done row) so
 * our own editor toolbar takes its place. Native iOS only; a no-op elsewhere.
 */
export async function hideNativeAccessoryBar(): Promise<void> {
    if (!isNativeIos()) {
        return;
    }

    try {
        await Keyboard.setAccessoryBarVisible({ isVisible: false });
    } catch {
        // Plugin unavailable — the bar just stays; not worth surfacing.
    }
}
