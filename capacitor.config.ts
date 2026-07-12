import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

/**
 * The iOS shell wraps the Donote web app, defaulting to the production
 * deployment. Point DONOTE_MOBILE_URL elsewhere before `npx cap sync ios`
 * for other targets (the simulator can resolve https://donote.test
 * through the Mac's resolver; a physical device cannot).
 */
const appUrl = process.env.DONOTE_MOBILE_URL || 'https://donote.on-forge.com';

const config: CapacitorConfig = {
    appId: 'io.air.donote',
    appName: 'Donote',
    webDir: 'mobile/www',
    server: {
        url: appUrl,
    },
    ios: {
        // The web app owns safe-area spacing via CSS env(safe-area-inset-*)
        // with viewport-fit=cover. Letting the native web view ALSO inset
        // ('always') double-pads the top/bottom, so keep it out of the way.
        contentInset: 'never',
    },
    plugins: {
        Keyboard: {
            // Keep the web view full-height when the keyboard opens (rather
            // than the default 'native' resize) so visualViewport reports the
            // keyboard inset and our editor toolbar can sit just above it.
            resize: KeyboardResize.None,
        },
    },
};

export default config;
