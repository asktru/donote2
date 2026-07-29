# Calendar Speed, Search, and Meet Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the calendar paint instantly from a persisted cache, add `/` event search ranked by distance from now, and add a global macOS ⌘⇧J that opens the current or imminent event's Meet link.

**Architecture:** One new piece of state — a ±4-week "event horizon" persisted to IndexedDB — backs all three features. The fetch primitives move out of `stores/calendar.ts` into `lib/calendarFetch.ts` so the horizon store and the calendar store can both use them without a circular import. All decision logic (range slicing, search ranking, Meet-target selection) lives in pure, unit-tested modules under `resources/js/core/`. The Electron main process only registers the key and forwards a message; the renderer decides what to open.

**Tech Stack:** Vue 3 + TypeScript, Inertia v3, Dexie 4 (IndexedDB), Vitest, date-fns, Electron 3x shell, Tailwind v4.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-29-calendar-speed-search-meet-design.md`. Read it before starting.
- **Horizon size:** exactly ±4 weeks around now. Constant name: `HORIZON_WEEKS = 4`.
- **Meet lookahead:** exactly 1 hour. Constant name: `MEET_LOOKAHEAD_MS = 60 * 60 * 1000`.
- **Search fields:** title, attendee names, attendee emails, location. **Never** description.
- **Search order:** ascending `abs(event.start - now)`; a future event beats a past event at equal distance; then title alphabetically.
- **Test scope:** Vitest only picks up `resources/js/**/*.test.ts` (see `vitest.config.ts`). Pure logic must live under `resources/js/core/` to be testable. Run with `npm run test:js`.
- **Code style:** curly braces on every control structure; explicit return types on every exported function; PHPDoc-style `/** */` block comments over inline comments; blank line before `return`. Match the surrounding files.
- **No new dependencies.** No PHP changes. No `composer` or `npm install`.
- **Lint gate:** `npm run lint:check` and `npm run types:check` must pass before each commit.
- **`/` is calendar-only.** Do not add any binding to the Notes page.
- **Do not touch** `resources/js/components/notes/EventsList.vue`. Its duplicate fetching is explicitly out of scope.

---

### Task 1: Range and window helpers

Pure date-range arithmetic the horizon needs. All-day events carry a bare
`YYYY-MM-DD` start and an **exclusive** `YYYY-MM-DD` end. `Date.parse` reads
those as UTC midnight, which is wrong when compared against local-midnight
view boundaries — hence `eventMoment`.

**Files:**
- Create: `resources/js/core/eventWindow.ts`
- Test: `resources/js/core/eventWindow.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface WindowEvent { start: string; end: string }`
  - `interface DateRange { start: Date; end: Date }`
  - `const HORIZON_WEEKS: number` (value `4`)
  - `function eventMoment(value: string): number`
  - `function eventsInRange<T extends WindowEvent>(events: T[], range: DateRange): T[]`
  - `function rangeCovers(outer: DateRange, inner: DateRange): boolean`
  - `function horizonRange(now: Date, weeks?: number): DateRange`

- [ ] **Step 1: Write the failing test**

Create `resources/js/core/eventWindow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
    eventMoment,
    eventsInRange,
    horizonRange,
    rangeCovers,
} from '@/core/eventWindow';

const range = (start: string, end: string) => ({
    start: new Date(start),
    end: new Date(end),
});

describe('eventMoment', () => {
    it('reads a bare date as local midnight, not UTC midnight', () => {
        expect(eventMoment('2026-07-15')).toBe(
            new Date(2026, 6, 15).getTime(),
        );
    });

    it('reads a timed ISO string as the instant it names', () => {
        expect(eventMoment('2026-07-15T11:00:00Z')).toBe(
            Date.parse('2026-07-15T11:00:00Z'),
        );
    });
});

describe('eventsInRange', () => {
    const events = [
        { key: 'before', start: '2026-07-10T10:00:00Z', end: '2026-07-10T11:00:00Z' },
        { key: 'inside', start: '2026-07-15T10:00:00Z', end: '2026-07-15T11:00:00Z' },
        { key: 'after', start: '2026-07-25T10:00:00Z', end: '2026-07-25T11:00:00Z' },
    ];

    it('keeps only events overlapping the range', () => {
        const kept = eventsInRange(events, range('2026-07-14', '2026-07-20'));

        expect(kept.map((event) => event.key)).toEqual(['inside']);
    });

    it('keeps an event straddling the range start', () => {
        const straddling = [
            { key: 'long', start: '2026-07-10T10:00:00Z', end: '2026-07-16T11:00:00Z' },
        ];

        expect(
            eventsInRange(straddling, range('2026-07-14', '2026-07-20')),
        ).toHaveLength(1);
    });

    it('treats the range end as exclusive', () => {
        const atEnd = [
            { key: 'edge', start: '2026-07-20T00:00:00Z', end: '2026-07-20T01:00:00Z' },
        ];

        expect(
            eventsInRange(atEnd, {
                start: new Date('2026-07-14T00:00:00Z'),
                end: new Date('2026-07-20T00:00:00Z'),
            }),
        ).toHaveLength(0);
    });

    it('keeps an all-day event whose exclusive end is the range start plus one', () => {
        const allDay = [{ key: 'day', start: '2026-07-15', end: '2026-07-16' }];
        const day = {
            start: new Date(2026, 6, 15),
            end: new Date(2026, 6, 16),
        };

        expect(eventsInRange(allDay, day)).toHaveLength(1);
    });
});

describe('rangeCovers', () => {
    it('is true when the inner range sits fully inside', () => {
        expect(
            rangeCovers(range('2026-07-01', '2026-08-01'), range('2026-07-10', '2026-07-17')),
        ).toBe(true);
    });

    it('is false when the inner range spills past the end', () => {
        expect(
            rangeCovers(range('2026-07-01', '2026-08-01'), range('2026-07-25', '2026-08-05')),
        ).toBe(false);
    });

    it('is true when the ranges are identical', () => {
        const same = range('2026-07-01', '2026-08-01');

        expect(rangeCovers(same, same)).toBe(true);
    });
});

