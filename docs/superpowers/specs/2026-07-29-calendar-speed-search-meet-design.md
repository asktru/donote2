# Calendar: cached horizon, event search, and a global Meet shortcut

Three related changes to the calendar, all served by one new piece of state:
a persisted ±4-week window of events.

1. Switching from Notes to Calendar paints instantly from cache and
   revalidates in the background.
2. `/` on desktop and a floating button on mobile open an event search
   ranked by distance from now.
3. ⌘⇧J anywhere on macOS opens the Meet link of the current or imminent
   event.

## Background

`stores/calendar.ts` keeps events in module-level refs, so an in-session
revisit to the calendar still shows the previous data. Two things still make
the switch slow:

- The Inertia `<Link>` to `/{team}/calendar` blocks on a server round-trip.
  `CalendarController` queries team members and Google accounts before the
  page swaps.
- Every mount re-runs `fetchEvents()` against the Google proxy. After an app
  restart — or the Electron shell's 12-hour stale reload — the module refs are
  empty and the grid renders blank until Google answers.

There is no client-side persistence of events at all. The server caches the
Google proxy for five minutes (`FetchGoogleEvents`), which does not help a
cold client.

Notes already has the patterns the search feature should follow:
`components/notes/SearchDialog.vue`, the `searchOpen` flag in `stores/ui.ts`,
and a mobile-only search button in `QuickCaptureFab.vue`.

The Electron shell (`electron/main.js`, `electron/preload.js`) already has a
context-isolated IPC bridge and a `setWindowOpenHandler` that routes
`target=_blank` opens to `shell.openExternal`.

## The event horizon

One cache serves all three features: the events between `now - 4 weeks` and
`now + 4 weeks`, persisted to IndexedDB and refreshed in the background.

### Storage

`stores/db.ts` gains a Dexie **version 5** with a `calendarEvents` table,
`key` as primary key and `start` indexed. The workspace database is already
scoped per (team, user), so events need no further scoping.

The moment the window was fetched is persisted alongside it, in the existing
`meta` table. Without it, a cache written five days ago would be treated as
covering `now ± 4 weeks` when it actually covers `then ± 4 weeks`, and the
grid would seed a stretch of next month that was never fetched.

### Store

`stores/eventHorizon.ts` (new):

- `horizonEvents: Ref<CalendarEvent[]>` — the window, in memory.
- `horizonFetchedAt: Ref<number | null>`.
- `loadCachedHorizon()` — IndexedDB into `horizonEvents`.
- `refreshHorizon()` — fetch `now±4w` from the Google proxy and the Apple
  bridge, replace the table wholesale, update the ref. A wholesale replace,
  not a merge: events deleted upstream must disappear.

Every Dexie call is wrapped so a failure (private mode, quota) is swallowed.
The feature degrades to today's network-only behaviour rather than breaking.

### Pure helpers

`core/eventWindow.ts` (new, unit tested):

- `eventsInRange(events, start, end)` — the slice overlapping a range.
- `horizonCovers(horizonRange, viewRange)` — whether a view's range sits
  fully inside the horizon.

### Lifecycle

`composables/useEventHorizon.ts` (new) hydrates from cache, then refreshes,
then re-refreshes on window focus and on regaining connectivity. It is called
from `pages/calendar/Index.vue` and from `pages/notes/Index.vue` — Notes needs
the horizon for the Meet shortcut.

## 1. Instant calendar

`stores/calendar.ts` changes in two places.

**Seeding.** When the visible range changes, set `events.value` from the
horizon *before* the network call, but only when `horizonCovers` reports full
containment. `fetchEvents()` then overwrites it when the response lands.

Partial coverage deliberately does not seed. A month three months out would
render a handful of cached events and look like most of the month was missing,
which is worse than the current brief wait.

**Failure.** `fetchEvents()` currently sets `events.value = []` on error.
It will instead keep whatever is displayed and raise the existing
`eventsFailed` banner, so a failed refresh degrades to stale data rather than
an empty grid.

`events.value` stays strictly scoped to the visible range. The horizon is a
separate ref. Widening `events` would change what `calendarList` enumerates
and what the `↑`/`↓` cursor in `core/eventCursor.ts` walks.

**Prefetch.** Both cross-section links get Inertia prefetch: the Calendar link
in `components/notes/NotesSidebar.vue` and the Notes link in
`pages/calendar/Index.vue`. This removes the blocking round-trip through
`CalendarController`.

