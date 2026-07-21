import { donoteDesktop } from '@/lib/desktop';

/**
 * True when running inside the Donote Electron shell on macOS, where the
 * window uses hiddenInset traffic lights that overlap the top-left corner.
 *
 * Detected via the preload-injected `window.donoteDesktop` bridge rather
 * than the user-agent: the shipped shell may present a stripped UA (a common
 * workaround so Google OAuth doesn't reject an "Electron" agent), which would
 * make a `userAgent.includes('Electron')` check silently fail. The shell is
 * macOS-only, so the bridge's presence is a sufficient signal.
 */
export const isMacDesktopShell =
    donoteDesktop !== null ||
    (typeof navigator !== 'undefined' &&
        navigator.userAgent.includes('Electron'));

/** True on touch-capable devices (phones, tablets) — gates swipe gestures. */
export const isTouchDevice =
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0);

/** True when the viewport is phone-sized (below Tailwind's md breakpoint). */
export function isNarrowViewport(): boolean {
    return (
        typeof window !== 'undefined' &&
        window.matchMedia('(max-width: 767px)').matches
    );
}

/**
 * Cmd-click "open in a new window": in the Electron shell, open the note in
 * a separate window via the `/n/<id>` deep link (which resolves the right
 * team and view). Returns true when it handled the open — the caller should
 * then skip its normal in-app navigation. A no-op returning false elsewhere.
 */
export function openNoteWindow(id: string): boolean {
    if (donoteDesktop?.openWindow) {
        void donoteDesktop.openWindow(`/n/${id}`);

        return true;
    }

    return false;
}

interface CapacitorGlobal {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
}

/** True inside the native iOS (Capacitor) shell. */
export function isNativeIos(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }

    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;

    return cap?.isNativePlatform?.() === true && cap.getPlatform?.() === 'ios';
}
