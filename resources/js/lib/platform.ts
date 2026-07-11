/**
 * True when running inside the Donote Electron shell on macOS, where the
 * window uses hiddenInset traffic lights that overlap the top-left corner.
 */
export const isMacDesktopShell =
    typeof navigator !== 'undefined' &&
    navigator.userAgent.includes('Electron') &&
    navigator.platform.startsWith('Mac');
