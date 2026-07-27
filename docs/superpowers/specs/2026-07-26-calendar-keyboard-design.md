# Calendar keyboard control & event cursor — design

Date: 2026-07-26

## Problem

The full calendar page has four shortcuts, none of them discoverable: `⌘1/2/3`
for the views, `←`/`→` for the period, `⌘⌃1` back to Notes, and `⌘J` for Meet
with. Everything else — today, creating a timeblock, the view filters, the
secondary timezone — is mouse-only, and there is no cheatsheet, so the only way
to learn any of it is to read the source.

`⌘J` is worse than missing: it is bound but gated behind
`colleagues.length > 0 || meetWith.length > 0`, so in a workspace with no
teammates the key does nothing while the toolbar button beside it works. It
reads as a broken shortcut.

There is also no way to reach an *event* from the keyboard at all. Opening one
means clicking it, and the detail panel that opens is `fixed inset-0` with a
scrim — a true modal that covers the grid it is describing.

## What we're building

1. **Discoverable shortcuts** — `⌘/` opens the cheatsheet on the calendar page,
   and the mechanical actions get bindings: today, view switching by letter,
   period stepping with `j`/`k`, new timeblock, the two view filters, the
   secondary timezone.
2. **A side-by-side detail panel** — at `lg` and up the panel takes width from
   the grid instead of covering it.
3. **An event cursor** — `N`, `↑`/`↓`, `⏎`, `Esc`, and the hide actions, with
   the *selected event* as the only new concept.
4. **Two readability fixes** that came up alongside: weekends tinted, and
   repeating events marked as such.
5. **A searchable timezone picker**, because nobody remembers that Kyiv is
   `Europe/Kiev`.

## The cursor

**The cursor is `selectedEvent`** — the store ref that already drives the
detail panel. There is no second concept and no second highlight: the selected
event is the one whose details are shown, so moving the cursor updates the
panel live.

This is only tolerable once the panel stops being modal, which is why the
layout change ships before the cursor.

