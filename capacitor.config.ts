import type { CapacitorConfig } from '@capacitor/cli';

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
        contentInset: 'always',
    },
};

export default config;
