import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The iOS shell wraps the Donote web app. In development it points at the
 * Herd site; for production builds set DONOTE_MOBILE_URL to the deployed
 * HTTPS URL before running `npx cap sync ios`.
 *
 * The simulator resolves *.test through the Mac's resolver; a physical
 * device cannot — use `herd share` or a real deployment for on-device runs.
 */
const appUrl = process.env.DONOTE_MOBILE_URL || 'https://donote.test';

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
