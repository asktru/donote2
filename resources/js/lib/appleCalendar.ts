/**
 * The device-calendar (EventKit) capability, normalized across the two
 * native shells that provide it: the Electron preload bridge on macOS and a
 * custom Capacitor plugin on iOS. Null in a plain browser, where no device
 * calendar is reachable.
 *
 * Both shells speak the same four operations and return the same shapes
 * (see `AppleEvent`/`AppleCalendar`), so `EventsList.vue` consumes this
 * single seam instead of branching per platform.
 */

import { registerPlugin } from '@capacitor/core';

import { donoteDesktop } from '@/lib/desktop';
import type {
    AppleCalendar,
    AppleCalendarStatus,
    AppleEvent,
} from '@/lib/desktop';
import { isNativeIos } from '@/lib/platform';

export type { AppleCalendar, AppleCalendarStatus, AppleEvent };

export interface AppleCalendarBridge {
    status: () => Promise<{ status: AppleCalendarStatus }>;
    requestAccess: () => Promise<{ granted: boolean }>;
    calendars: () => Promise<AppleCalendar[]>;
    events: (fromIso: string, toIso: string) => Promise<AppleEvent[]>;
}

/**
 * Shape of the native iOS Capacitor plugin. Capacitor marshals plain objects
 * both ways, so collection results are wrapped (`{ calendars }`/`{ events }`)
 * rather than returned as bare arrays.
 */
export interface NativeAppleCalendarPlugin {
    status: () => Promise<{ status: AppleCalendarStatus }>;
    requestAccess: () => Promise<{ granted: boolean }>;
    calendars: () => Promise<{ calendars: AppleCalendar[] }>;
    events: (options: {
        from: string;
        to: string;
    }) => Promise<{ events: AppleEvent[] }>;
}

/** Adapt the native iOS plugin to the shared bridge shape (unwrap collections). */
export function wrapNativePlugin(
    plugin: NativeAppleCalendarPlugin,
): AppleCalendarBridge {
    return {
        status: () => plugin.status(),
        requestAccess: () => plugin.requestAccess(),
        calendars: async () => (await plugin.calendars()).calendars,
        events: async (fromIso, toIso) =>
            (await plugin.events({ from: fromIso, to: toIso })).events,
    };
}

function resolveBridge(): AppleCalendarBridge | null {
    if (donoteDesktop !== null) {
        return donoteDesktop.appleCalendar;
    }

    if (isNativeIos()) {
        return wrapNativePlugin(
            registerPlugin<NativeAppleCalendarPlugin>('AppleCalendar'),
        );
    }

    return null;
}

export const appleCalendar: AppleCalendarBridge | null = resolveBridge();