`components/notes/EventsList.vue` has its own duplicate Google and Apple
fetch. It is out of scope and stays as it is.

## 2. Event search

### Ranking

`core/eventSearch.ts` (new, unit tested) exports
`searchEvents(events, query, now)`.

Matching is case-insensitive substring over **title, attendee names and
emails, and location**. Descriptions are excluded — Meet boilerplate and
pasted agendas make them noisy enough to swamp the ranking.

Results are ordered by `abs(event.start - now)` ascending, so the closest
event in either direction comes first. A future event wins a tie against a
past one at the same distance. The corpus is the horizon, so the ±4-week
bound is structural rather than a filter.

Events pass through the existing `visibleEvents` pipeline from
`core/eventVisibility.ts` first, so switched-off calendars, declined events,
and decluttered events behave exactly as they do on the grid.

### Dialog

`components/calendar/EventSearchDialog.vue` (new) mirrors
`notes/SearchDialog.vue`: the same `Dialog` shell, `↑`/`↓`/`Enter` handling,
and empty state. Each row shows the title, a relative time ("in 2h",
"3 days ago"), and the calendar's colour dot.

Picking a result moves `anchor` to the event's day, keeps the current
day/week/month view, selects the event, and opens the existing
`EventDetailPanel`.

### Triggers

**Desktop.** `/` in the `onKeydown` handler of `pages/calendar/Index.vue`,
placed after the existing `typing` guard so it never fires inside an input or
the editor.

**Mobile.** A floating button on the calendar page, `md:hidden`, styled to
match the notes search button in `QuickCaptureFab.vue`.

The shortcut is calendar-only. Notes keeps ⌘K for note search and gains no new
binding — `/` is too common a character on an editor-heavy page.

## 3. Global Meet shortcut

Selection logic lives in tested renderer TypeScript. The Electron main process
owns only the key registration, so the untested surface stays trivial.

### Choosing the event

`core/meetTarget.ts` (new, unit tested) exports `pickMeetEvent(events, now)`:

1. An event in progress (started, not yet ended) that has a `hangoutLink`.
2. Otherwise the earliest event starting within the next hour that has a
   `hangoutLink`.
3. Otherwise `null`.

The one-hour bound keeps the shortcut from opening tomorrow's standup.
Events without a `hangoutLink` are skipped rather than opened.

### Wiring

`electron/main.js` registers `CommandOrControl+Shift+J` on ready and calls
`globalShortcut.unregisterAll()` on quit. The handler sends `donote:open-meet`
to the primary window. With no window open it shows a native notification
saying so. A failed registration — another app owns the chord — logs and
notifies once.

`electron/preload.js` exposes `donoteDesktop.onOpenMeet(cb)`.

The renderer listener is wired alongside `useEventHorizon`, so it is live on
both the Notes and Calendar pages. It runs `pickMeetEvent` over
`horizonEvents` and calls `window.open(link, '_blank')`, which the existing
`setWindowOpenHandler` routes to `shell.openExternal`. With no match it raises
a Web `Notification`, which Electron renders natively — the app is in the
background when this fires, so an in-app toast would go unseen.

Because the horizon is already cached and refreshed, the shortcut answers
without a fetch.

`⌘⇧J` does not collide with the app's existing bindings (⌘1-5, ⌘K, ⌘⇧R,
⌘⇧G). A global shortcut also fires while the app is focused, which is the
intent.

## Testing

Vitest covers the three pure modules, matching the configured
`resources/js/**/*.test.ts` scope:

- `core/eventWindow.test.ts` — range slicing and coverage, including
  all-day events whose `end` is exclusive, and boundary events.
- `core/eventSearch.test.ts` — field matching, case-insensitivity,
  distance ordering, future-beats-past ties, and that hidden and declined
  events are excluded.
- `core/meetTarget.test.ts` — in-progress wins; the next within the hour;
  `null` beyond an hour; events without a `hangoutLink` skipped; all-day
  events ignored.

The Dexie layer stays thin enough to carry no logic worth testing, and
`electron/main.js` gains only registration and a message send. There are no
PHP changes.

## Out of scope

- Refactoring `components/notes/EventsList.vue` onto the horizon.
- Warming adjacent periods so `←`/`→` navigation is instant.
- Search on the Notes page.
- A Windows or Linux equivalent of the global shortcut.