**Order** is the visible range's events sorted by start, then title, flattened
across days — so `↓` walks a week in reading order rather than down one column.
Overlay events (a colleague's schedule via Meet with) are not in the order:
they aren't yours to open, hide or edit.

**`N`** selects the first event starting at or after now, falling back to the
first in the range when the view holds no future. It never changes the view or
the anchor: it works within what you're looking at.

There is no in-app editing of an existing event — `EventDraft` only creates —
so `⏎` opens the event where it *can* be edited: its `htmlLink` in Google
Calendar, which is what the detail panel's own link does. An event without a
link (an Apple calendar entry) makes `⏎` a no-op.

**`↑`/`↓`** move to the previous/next event in that order. With nothing
selected they behave like `N` (`↓`) and select the last event in range (`↑`).
They stop at the ends rather than wrapping — wrapping in a week view means
teleporting from Friday evening to Monday morning with no feedback.

## Bindings

Bare letters are ignored while typing, using the guard the page already
applies to `←`/`→` (input, select and textarea targets).

### Navigation

| Keys | Action |
| --- | --- |
| `T` | Today |
| `D` / `W` / `M` | Day / Week / Month view |
| `⌘1` / `⌘2` / `⌘3` | Day / Week / Month view (kept) |
| `j` / `k` | Next / previous period (vim's directions) |
| `←` / `→` | Previous / next period (kept) |
| `⌘⌃1` | Back to Notes (kept) |

### Creating

| Keys | Action |
| --- | --- |
| `C` | New timeblock at the default slot |
| `⌘J` | Meet with |

### The event cursor

| Keys | Action |
| --- | --- |
| `N` | Select the next event from now |
| `↑` / `↓` | Previous / next event in view |
| `⏎` | Open the selected event in Google Calendar |
| `Esc` | Close the detail panel |
| `H` | Hide the selected event |
| `⇧H` | Hide all occurrences of it |

### View

| Keys | Action |
| --- | --- |
| `⇧D` | Toggle "hide declined" |
| `⇧V` | Toggle "show hidden" |
| `Z` | Toggle the secondary timezone rail |
| `⌘/` | Cheatsheet |

`T`, `D`/`W`/`M`, `C` and `j`/`k` are Vimcal's own bindings, which is the
direction this calendar is already heading. `H`/`⇧H` keep the per-event pair
together, so the view filters take `⇧D`/`⇧V` rather than crowding `H`.

`Z` toggles the rail between off and the last zone chosen, and opens the picker
when no zone has ever been set.

## The `⌘J` guard

Removed. The shortcut does exactly what the toolbar button does: toggle the
panel. The panel already handles the empty case — it offers directory search
and a raw email field — so gating it on having colleagues was wrong in the
first place.

## Layout

At `lg` and up the detail panel becomes a flex sibling of the calendar body:
380px wide, `shrink-0`, `border-l`, no scrim, no `fixed`. The grid re-lays out
into the remaining width, so an event and its details are visible together.

Below `lg` nothing changes: the bottom sheet with a scrim stays, because a
phone has no width to give away. `Esc` and the close button work in both.

The panel is not focus-trapped in the side-by-side form — it is part of the
page, and trapping focus there would break the cursor keys that drive it.

## Weekends and repeating events

**Weekends** get a tint behind Saturday and Sunday: the day columns in the week
view, the day cells in the month view. It is a background on the column, under
the events, so event colors are unaffected.

**Repeating events** show a small `↻` before the title wherever an event is
rendered — day/week chips, month chips, the all-day bar and the detail panel.
`event.seriesId !== null` already identifies them. In a narrow chip the glyph
truncates away with the title, which is the right failure.

## The timezone picker

The current secondary-timezone control is a plain `<select>` over every IANA
zone. It becomes a searchable dialog modelled on the notes `SearchDialog`: a
filter input over zone id and city, matching on either side of the slash, so
"kiev" finds `Europe/Kiev` and "lisbon" finds `Europe/Lisbon`. Current UTC
offset is shown beside each zone, since that is what the user is really
choosing. No new dependency: `Dialog` plus an input plus a filtered list.

## Components

| Unit | Responsibility |
| --- | --- |
| `core/eventCursor.ts` | Pure: order the events of a range, and resolve `next-from-now`, `previous` and `next` against a current selection. |
| `lib/timezones.ts` | Pure: filter zones by query, and format a zone's current offset. |
| `components/calendar/TimezonePicker.vue` | The searchable dialog. |
| `components/calendar/EventDetailPanel.vue` | Gains the side-by-side form; keeps the sheet below `lg`. |
| `components/calendar/TimeGridView.vue`, `MonthView.vue` | Weekend tint, repeat glyph. |
| `components/notes/ShortcutsDialog.vue` | Gains the calendar groups; rendered on the calendar page. |
| `pages/calendar/Index.vue` | The key handler, and the flex row that hosts panel + grid. |

The key handler stays a single function on the page, as it is now — it is the
one place that already holds every action these keys need to reach.

## Error handling

- A shortcut with nothing to act on is a no-op, never an error: `H` with no
  selection, `⏎` with no selection, `N` in an empty range.
- An event that disappears under the cursor (a refetch dropping it) clears the
  selection and closes the panel rather than leaving a stale detail view.
- Hiding the selected event moves the cursor to the next one, so `H` `H` `H`
  clears a run of noise without reaching for the mouse.
- The timezone picker's list is derived from `Intl.supportedValuesOf`, which
  is already what the page uses; an environment without it falls back to the
  zones already listed.

## Testing

Vitest against the pure modules:

- **`eventCursor`**: ordering across days by start then title; `next-from-now`
  picking the first future event; falling back to the first in range; `↑`/`↓`
  stepping and stopping at the ends; behaviour with no selection; overlay
  events excluded; an empty range yielding null.
- **`timezones`**: matching on city and on region, case-insensitively;
  ranking exact city matches first; offset formatting for a positive, negative
  and half-hour zone.

The key handler, the layout and the tints are verified by hand in the running
app — they are thin wiring over tested functions plus CSS.

## Out of scope

- Shortcuts for RSVP, deleting events, or editing without opening the editor.
- A focus ring / roving tabindex for accessibility beyond the existing
  behaviour; the cursor is a selection model, not a focus model.
- Making the notes page's shortcuts work here, or vice versa.
