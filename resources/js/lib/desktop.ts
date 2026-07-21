/**
 * Bridge to the Electron shell's extra capabilities, exposed by its
 * preload script. Null when running in a plain browser or on iOS.
 */

export type AppleCalendarStatus =
    | 'notDetermined'
    | 'authorized'
    | 'denied'
    | 'restricted'
    | 'writeOnly'
    | 'unknown';

export interface AppleCalendar {
    id: string;
    title: string;
    color: string | null;
    source: string;
}

export interface AppleEvent {
    id: string;
    seriesId: string;
    calendarId: string;
    calendarTitle: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    location: string | null;
    isRecurring: boolean;
}

interface DonoteDesktop {
    appleCalendar: {
        status: () => Promise<{ status: AppleCalendarStatus }>;
        requestAccess: () => Promise<{ granted: boolean }>;
        calendars: () => Promise<AppleCalendar[]>;
        events: (fromIso: string, toIso: string) => Promise<AppleEvent[]>;
    };
    /** Open an app-relative path in a new shell window (Cmd-click). */
    openWindow?: (path: string) => Promise<void>;
}

export const donoteDesktop: DonoteDesktop | null =
    typeof window !== 'undefined'
        ? ((window as unknown as { donoteDesktop?: DonoteDesktop })
              .donoteDesktop ?? null)
        : null;