describe('horizonRange', () => {
    it('spans four weeks either side of now', () => {
        const now = new Date('2026-07-15T12:00:00Z');
        const { start, end } = horizonRange(now);
        const fourWeeks = 28 * 24 * 60 * 60 * 1000;

        expect(now.getTime() - start.getTime()).toBe(fourWeeks);
        expect(end.getTime() - now.getTime()).toBe(fourWeeks);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:js -- eventWindow`
Expected: FAIL — `Failed to resolve import "@/core/eventWindow"`.

- [ ] **Step 3: Write the implementation**

Create `resources/js/core/eventWindow.ts`:

```ts
/**
 * Range arithmetic for calendar events, shared by the grid, the cached
 * horizon, and search.
 *
 * Events arrive in two shapes: timed events carry a full ISO instant, all-day
 * events a bare `YYYY-MM-DD` with an *exclusive* end date. `Date.parse` reads
 * a bare date as UTC midnight, which drifts a whole day against the
 * local-midnight boundaries the views use — so bare dates are parsed as local
 * midnight here and everything downstream compares plain epoch numbers.
 */

/** The window the app keeps cached, in weeks either side of now. */
export const HORIZON_WEEKS = 4;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface WindowEvent {
    start: string;
    end: string;
}

export interface DateRange {
    start: Date;
    end: Date;
}

/** Epoch ms for an event boundary, reading bare dates as local midnight. */
export function eventMoment(value: string): number {
    if (DATE_ONLY.test(value)) {
        const [year, month, day] = value.split('-').map(Number);

        return new Date(year, month - 1, day).getTime();
    }

    return Date.parse(value);
}

/** Events overlapping `[range.start, range.end)` — the end is exclusive. */
export function eventsInRange<T extends WindowEvent>(
    events: T[],
    range: DateRange,
): T[] {
    const from = range.start.getTime();
    const to = range.end.getTime();

    return events.filter((event) => {
        const start = eventMoment(event.start);
        const end = eventMoment(event.end);

        return start < to && end > from;
    });
}

/** Whether `inner` sits entirely within `outer`. */
export function rangeCovers(outer: DateRange, inner: DateRange): boolean {
    return (
        outer.start.getTime() <= inner.start.getTime() &&
        outer.end.getTime() >= inner.end.getTime()
    );
}

/** The cached window around `now`. */
export function horizonRange(now: Date, weeks = HORIZON_WEEKS): DateRange {
    return {
        start: new Date(now.getTime() - weeks * WEEK_MS),
        end: new Date(now.getTime() + weeks * WEEK_MS),
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:js -- eventWindow`
Expected: PASS, 9 tests.

- [ ] **Step 5: Lint, typecheck, and commit**

```bash
npm run lint:check && npm run types:check
git add resources/js/core/eventWindow.ts resources/js/core/eventWindow.test.ts
git commit -m "Calendar: range helpers for the cached event horizon"
```

---

### Task 2: Search ranking

**Files:**
- Create: `resources/js/core/eventSearch.ts`
- Test: `resources/js/core/eventSearch.test.ts`

**Interfaces:**
- Consumes: `eventMoment` from `@/core/eventWindow` (Task 1).
- Produces:
  - `interface SearchableAttendee { email: string; name: string | null }`
  - `interface SearchableEvent { title: string; location: string | null; start: string; attendees: SearchableAttendee[] }`
  - `function searchEvents<T extends SearchableEvent>(events: T[], query: string, now: Date, limit?: number): T[]`

- [ ] **Step 1: Write the failing test**

Create `resources/js/core/eventSearch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { searchEvents } from '@/core/eventSearch';

const NOW = new Date('2026-07-15T12:00:00Z');

function event(
    title: string,
    start: string,
    extra: Partial<{
        location: string | null;
        attendees: { email: string; name: string | null }[];
    }> = {},
) {
    return {
        title,
        start,
        location: extra.location ?? null,
        attendees: extra.attendees ?? [],
    };
}

describe('searchEvents', () => {
    it('returns nothing for an empty query', () => {
        expect(
            searchEvents([event('Standup', '2026-07-15T13:00:00Z')], '   ', NOW),
        ).toEqual([]);
    });

    it('matches the title case-insensitively', () => {
        const events = [
            event('Design Review', '2026-07-15T13:00:00Z'),
            event('Standup', '2026-07-15T14:00:00Z'),
        ];

        expect(searchEvents(events, 'design', NOW).map((e) => e.title)).toEqual([
            'Design Review',
        ]);
    });

    it('matches an attendee name', () => {
        const events = [
            event('Weekly', '2026-07-15T13:00:00Z', {
                attendees: [{ email: 'a@x.com', name: 'Anna Petrova' }],
            }),
            event('Other', '2026-07-15T14:00:00Z'),
        ];

        expect(searchEvents(events, 'anna', NOW).map((e) => e.title)).toEqual([
            'Weekly',
        ]);
    });

    it('matches an attendee email', () => {
        const events = [
            event('Weekly', '2026-07-15T13:00:00Z', {
                attendees: [{ email: 'anna@example.com', name: null }],
            }),
        ];

        expect(searchEvents(events, 'example.com', NOW)).toHaveLength(1);
    });

    it('matches the location', () => {
        const events = [
            event('Sync', '2026-07-15T13:00:00Z', { location: 'Room 4' }),
        ];

        expect(searchEvents(events, 'room 4', NOW)).toHaveLength(1);
    });

    it('orders by distance from now, in either direction', () => {
        const events = [
            event('sync far future', '2026-07-25T12:00:00Z'),
            event('sync near past', '2026-07-15T09:00:00Z'),
            event('sync near future', '2026-07-15T14:00:00Z'),
        ];

        expect(searchEvents(events, 'sync', NOW).map((e) => e.title)).toEqual([
            'sync near future',
            'sync near past',
            'sync far future',
        ]);
    });

    it('puts a future event ahead of a past one at the same distance', () => {
        const events = [
            event('sync past', '2026-07-15T11:00:00Z'),
            event('sync future', '2026-07-15T13:00:00Z'),
        ];

        expect(searchEvents(events, 'sync', NOW).map((e) => e.title)).toEqual([
            'sync future',
            'sync past',
        ]);
    });

    it('honours the result limit', () => {
        const events = Array.from({ length: 10 }, (_, index) =>
            event(`sync ${index}`, `2026-07-16T0${index % 10}:00:00Z`),
        );

        expect(searchEvents(events, 'sync', NOW, 3)).toHaveLength(3);
    });

    it('never matches on a field it was not given', () => {
        const events = [
            { ...event('Sync', '2026-07-15T13:00:00Z'), description: 'meet.google.com/abc' },
        ];

        expect(searchEvents(events, 'meet.google.com', NOW)).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:js -- eventSearch`
Expected: FAIL — `Failed to resolve import "@/core/eventSearch"`.

- [ ] **Step 3: Write the implementation**

Create `resources/js/core/eventSearch.ts`:

```ts
/**
 * Finding an event by name, by who is on it, or by where it is.
 *
 * Ranking is by distance from the present moment rather than by match
 * quality: the thing you are looking for is nearly always the meeting either
 * side of right now, not the best string match three weeks out. Descriptions
 * are deliberately not searched — Meet boilerplate and pasted agendas match
 * almost anything and would drown the ranking.
 */

import { eventMoment } from '@/core/eventWindow';

/** How many rows the dialog will render. */
const DEFAULT_LIMIT = 50;

export interface SearchableAttendee {
    email: string;
    name: string | null;
}

export interface SearchableEvent {
    title: string;
    location: string | null;
    start: string;
    attendees: SearchableAttendee[];
}

/** Every string an event can be found by, lowercased. */
function haystack(event: SearchableEvent): string {
    const parts = [event.title, event.location ?? ''];

    for (const attendee of event.attendees) {
        parts.push(attendee.name ?? '', attendee.email);
    }

    return parts.join(' ').toLowerCase();
}

/** Matching events, nearest to `now` first. An empty query matches nothing. */
export function searchEvents<T extends SearchableEvent>(
    events: T[],
    query: string,
    now: Date,
    limit = DEFAULT_LIMIT,
): T[] {
    const needle = query.trim().toLowerCase();

    if (needle === '') {
        return [];
    }

    const at = now.getTime();

    return events
        .filter((event) => haystack(event).includes(needle))
        .sort((a, b) => {
            const aStart = eventMoment(a.start);
            const bStart = eventMoment(b.start);
            const byDistance =
                Math.abs(aStart - at) - Math.abs(bStart - at);

            if (byDistance !== 0) {
                return byDistance;
            }

            // Same distance: the one still to come is the likelier target.
            const aFuture = aStart >= at ? 0 : 1;
            const bFuture = bStart >= at ? 0 : 1;

            return aFuture - bFuture || a.title.localeCompare(b.title);
        })
        .slice(0, limit);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:js -- eventSearch`
Expected: PASS, 9 tests.

- [ ] **Step 5: Lint, typecheck, and commit**

```bash
npm run lint:check && npm run types:check
git add resources/js/core/eventSearch.ts resources/js/core/eventSearch.test.ts
git commit -m "Calendar: rank event search by distance from now"
```

---

### Task 3: Meet target selection

**Files:**
- Create: `resources/js/core/meetTarget.ts`
- Test: `resources/js/core/meetTarget.test.ts`

**Interfaces:**
- Consumes: `eventMoment` from `@/core/eventWindow` (Task 1).
- Produces:
  - `const MEET_LOOKAHEAD_MS: number` (value `3600000`)
  - `interface MeetCandidate { start: string; end: string; allDay: boolean; hangoutLink: string | null }`
  - `function pickMeetEvent<T extends MeetCandidate>(events: T[], now: Date): T | null`

- [ ] **Step 1: Write the failing test**

Create `resources/js/core/meetTarget.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { pickMeetEvent } from '@/core/meetTarget';

const NOW = new Date('2026-07-15T12:00:00Z');

function candidate(
    start: string,
    end: string,
    link: string | null = 'https://meet.google.com/abc',
    allDay = false,
) {
    return { start, end, allDay, hangoutLink: link };
}

describe('pickMeetEvent', () => {
    it('prefers an event in progress', () => {
        const events = [
            candidate('2026-07-15T12:30:00Z', '2026-07-15T13:00:00Z', 'https://meet.google.com/next'),
            candidate('2026-07-15T11:45:00Z', '2026-07-15T12:15:00Z', 'https://meet.google.com/now'),
        ];

        expect(pickMeetEvent(events, NOW)?.hangoutLink).toBe(
            'https://meet.google.com/now',
        );
    });

    it('treats an event starting exactly now as in progress', () => {
        const events = [
            candidate('2026-07-15T12:00:00Z', '2026-07-15T12:30:00Z'),
        ];

        expect(pickMeetEvent(events, NOW)).not.toBeNull();
    });

    it('falls back to the soonest event starting within the hour', () => {
        const events = [
            candidate('2026-07-15T12:50:00Z', '2026-07-15T13:20:00Z', 'https://meet.google.com/later'),
            candidate('2026-07-15T12:10:00Z', '2026-07-15T12:40:00Z', 'https://meet.google.com/soon'),
        ];

        expect(pickMeetEvent(events, NOW)?.hangoutLink).toBe(
            'https://meet.google.com/soon',
        );
    });

    it('ignores an event starting beyond the hour', () => {
        const events = [
            candidate('2026-07-15T13:30:00Z', '2026-07-15T14:00:00Z'),
        ];

        expect(pickMeetEvent(events, NOW)).toBeNull();
    });

    it('skips events with no Meet link', () => {
        const events = [
            candidate('2026-07-15T11:45:00Z', '2026-07-15T12:15:00Z', null),
            candidate('2026-07-15T12:20:00Z', '2026-07-15T12:50:00Z', 'https://meet.google.com/ok'),
        ];

        expect(pickMeetEvent(events, NOW)?.hangoutLink).toBe(
            'https://meet.google.com/ok',
        );
    });

    it('skips an empty-string Meet link', () => {
        const events = [candidate('2026-07-15T12:10:00Z', '2026-07-15T12:40:00Z', '')];

        expect(pickMeetEvent(events, NOW)).toBeNull();
    });

    it('ignores all-day events', () => {
        const events = [candidate('2026-07-15', '2026-07-16', 'https://meet.google.com/allday', true)];

        expect(pickMeetEvent(events, NOW)).toBeNull();
    });

    it('returns null for an empty list', () => {
        expect(pickMeetEvent([], NOW)).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:js -- meetTarget`
Expected: FAIL — `Failed to resolve import "@/core/meetTarget"`.

- [ ] **Step 3: Write the implementation**

Create `resources/js/core/meetTarget.ts`:

```ts
/**
 * Which meeting ⌘⇧J should join.
 *
 * The shortcut fires from anywhere in macOS, often while the app is not even
 * visible, so it has to be predictable: the call you are in, or the one about
 * to start. The one-hour bound is what keeps it from opening tomorrow's
 * standup when today is over.
 */

import { eventMoment } from '@/core/eventWindow';

/** How far ahead a not-yet-started meeting still counts as "now". */
export const MEET_LOOKAHEAD_MS = 60 * 60 * 1000;

export interface MeetCandidate {
    start: string;
    end: string;
    allDay: boolean;
    hangoutLink: string | null;
}

/** Timed events that actually have somewhere to join. */
function joinable<T extends MeetCandidate>(events: T[]): T[] {
    return events.filter(
        (event) =>
            !event.allDay &&
            event.hangoutLink !== null &&
            event.hangoutLink !== '',
    );
}

function byStart<T extends MeetCandidate>(events: T[]): T[] {
    return [...events].sort(
        (a, b) => eventMoment(a.start) - eventMoment(b.start),
    );
}

/**
 * The meeting in progress, else the soonest starting within the hour, else
 * null — the caller says "no upcoming Meet link" rather than guessing.
 */
export function pickMeetEvent<T extends MeetCandidate>(
    events: T[],
    now: Date,
): T | null {
    const at = now.getTime();
    const candidates = byStart(joinable(events));

    const inProgress = candidates.find(
        (event) =>
            eventMoment(event.start) <= at && eventMoment(event.end) > at,
    );

    if (inProgress) {
        return inProgress;
    }

    return (
        candidates.find((event) => {
            const start = eventMoment(event.start);

            return start > at && start - at <= MEET_LOOKAHEAD_MS;
        }) ?? null
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:js -- meetTarget`
Expected: PASS, 8 tests.

- [ ] **Step 5: Lint, typecheck, and commit**

```bash
npm run lint:check && npm run types:check
git add resources/js/core/meetTarget.ts resources/js/core/meetTarget.test.ts
git commit -m "Calendar: pick the meeting a global Meet shortcut should join"
```

---

### Task 4: Extract the fetch primitives

Pure refactor, no behaviour change. `stores/calendar.ts` currently owns the
event types and the Google/Apple fetch. Task 5's horizon store needs both, and
`calendar.ts` will import the horizon store — so the shared parts move down
into a leaf module to keep the import graph acyclic.

**Files:**
- Create: `resources/js/lib/calendarFetch.ts`
- Modify: `resources/js/stores/calendar.ts` (lines 1-8, 11-66, 169-235, 243-326)

**Interfaces:**
- Consumes: nothing new.
- Produces, from `@/lib/calendarFetch`:
  - `type RsvpStatus = 'accepted' | 'declined' | 'tentative' | 'needsAction'`
  - `interface EventAttendee { email; name; response; organizer; self }`
  - `interface CalendarEvent { … }` — moved verbatim from `stores/calendar.ts:22-46`
  - `function fetchEventRange(start: Date, end: Date): Promise<CalendarEvent[]>`
- `stores/calendar.ts` re-exports the three types so its ~15 existing importers keep working unchanged.

- [ ] **Step 1: Create the new module**

Create `resources/js/lib/calendarFetch.ts`. Move — do not retype — these from
`resources/js/stores/calendar.ts`: the `RsvpStatus`, `EventAttendee`,
`CalendarEvent`, and `GoogleEventDto` declarations (lines 11-66), plus the
`mapGoogle` (169-194) and `fetchApple` (196-235) functions. Keep every comment.
Add at the top:

```ts
/**
 * Fetching calendar events from the two sources — the Google proxy and the
 * native Apple bridge — and normalizing them into one shape.
 *
 * This sits below both the calendar store and the cached horizon, which each
 * need to fetch a range. Keeping it a leaf module is what stops those two
 * from importing each other.
 */

import { apiFetch } from '@/lib/api';
import { appleCalendar } from '@/lib/appleCalendar';
```

Then add the shared fetch, replacing the duplicated `Promise.all` blocks:

```ts
/**
 * Every event in `[start, end)` from both sources. Google failures degrade to
 * an empty list rather than rejecting: an Apple-only machine, or a revoked
 * Google token, should still show the device calendar.
 */
export async function fetchEventRange(
    start: Date,
    end: Date,
): Promise<CalendarEvent[]> {
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const [google, apple] = await Promise.all([
        apiFetch<{ events: GoogleEventDto[] }>(
            `/api/google/events?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`,
        )
            .then((res) =>
                res.events
                    .map(mapGoogle)
                    .filter((event): event is CalendarEvent => event !== null),
            )
            .catch(() => [] as CalendarEvent[]),
        fetchApple(startIso, endIso),
    ]);

    // Google first, so dedupe keeps the copy that has a click-through link.
    return [...google, ...apple];
}
```

Mark `mapGoogle`, `fetchApple`, and `GoogleEventDto` as non-exported (they are
only used inside this module now).

- [ ] **Step 2: Rewire the calendar store**

In `resources/js/stores/calendar.ts`:

Delete the moved declarations and functions. Replace the `apiFetch` and
`appleCalendar` imports with:

```ts
import { fetchEventRange } from '@/lib/calendarFetch';
import type { CalendarEvent } from '@/lib/calendarFetch';

export type {
    CalendarEvent,
    EventAttendee,
    RsvpStatus,
} from '@/lib/calendarFetch';
```

Rewrite the body of `nextEventAfter` (line 243) to use it:

```ts
export async function nextEventAfter(
    from: Date,
    days = 60,
): Promise<CalendarEvent | null> {
    try {
        const found = await fetchEventRange(
            from,
            new Date(from.getTime() + days * 24 * 60 * 60 * 1000),
        );

        // The very same pipeline the grid runs, so the event this returns is
        // the copy the grid will show — matching it up afterwards depends on
        // both sides picking the same one.
        const visible = visibleEvents(found, currentVisibility()).filter(
            (event) => !event.hidden,
        );

        return (
            visible
                .filter(
                    (event) => new Date(event.start).getTime() > from.getTime(),
                )
                .sort(
                    (a, b) =>
                        new Date(a.start).getTime() -
                            new Date(b.start).getTime() ||
                        a.title.localeCompare(b.title),
                )[0] ?? null
        );
    } catch {
        return null;
    }
}
```

Rewrite the body of `fetchEvents` (line 292) the same way, keeping the
`requestSeq` guard exactly as it is:

```ts
export async function fetchEvents(): Promise<void> {
    const { start, end } = visibleRange.value;
    const seq = ++requestSeq;

    eventsLoading.value = true;
    eventsFailed.value = false;

    try {
        const found = await fetchEventRange(start, end);

        if (seq !== requestSeq) {
            return;
        }

        events.value = found;
    } catch {
        if (seq === requestSeq) {
            eventsFailed.value = true;
            events.value = [];
        }
    } finally {
        if (seq === requestSeq) {
            eventsLoading.value = false;
        }
    }
}
```

(The `events.value = []` on failure stays for now; Task 6 changes it.)

- [ ] **Step 3: Verify nothing broke**

Run: `npm run test:js && npm run types:check && npm run lint:check`
Expected: all existing tests PASS, no type errors. `types:check` is the real
gate here — it proves every importer of `CalendarEvent` still resolves.

- [ ] **Step 4: Commit**

```bash
git add resources/js/lib/calendarFetch.ts resources/js/stores/calendar.ts
git commit -m "Calendar: extract event fetching into a leaf module"
```

---

### Task 5: The persisted event horizon

**Files:**
- Modify: `resources/js/stores/db.ts` (add table + version 5)
- Create: `resources/js/stores/eventHorizon.ts`
- Create: `resources/js/composables/useEventHorizon.ts`

**Interfaces:**
- Consumes: `fetchEventRange`, `CalendarEvent` from `@/lib/calendarFetch` (Task 4); `horizonRange`, `rangeCovers`, `eventsInRange`, `DateRange` from `@/core/eventWindow` (Task 1).
- Produces:
  - From `@/stores/db`: `CachedCalendarEvent` (an alias of `CalendarEvent`) on `WorkspaceDb['calendarEvents']`.
  - From `@/stores/eventHorizon`:
    - `const horizonEvents: Ref<CalendarEvent[]>`
    - `const horizonFetchedAt: Ref<number | null>`
    - `function initEventHorizon(teamSlug: string, userId: number): void`
    - `function loadCachedHorizon(): Promise<void>`
    - `function refreshHorizon(force?: boolean): Promise<void>`
    - `function seedFromHorizon(range: DateRange): CalendarEvent[] | null`
  - From `@/composables/useEventHorizon`: `function useEventHorizon(teamSlug: string, userId: number): { hydrated: Promise<void> }`

- [ ] **Step 1: Add the Dexie table**

In `resources/js/stores/db.ts`, add near the top:

```ts
import type { CalendarEvent } from '@/lib/calendarFetch';

/**
 * A calendar event kept for offline paint. Stored exactly as fetched — the
 * cache is a snapshot of a window, replaced wholesale on refresh, never
 * merged, so an event deleted upstream disappears here too.
 */
export type CachedCalendarEvent = CalendarEvent;
```

Add `calendarEvents` to the `WorkspaceDb` type:

```ts
export type WorkspaceDb = Dexie & {
    notes: EntityTable<LocalNote, 'id'>;
    meta: EntityTable<MetaEntry, 'key'>;
    reminders: EntityTable<ReminderState, 'key'>;
    memos: EntityTable<MemoRecord, 'id'>;
    calendarEvents: EntityTable<CachedCalendarEvent, 'key'>;
};
```

And after the existing `db.version(4)` block, before `return db;`:

```ts
    db.version(5).stores({
        calendarEvents: 'key, start',
    });
```

- [ ] **Step 2: Write the horizon store**

Create `resources/js/stores/eventHorizon.ts`:

```ts
/**
 * The ±4-week window of calendar events the app keeps warm.
 *
 * One cache serves three callers: the grid paints from it before the network
 * answers, event search treats it as its corpus, and the global Meet shortcut
 * reads it without waiting on a fetch. It is persisted so a cold launch — or
 * the desktop shell's twelve-hourly reload — shows a calendar rather than a
 * blank grid.
 *
 * Every IndexedDB call is best-effort. A browser in private mode or over
 * quota simply falls back to the network-only behaviour that came before.
 */

import { ref } from 'vue';

import { eventsInRange, horizonRange, rangeCovers } from '@/core/eventWindow';
import type { DateRange } from '@/core/eventWindow';
import { fetchEventRange } from '@/lib/calendarFetch';
import type { CalendarEvent } from '@/lib/calendarFetch';
import { openWorkspaceDb } from '@/stores/db';
import type { WorkspaceDb } from '@/stores/db';

/** Don't re-hit Google for a window fetched this recently. */
const REFRESH_THROTTLE_MS = 60 * 1000;

/** Where the window's anchor time is kept between sessions. */
const ANCHOR_KEY = 'calendar:horizon-anchor';

export const horizonEvents = ref<CalendarEvent[]>([]);
export const horizonFetchedAt = ref<number | null>(null);

/**
 * The `now` the loaded window was built around — persisted, because a cache
 * written five days ago covers `then ± 4 weeks`, not `now ± 4 weeks`. Anchor
 * it to the present on load and the store would claim coverage of a stretch
 * of next month it never fetched.
 */
const anchoredAt = ref<Date | null>(null);

let db: WorkspaceDb | null = null;
let refreshing: Promise<void> | null = null;

/**
 * Point the horizon at a workspace. Called by the pages, which know the team
 * and user from their Inertia props — the workspace store may not have
 * booted yet when the calendar mounts.
 */
export function initEventHorizon(teamSlug: string, userId: number): void {
    db = openWorkspaceDb(teamSlug, userId);
}

/** Read the persisted window into memory. Silent on failure. */
export async function loadCachedHorizon(): Promise<void> {
    if (db === null) {
        return;
    }

    // A live refresh that landed first always wins.
    if (anchoredAt.value !== null) {
        return;
    }

    try {
        const [cached, anchor] = await Promise.all([
            db.calendarEvents.toArray(),
            db.meta.get(ANCHOR_KEY),
        ]);

        if (
            anchoredAt.value === null &&
            cached.length > 0 &&
            typeof anchor?.value === 'number'
        ) {
            horizonEvents.value = cached;
            anchoredAt.value = new Date(anchor.value);
        }
    } catch {
        // No cache available — the network path still works.
    }
}

/**
 * Fetch the window afresh and persist it. Concurrent calls share one
 * in-flight request; repeat calls inside the throttle are dropped unless
 * forced.
 */
export async function refreshHorizon(force = false): Promise<void> {
    if (db === null) {
        return;
    }

    if (refreshing !== null) {
        return refreshing;
    }

    const fetchedAt = horizonFetchedAt.value;

    if (
        !force &&
        fetchedAt !== null &&
        Date.now() - fetchedAt < REFRESH_THROTTLE_MS
    ) {
        return;
    }

    refreshing = (async () => {
        const now = new Date();
        const range = horizonRange(now);

        try {
            const found = await fetchEventRange(range.start, range.end);

            horizonEvents.value = found;
            horizonFetchedAt.value = Date.now();
            anchoredAt.value = now;

            try {
                await db!.transaction(
                    'rw',
                    db!.calendarEvents,
                    db!.meta,
                    async () => {
                        await db!.calendarEvents.clear();
                        await db!.calendarEvents.bulkPut(found);
                        await db!.meta.put({
                            key: ANCHOR_KEY,
                            value: now.getTime(),
                        });
                    },
                );
            } catch {
                // Persisting is a nicety; the in-memory window still works.
            }
        } catch {
            // Keep whatever is cached rather than emptying the window.
        } finally {
            refreshing = null;
        }
    })();

    return refreshing;
}

/**
 * The cached events for a view's range, or null when the window does not
 * fully cover it. Partial coverage deliberately returns null: half a month
 * rendered from cache reads as a month with events missing, which is worse
 * than a brief wait.
 */
export function seedFromHorizon(range: DateRange): CalendarEvent[] | null {
    const anchor = anchoredAt.value;

    if (anchor === null || horizonEvents.value.length === 0) {
        return null;
    }

    if (!rangeCovers(horizonRange(anchor), range)) {
        return null;
    }

    return eventsInRange(horizonEvents.value, range);
}
```

- [ ] **Step 3: Write the lifecycle composable**

Create `resources/js/composables/useEventHorizon.ts`:

```ts
import { onBeforeUnmount, onMounted } from 'vue';

import {
    initEventHorizon,
    loadCachedHorizon,
    refreshHorizon,
} from '@/stores/eventHorizon';

/**
 * Keeps the shared event window warm for as long as the page lives: hydrate
 * from IndexedDB, refresh in the background, and refresh again whenever the
 * user comes back to the window or the machine regains connectivity.
 *
 * Hydration starts during setup — not on mount — and the returned promise
 * lets a caller that needs the cache before it does anything else (the
 * calendar grid) await it.
 */
export function useEventHorizon(
    teamSlug: string,
    userId: number,
): { hydrated: Promise<void> } {
    initEventHorizon(teamSlug, userId);

    const hydrated = loadCachedHorizon();

    function revalidate(): void {
        void refreshHorizon();
    }

    onMounted(() => {
        void hydrated.then(() => refreshHorizon(true));
        window.addEventListener('focus', revalidate);
        window.addEventListener('online', revalidate);
    });

    onBeforeUnmount(() => {
        window.removeEventListener('focus', revalidate);
        window.removeEventListener('online', revalidate);
    });

    return { hydrated };
}
```

- [ ] **Step 4: Verify**

Run: `npm run test:js && npm run types:check && npm run lint:check`
Expected: existing tests PASS, no type errors. Nothing calls the new code yet.

- [ ] **Step 5: Commit**

```bash
git add resources/js/stores/db.ts resources/js/stores/eventHorizon.ts resources/js/composables/useEventHorizon.ts
git commit -m "Calendar: persist a four-week event horizon to IndexedDB"
```

---

### Task 6: Paint the calendar from cache

**Files:**
- Modify: `resources/js/stores/calendar.ts` (`fetchEvents` failure branch, `watchCalendarRange`)
- Modify: `resources/js/pages/calendar/Index.vue` (setup + `onMounted`, Notes link)
- Modify: `resources/js/pages/notes/Index.vue` (setup)
- Modify: `resources/js/components/notes/NotesSidebar.vue` (Calendar link, ~line 272)

**Interfaces:**
- Consumes: `seedFromHorizon` from `@/stores/eventHorizon`, `useEventHorizon` from `@/composables/useEventHorizon` (Task 5).
- Produces: nothing new.

- [ ] **Step 1: Stop blanking the grid on a failed refresh**

In `resources/js/stores/calendar.ts`, change the `catch` inside `fetchEvents`:

```ts
    } catch {
        if (seq === requestSeq) {
            // Keep whatever is on screen — cached events with a warning beat
            // an empty grid, and the banner already says the refresh failed.
            eventsFailed.value = true;
        }
    } finally {
```

- [ ] **Step 2: Seed the visible range before the network answers**

In the same file, add to the imports:

```ts
import { seedFromHorizon } from '@/stores/eventHorizon';
```

and rewrite `watchCalendarRange` (line 753):

```ts
/** Refetch whenever the visible range changes (view switch or navigation). */
export function watchCalendarRange(): void {
    watch(
        () => [visibleRange.value.start.getTime(), visibleRange.value.end.getTime()],
        () => {
            // Paint from the cached window first when it covers this range,
            // so a view switch is instant and the fetch only corrects it.
            const cached = seedFromHorizon(visibleRange.value);

            if (cached !== null) {
                events.value = cached;
            }

            void fetchEvents();
            void fetchOverlays();
        },
        { immediate: true },
    );
    watch(meetWith, () => void fetchOverlays());
}
```

- [ ] **Step 3: Hydrate before the calendar page starts watching**

In `resources/js/pages/calendar/Index.vue`, add the import:

```ts
import { useEventHorizon } from '@/composables/useEventHorizon';
```

Add near the top of `<script setup>`, after `props` is defined:

```ts
const { hydrated } = useEventHorizon(
    props.workspace.teamSlug,
    props.workspace.userId,
);
```

Then in `onMounted` (line 558), await it before `watchCalendarRange()`:

```ts
onMounted(async () => {
    setTeamMembers(props.members);
    initCalendarPrefs(props.workspace.teamSlug);

    // The cached window has to be in memory before the range watcher fires,
    // or its first run has nothing to seed from and the grid starts blank.
    await hydrated;
    watchCalendarRange();
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', onResize);
```

Leave the rest of `onMounted` untouched.

- [ ] **Step 4: Keep the horizon warm on the Notes page**

In `resources/js/pages/notes/Index.vue`, add the import and, after `props`,
the call — Notes needs the window for the Meet shortcut in Task 8:

```ts
import { useEventHorizon } from '@/composables/useEventHorizon';

useEventHorizon(props.workspace.teamSlug, props.workspace.userId);
```

The Notes page already declares `props.workspace` with `teamSlug` and `userId`
(see its `defineProps` around line 89), so no prop changes are needed.

- [ ] **Step 5: Prefetch the two section links**

In `resources/js/components/notes/NotesSidebar.vue`, the Calendar link:

```vue
            <Link
                v-if="calendarHref"
                :href="calendarHref"
                :prefetch="['mount', 'hover']"
                :cache-for="['30s', '5m']"
                class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-foreground/80 hover:bg-muted/70"
            >
```

In `resources/js/pages/calendar/Index.vue`, the Notes link at line 607 gets
the same two props added to whatever attributes it already has.

`['mount', 'hover']` is deliberate: both links are always on screen and always
lead to the other half of the app, so paying one cheap GET on mount is worth
it. `['30s', '5m']` serves stale instantly and revalidates behind the swap.

- [ ] **Step 6: Verify in the running app**

Run `npm run dev`, then:
1. Open the calendar, let it load, and hard-reload the page. The grid must
   render events immediately rather than blank-then-fill.
2. Switch Notes → Calendar → Notes. Both swaps should be immediate.
3. In devtools, Application → IndexedDB → `donote-<team>-<user>` →
   `calendarEvents` must hold the ±4-week window.
4. Go offline (devtools Network → Offline) and reload. The grid must still
   show cached events with the failure banner, not an empty grid.

- [ ] **Step 7: Commit**

```bash
npm run test:js && npm run types:check && npm run lint:check
git add resources/js/stores/calendar.ts resources/js/pages/calendar/Index.vue resources/js/pages/notes/Index.vue resources/js/components/notes/NotesSidebar.vue
git commit -m "Calendar: paint from cache and prefetch the section links"
```

---

### Task 7: Event search

**Files:**
- Create: `resources/js/components/calendar/EventSearchDialog.vue`
- Modify: `resources/js/pages/calendar/Index.vue` (`onKeydown`, template, FAB block ~line 815)
- Modify: `resources/js/components/notes/ShortcutsDialog.vue` (`calendarGroups`, ~line 115)

**Interfaces:**
- Consumes: `searchEvents` from `@/core/eventSearch` (Task 2); `horizonEvents`, `refreshHorizon` from `@/stores/eventHorizon` (Task 5); `visibleEvents` from `@/core/eventVisibility`; the existing `Dialog`, `DialogContent`, `DialogTitle` from `@/components/ui/dialog`.
- Produces: `EventSearchDialog` with `v-model:open` and an `@pick="(event: CalendarEvent) => void"` emit.

- [ ] **Step 1: Export the visibility rules from the calendar store**

`EventSearchDialog` must apply the same filters the grid does. In
`resources/js/stores/calendar.ts`, change `currentVisibility` (line 729) from
a private function to an exported one — same body, add `export`.

- [ ] **Step 2: Build the dialog**

Create `resources/js/components/calendar/EventSearchDialog.vue`:

```vue
<script setup lang="ts">
import { CalendarDays, Search } from '@lucide/vue';
import { format, formatDistanceToNowStrict, isSameDay } from 'date-fns';
import { computed, ref, watch } from 'vue';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { searchEvents } from '@/core/eventSearch';
import { visibleEvents } from '@/core/eventVisibility';
import { eventMoment } from '@/core/eventWindow';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/lib/calendarFetch';
import { currentVisibility } from '@/stores/calendar';
import { horizonEvents, refreshHorizon } from '@/stores/eventHorizon';

const open = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{ pick: [event: CalendarEvent] }>();

const query = ref('');
const highlighted = ref(0);

/**
 * The corpus is the cached window put through the grid's own visibility
 * pipeline, so switched-off calendars, declined events, and decluttered ones
 * behave exactly as they do on screen.
 */
const corpus = computed<CalendarEvent[]>(() =>
    visibleEvents(horizonEvents.value, currentVisibility()).filter(
        (event) => !event.hidden,
    ),
);

const results = computed<CalendarEvent[]>(() =>
    searchEvents(corpus.value, query.value, new Date()),
);

watch(open, (isOpen) => {
    if (isOpen) {
        query.value = '';
        highlighted.value = 0;
        // The window may be minutes old; correct it behind the typing.
        void refreshHorizon();
    }
});

watch(results, () => {
    highlighted.value = 0;
});

/** "in 2 hours" / "3 days ago", plus the clock time for a same-day hit. */
function when(event: CalendarEvent): string {
    const start = new Date(eventMoment(event.start));
    const relative = formatDistanceToNowStrict(start, { addSuffix: true });

    return isSameDay(start, new Date())
        ? `${format(start, 'HH:mm')} · ${relative}`
        : `${format(start, 'EEE, MMM d')} · ${relative}`;
}

function pick(event: CalendarEvent): void {
    emit('pick', event);
    open.value = false;
}

function onKeydown(event: KeyboardEvent): void {
    const total = results.value.length;

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        highlighted.value = (highlighted.value + 1) % Math.max(total, 1);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        highlighted.value =
            (highlighted.value - 1 + Math.max(total, 1)) % Math.max(total, 1);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        const chosen = results.value[highlighted.value];

        if (chosen) {
            pick(chosen);
        }
    }
}
</script>

<template>
    <Dialog v-model:open="open">
        <DialogContent
            class="top-[20%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
        >
            <DialogTitle class="sr-only">Search events</DialogTitle>

            <div class="flex items-center gap-2 border-b border-border/60 px-3">
                <Search class="size-4 shrink-0 text-muted-foreground" />
                <input
                    v-model="query"
                    class="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    placeholder="Search events by title, person, or place…"
                    autofocus
                    @keydown="onKeydown"
                />
            </div>

            <div class="max-h-80 overflow-y-auto p-1.5">
                <button
                    v-for="(event, index) in results"
                    :key="event.key"
                    type="button"
                    :class="
                        cn(
                            'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left',
                            index === highlighted
                                ? 'bg-muted'
                                : 'hover:bg-muted/60',
                        )
                    "
                    @mouseenter="highlighted = index"
                    @click="pick(event)"
                >
                    <span
                        class="mt-1.5 size-2 shrink-0 rounded-full"
                        :style="{
                            backgroundColor:
                                event.eventColor ??
                                event.color ??
                                'var(--muted-foreground)',
                        }"
                    />
                    <span class="min-w-0">
                        <span class="block truncate text-sm font-medium">{{
                            event.title
                        }}</span>
                        <span
                            class="block truncate text-xs text-muted-foreground"
                        >
                            {{ when(event) }}
                            <template v-if="event.location">
                                · {{ event.location }}
                            </template>
                        </span>
                    </span>
                </button>

                <p
                    v-if="results.length === 0"
                    class="flex items-center justify-center gap-1.5 px-2.5 py-6 text-center text-sm text-muted-foreground"
                >
                    <CalendarDays class="size-3.5" />
                    {{
                        query.trim() === ''
                            ? 'Type to search four weeks either side of today.'
                            : 'No events match.'
                    }}
                </p>
            </div>
        </DialogContent>
    </Dialog>
</template>
```

- [ ] **Step 3: Bind `/` and wire the dialog**

In `resources/js/pages/calendar/Index.vue`, add the import and state:

```ts
import EventSearchDialog from '@/components/calendar/EventSearchDialog.vue';

const eventSearchOpen = ref(false);
```

Add the key handler inside `onKeydown`, immediately **after** the
`if (typing || event.metaKey || event.ctrlKey || event.altKey) { return; }`
guard (around line 455) and before the bare-letter section — `⌘/` is already
the cheatsheet and is caught earlier, so this only sees a bare slash:

```ts
    // / — find an event anywhere in the cached window.
    if (event.key === '/') {
        event.preventDefault();
        eventSearchOpen.value = true;

        return;
    }
```

Add a handler that jumps to a picked event. `openEventDetail` and `anchor`
are already imported by this page:

```ts
/**
 * Land on a searched event: move the anchor to its day, keep whichever view
 * is current, and open the detail panel on it.
 */
function openSearchResult(event: CalendarEvent): void {
    anchor.value = startOfDay(new Date(eventMoment(event.start)));
    openEventDetail(event);
}
```

Import `eventMoment` from `@/core/eventWindow` and confirm `startOfDay` and
`anchor` are imported; add them if not. `CalendarEvent` is already imported as
a type by this page.

Add the component to the template beside the other dialogs, next to
`<ShortcutsDialog page="calendar" />`:

```vue
        <EventSearchDialog
            v-model:open="eventSearchOpen"
            @pick="openSearchResult"
        />
```

- [ ] **Step 4: Add the mobile search button**

In `resources/js/pages/calendar/Index.vue`, the FAB column at line ~815 is
currently gated on `googleConnected`. Search must work on an Apple-only
machine, so move that gate onto the create button only. Change the container:

```vue
        <div
            v-if="!meetPickerOpen && !nativeTabsActive"
            class="fixed right-5 bottom-[calc(1.25rem+var(--bottom-chrome))] z-40 flex flex-col items-end gap-2"
        >
            <template v-if="googleConnected && fabOpen">
```

Then, immediately before the existing create button, add the search button —
same styling as the notes one in `QuickCaptureFab.vue`:

```vue
            <!-- Search: quick reach on phones, where there's no keyboard. -->
            <button
                v-if="!fabOpen"
                type="button"
                class="flex size-11 items-center justify-center rounded-full border border-border/60 bg-background text-foreground shadow-lg transition-transform hover:scale-105 md:hidden"
                aria-label="Search events"
                @click="eventSearchOpen = true"
            >
                <Search class="size-5" />
            </button>
```

Add `v-if="googleConnected"` to the existing create button, and add `Search`
to the `@lucide/vue` import list on this page.

- [ ] **Step 5: Document the shortcut**

In `resources/js/components/notes/ShortcutsDialog.vue`, add to the
`calendarGroups` Navigation list (after the `['T', 'Today']` entry):

```ts
            ['/', 'Search events'],
```

- [ ] **Step 6: Verify in the running app**

With `npm run dev`:
1. Press `/` on the calendar — the dialog opens. Type part of a meeting title;
   the nearest-in-time match is first.
2. Search for a colleague's first name; meetings they are on appear.
3. `↓` then `Enter` — the calendar jumps to that event's day, the view kind is
   unchanged, and the detail panel opens on it.
4. Click into the event editor, type `/` — the dialog must **not** open.
5. Press `⌘/` — the cheatsheet opens (not search), and lists `/`.
6. Narrow the window below 768px — the search FAB appears above the create FAB
   and opens the dialog.

- [ ] **Step 7: Commit**

```bash
npm run test:js && npm run types:check && npm run lint:check
git add resources/js/components/calendar/EventSearchDialog.vue resources/js/pages/calendar/Index.vue resources/js/stores/calendar.ts resources/js/components/notes/ShortcutsDialog.vue
git commit -m "Calendar: find an event with / or the mobile search button"
```

---

### Task 8: Global ⌘⇧J

**Files:**
- Modify: `electron/main.js` (requires, new registration block, `will-quit`)
- Modify: `electron/preload.js`
- Modify: `resources/js/lib/desktop.ts` (`DonoteDesktop` type)
- Create: `resources/js/composables/useMeetShortcut.ts`
- Modify: `resources/js/pages/calendar/Index.vue`, `resources/js/pages/notes/Index.vue` (one call each)

**Interfaces:**
- Consumes: `pickMeetEvent` from `@/core/meetTarget` (Task 3); `horizonEvents`, `refreshHorizon` from `@/stores/eventHorizon` (Task 5); `donoteDesktop` from `@/lib/desktop`.
- Produces: `function useMeetShortcut(): void`; `donoteDesktop.onOpenMeet(cb: () => void): void`.

- [ ] **Step 1: Expose the message in the preload bridge**

In `electron/preload.js`, add above the `contextBridge` call:

```js
/**
 * ⌘⇧J from the main process. A single callback slot rather than an
 * accumulating listener: the app is a single-page shell, so navigating
 * between Notes and Calendar re-registers, and an `ipcRenderer.on` per page
 * would open the meeting once per page ever visited.
 */
let openMeetCallback = null;

ipcRenderer.on('donote:open-meet', () => {
    if (openMeetCallback) {
        openMeetCallback();
    }
});
```

and inside the exposed object, after `openWindow`:

```js
    onOpenMeet: (callback) => {
        openMeetCallback = callback;
    },
```

- [ ] **Step 2: Register the global shortcut**

In `electron/main.js`, add `globalShortcut` and `Notification` to the
`require('electron')` destructure at line 3.

Add after the `EVENTKIT_HELPER` block (before the deep-link section):

```js
/**
 * ⌘⇧J joins the meeting you are in or about to be in, from anywhere in
 * macOS. The main process only forwards the press: the renderer holds the
 * cached calendar window and picks the target, which keeps that decision in
 * tested app code rather than here.
 */
const MEET_SHORTCUT = 'CommandOrControl+Shift+J';

function notify(body) {
    if (Notification.isSupported()) {
        new Notification({ title: 'Donote', body }).show();
    }
}

function registerMeetShortcut() {
    const registered = globalShortcut.register(MEET_SHORTCUT, () => {
        const win = primaryWindow();

        if (!win) {
            notify('Donote has no open window.');

            return;
        }

        win.webContents.send('donote:open-meet');
    });

    if (!registered) {
        notify('Another app owns ⌘⇧J, so Donote could not register it.');
    }
}
```

In `app.whenReady().then(...)`, call it right after `buildMenu()`:

```js
        buildMenu();
        registerMeetShortcut();
```

And add alongside the other `app.on` handlers:

```js
    app.on('will-quit', () => {
        globalShortcut.unregisterAll();
    });
```

- [ ] **Step 3: Type the bridge**

In `resources/js/lib/desktop.ts`, add to the `DonoteDesktop` interface, after
`openWindow`:

```ts
    /** Register the handler for the shell's global ⌘⇧J. Last call wins. */
    onOpenMeet?: (callback: () => void) => void;
```

- [ ] **Step 4: Write the renderer handler**

Create `resources/js/composables/useMeetShortcut.ts`:

```ts
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
```

- [ ] **Step 5: Call it from both pages**

In `resources/js/pages/calendar/Index.vue` and
`resources/js/pages/notes/Index.vue`, next to the existing `useEventHorizon`
call from Task 6:

```ts
import { useMeetShortcut } from '@/composables/useMeetShortcut';

useMeetShortcut();
```

- [ ] **Step 6: Verify in the desktop shell**

```bash
npm run dev            # in one terminal
npm run desktop        # in another; DONOTE_URL points at the Herd site
```

1. With a Meet event running or starting within the hour, focus another app
   and press ⌘⇧J. The Meet link opens in the system browser.
2. Do the same from the Notes page. Same result — the shortcut must not be
   calendar-only.
3. With no such event, press ⌘⇧J. A native macOS notification appears; nothing
   opens.
4. Press ⌘J on the calendar page. The Meet-with panel still toggles — ⌘⇧J must
   not have shadowed it.
5. Navigate Notes → Calendar → Notes, then press ⌘⇧J. The link opens **once**,
   not once per page visited. This is what the single callback slot in
   Step 1 is for.
6. Quit the app and confirm ⌘⇧J no longer does anything.

- [ ] **Step 7: Commit**

```bash
npm run test:js && npm run types:check && npm run lint:check
git add electron/main.js electron/preload.js resources/js/lib/desktop.ts resources/js/composables/useMeetShortcut.ts resources/js/pages/calendar/Index.vue resources/js/pages/notes/Index.vue
git commit -m "Desktop: global cmd-shift-J opens the current meeting's Meet link"
```

---

### Task 9: Full-suite check

**Files:** none.

- [ ] **Step 1: Run everything**

```bash
npm run test:js
npm run types:check
npm run lint:check
php artisan test --compact
```

Expected: all PASS. There are no PHP changes, so the Pest suite is a
regression check only — if it fails, the failure predates this work; confirm
against `git stash` before investigating.

- [ ] **Step 2: Build the production bundle**

Run: `npm run build`
Expected: succeeds. This catches anything the dev server tolerated.

- [ ] **Step 3: Commit if anything needed fixing**

```bash
git add -A
git commit -m "Calendar: fix up after the full suite"
```
