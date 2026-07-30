# Calendar: muted past search hits, RSVP, and pending invitations

Three changes to the Calendar page, all about invitations you have not dealt
with yet.

1. Past events in the search dialog are muted the way they are on the grid.
2. You can answer an invitation — Going, Maybe, Declined — from the event
   detail panel, choosing between this occurrence and the whole series.
3. Unanswered invitations get a red-dotted button in the header that opens a
   list you can jump from, or answer in place.

## Background

The Google proxy already carries everything the RSVP work needs.
`FetchGoogleEvents::mapEvent()` maps each event's `attendees` (email, name,
`response`, `organizer`, `self`) and derives `response_status` from the
`self: true` attendee, defaulting to `accepted` for events with no attendees —
so a personal time block never reads as unanswered.
`lib/calendarFetch.ts` mirrors that in `CalendarEvent.responseStatus` and
`EventAttendee`, and `EventDetailPanel.vue` already renders the answer as a
read-only pill with `RSVP_LABEL` / `RSVP_CLASS` maps.

`GoogleCalendarClient` has `patchEvent()` (with `sendUpdates=all`) but no way
to read a single event. Events are fetched with `singleEvents=true`, so every
occurrence arrives expanded and carries `recurringEventId` — surfaced as
`CalendarEvent.seriesId`, which the existing "Hide all in series" action
already keys off.

Two private copies of the same "is this event over?" rule exist:
`TimeGridView.vue:68` and `MonthView.vue:51`. Both fade past events to
`opacity-50`. `EventSearchDialog.vue` has no such notion — it ranks by
distance from now via `core/eventSearch.ts`, so past hits sit
indistinguishably among future ones.

`FetchGoogleEvents` caches per user and per date range for five minutes.
Nothing invalidates it, so `createEvent()`'s follow-up `fetchEvents()` can
return a window that predates the write. Today that shows up as a
just-created event missing from the grid; for RSVP it would be worse — the
answer would apply, the red dot would clear, and the next fetch would bring
it back.

## Past events in search results

Lift the shared rule into `core/eventWindow.ts` (which already owns
`eventMoment`):

```ts
/**
 * A timed event is past once it has ended; an all-day event once its
 * (exclusive) end date has arrived.
 */
export function eventHasPassed(
    event: { allDay: boolean; end: string },
    now: Date,
): boolean;
```

`TimeGridView` and `MonthView` drop their private `isPast` and call it.
`EventSearchDialog` adds `opacity-50` to a past row's button — matching the
grid exactly, including for the coloured dot and the text, since the class
sits on the row container.

Ranking does not change. A past meeting an hour ago is still usually what you
are looking for; muting is enough to tell it apart.

## Answering an invitation

### Endpoint

`POST /api/google/events/rsvp` → `CalendarEventController::rsvp()`, in
`routes/web.php` beside the other `api/google/events` routes.

```
calendar_id  required string
event_id     required string
response     required in:accepted,declined,tentative
scope        required in:one,series
```

The account is resolved with the existing `accountForCalendar()`; a calendar
that is not connected aborts 422, as `store`/`update` already do.

### Client method

`GoogleCalendarClient::respondToEvent(string $calendarId, string $eventId,
string $response, bool $wholeSeries): array`.

Google replaces the `attendees` array on patch rather than merging it, so the
answer has to be a read-then-write:

1. `getEvent($calendarId, $eventId)` — a new thin GET wrapper.
2. When `$wholeSeries`, re-read the master via the instance's
   `recurringEventId` and continue with that event. If the instance has no
   `recurringEventId`, fall through to the instance itself: a caller asking
   for the series of a one-off event has answered the only copy there is.
3. Find the attendee with `self === true`. Absent → throw, surfaced by the
   controller as 422 `"You're not an invitee on this event."`
4. `patchEvent()` with the full attendees array, that one entry's
   `responseStatus` replaced.

`patchEvent()` already sends `sendUpdates=all`, so the organizer is notified.

### Store action

`stores/calendar.ts` gains:

```ts
export type RsvpScope = 'one' | 'series';

export async function respondToEvent(
    event: CalendarEvent,
    response: Exclude<RsvpStatus, 'needsAction'>,
    scope: RsvpScope,
): Promise<void>;
```

It applies the answer optimistically to the matching entries in both
`events` and `horizonEvents` — `responseStatus` and the `self` attendee's
`response` — then POSTs. `scope === 'series'` updates every cached event
sharing the `seriesId`; `'one'` updates just the one `key`. On failure it
restores the previous values and toasts the server's message.

Optimism matters here because the whole point of the red dot is that it
clears the moment you answer.

### Detail panel

`EventDetailPanel.vue` renders an RSVP row where the status pill is now, when
all of these hold:

- `source === 'google'` (the Apple bridge is read-only),
- an attendee with `self === true` exists,
- that attendee is not the `organizer` (you do not RSVP to your own meeting).

Otherwise the panel keeps today's read-only pill unchanged.

The row is three buttons — Going, Maybe, Declined — with the current answer
shown as the pressed one, reusing `RSVP_CLASS` for its tint so the panel
keeps one vocabulary for RSVP colour. `needsAction` leaves all three
unpressed, and the "Not responded" pill stays above them.

