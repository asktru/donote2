/**
 * True when running inside the Donote Electron shell on macOS, where the
 * window uses hiddenInset traffic lights that overlap the top-left corner.
 */
export const isMacDesktopShell =
    typeof navigator !== 'undefined' &&
    navigator.userAgent.includes('Electron') &&
    navigator.platform.startsWith('Mac');

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

interface CapacitorGlobal {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
}

/** True inside the native iOS (Capacitor) shell. */
export function isNativeIos(): boolean {
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;

    return cap?.isNativePlatform?.() === true && cap.getPlatform?.() === 'ios';
}