For an event with `seriesId === null`, a click answers immediately. For a
recurring one, the click swaps the row for a two-button prompt — "This event"
/ "All events" — plus a Cancel; choosing one sends the request with the
matching `scope`. Nothing is sent until the scope is chosen, so a misclick on
a daily standup cannot answer forty occurrences.

## Pending invitations

### Which events count

New pure module `core/pendingInvites.ts`:

```ts
export function pendingInvites<T extends PendingCandidate>(
    events: T[],
    now: Date,
): T[];
```

Keep an event when:

- `responseStatus === 'needsAction'`,
- `!eventHasPassed(event, now)`,
- it has an attendee with `self === true` who is not the `organizer`.

Then collapse: of the events sharing a non-null `seriesId`, keep only the
earliest remaining occurrence. Sort by start ascending.

Calendar visibility is applied by the caller, not here — the store already
owns that pipeline. The store exposes:

```ts
export const pendingInvitations = computed<CalendarEvent[]>(() =>
    pendingInvites(
        visibleEvents(horizonEvents.value, currentVisibility()).filter(
            (event) => !event.hidden,
        ),
        new Date(),
    ),
);
```

Running it through `visibleEvents` — exactly as `EventSearchDialog` does —
means a switched-off calendar or an individually hidden series does not nag.
`hideDeclined` is irrelevant to `needsAction` events but harmless.

The corpus is the cached ±4-week horizon, which is what the app has. An
invitation further out than four weeks appears once the window reaches it.

Because the list is computed from a `new Date()` captured at evaluation time,
it re-derives whenever the horizon refreshes (every mount, and on the
existing throttled revalidation) — close enough for a list of invitations,
with no timer of its own.

### Header button

In `pages/calendar/Index.vue`, between the Meet-with button and the options
dropdown, a `MailQuestionMark` icon button rendered only when
`pendingInvitations.length > 0`. It carries a small red dot in its top-right
corner, and its `aria-label` / `title` state the count ("3 pending
invitations"), so the indicator is not colour-only.

It toggles `PendingInvitesPopover.vue`, anchored under the button (the same
`DropdownMenuContent`-style placement the options menu uses), listing each
invitation as:

- title,
- when — the `EventSearchDialog` phrasing (`format` + relative), plus a
  `Repeat` icon when `seriesId !== null`,
- an inline Going / Maybe / Declined trio, compact, same store action and the
  same This-event / All-events prompt for recurring invites.

Clicking the row body (not a button) jumps to the event. `Index.vue`'s
`openSearchResult` body is extracted as `goToEvent(event: CalendarEvent)` —
anchor to the event's day, open the detail panel — and both the search dialog
and this popover call it. Answering a row drops it from the list on the next
tick, since `pendingInvitations` is derived from `responseStatus`; when the
last one goes, the popover closes and the button disappears with it.

No keyboard shortcut. The header button and the detail panel are the two
surfaces; another bare-letter binding would collide with the existing
Vimcal-style set for no clear gain.

## Cache generation

`FetchGoogleEvents` keys its cache
`google-events:{userId}:{start}:{end}`. Add a generation segment:

```php
$generation = Cache::get('google-events-gen:'.$user->id, 0);
$cacheKey = sprintf('google-events:%d:%d:%s:%s', $user->id, $generation, ...);
```

with a static helper on the action:

```php
public static function invalidate(User $user): void
{
    Cache::increment('google-events-gen:'.$user->id);  // seeded at 0 when absent
}
```

`Cache::increment` on a missing key is driver-dependent, so the helper writes
`1` when `Cache::get` returns null and increments otherwise.

`CalendarEventController`'s `store`, `update`, `destroy`, and the new `rsvp`
all call it after a successful write. Stale windows are simply orphaned and
expire on their own five-minute TTL — no key enumeration needed.

This is the minimum that makes RSVP correct, and it fixes the same latent
staleness in create/update/delete.

## Testing

Pest feature tests for the endpoint, with `Http::fake()` for Google:

- Answering a single event patches the target with the `self` attendee's
  `responseStatus` changed and every other attendee untouched.
- `scope=series` reads the instance, then patches the `recurringEventId`
  master.
- `scope=series` on an event with no `recurringEventId` patches the instance.
- An event with no `self` attendee returns 422 and sends no patch.
- A calendar belonging to no connected account returns 422.
- A successful answer bumps the cache generation, so the next
  `FetchGoogleEvents` call re-hits Google.
- Validation rejects an unknown `response` and an unknown `scope`.

Vitest unit tests:

- `eventHasPassed`: timed event before/during/after its end; all-day event on
  its last day versus the day after (exclusive end).
- `pendingInvites`: keeps `needsAction` future invites; drops past, drops
  `accepted`/`declined`/`tentative`, drops events where the self attendee is
  the organizer, drops events with no self attendee; collapses a series to
  its earliest remaining occurrence while leaving distinct series separate;
  sorts ascending.

Existing `calendarLayout` and `eventSearch` suites must stay green after the
`isPast` extraction.

## Out of scope

- Proposing a new time, or any other invitation reply beyond the three
  statuses.
- Answering invitations for Apple calendar events.
- A notification or badge outside the Calendar page.
- Answering an invitation that has already passed.
