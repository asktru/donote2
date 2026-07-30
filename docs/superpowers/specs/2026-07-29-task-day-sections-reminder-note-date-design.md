# Task day sections & note-dated reminders — design

Date: 2026-07-29

## Problem

Two unrelated rough edges, both rooted in a date being resolved from the wrong
place.

**1. The Tasks view collapses the rest of the week into one bucket.** The Notes
page's Tasks view groups by date as Overdue / Today / This week / Later / No
date. "This week" mixes two different kinds of commitment: a task scheduled to a
specific day later this week (`>2026-07-31`) and a task scheduled to the week as
a whole (`>2026-W31`). The days of the week are invisible, so a Friday task
looks no more or less imminent than an anytime-this-week task.

**2. Moving a task between daily notes leaves its reminder behind.** A task
carrying a reminder token (`@9am`) but no `>` schedule fires *today* no matter
which daily note holds it, because `resolveReminderAt` never sees the note. Move
the task from Wednesday's note to Friday's and the notification still fires on
whatever day the app happens to be open. The same task's *day* is already
resolved correctly elsewhere — `taskDayKey` in the workspace store falls back to
the daily note's `dateKey` — so the two disagree.

## What we're building

1. **Day sections** between Today and This week, one per remaining day of the
   current week, with This week reduced to true week-scheduled tasks.
2. **Note-dated reminders** — a reminder with no explicit schedule fires on the
   date of the daily note it lives in.

## Part 1 — Day sections in the Tasks view

### Extraction

The bucketing currently lives inline in `TasksView.vue`'s `groups` computed,
where it cannot be tested. It moves to a new pure module,
`resources/js/core/taskGroups.ts`, following the existing `core/doneSection.ts`
and `core/dayGrid.ts` pattern:

```ts
export interface DateGroup<T> {
    label: string;
    items: T[];
}

export function groupTasksByDate<T>(
    items: T[],
    dayKeyOf: (item: T) => string | null,
    ref?: Date,
): DateGroup<T>[];
```

The generic `dayKeyOf` accessor keeps the module free of workspace types.
`TasksView.vue`'s computed becomes a call to `groupTasksByDate(filtered.value,
taskDayKey)`, with its existing `sortTasks` applied per group.

`ref` defaults to `new Date()` and exists so tests can pin a mid-week date.

### Bucketing rule

Driven by `kindOfKey(dayKey)` rather than by range arithmetic alone, so a
day-scheduled task and a period-scheduled task starting on the same date are
classified differently. Evaluated top to bottom; `todayStart` is
`keyStartDate(todayDailyKey(ref))`.

| Task's effective day key | Section |
| --- | --- |
| none | No date |
| period already ended (`keyRange(key).end <= todayStart`) | Overdue |
| daily, equal to today's key | Today |
| daily, a remaining day of the current week | that day |
| daily, after the current week | Later |
| weekly, equal to the current week's key | This week |
| monthly / quarterly / yearly containing today | Today |
| anything else in the future | Later |

The last row is what sends `>2026-08` to Later when today is 2026-07-29, even
though August starts inside the current week: a month-level commitment is not a
this-week commitment. The monthly/quarterly/yearly-containing-today row
preserves the current behaviour for the *current* month, quarter and year, which
already land in Today.

"A remaining day of the current week" means a daily key strictly after today and
inside `keyRange(todayKey('weekly', ref))` — the week's own definition of its
bounds, so the existing ISO Monday-start convention carries over untouched.

### Section order and labels

Overdue → Today → Tomorrow → the remaining weekday sections in ascending date
order → This week → Later → No date.

Day sections are labelled "Tomorrow" for today + 1 and otherwise by weekday
name, via date-fns `format(start, 'EEEE')` — the same `format` the rest of
`core/dates.ts` labels keys with.

Empty sections are dropped, as today — including all day sections on the last
day of the week (Sunday, since `keyStartDate` builds weekly keys from
`startOfISOWeek`), where the view falls back to exactly the current shape.

The Overdue heading keeps its destructive colouring; the new sections use the
same muted styling as Today. `TasksView.vue`'s heading colour check compares
against the literal `'Overdue'`, which is unaffected.

## Part 2 — Note-dated reminders

### The fix

`resolveReminderAt` in `resources/js/core/reminders.ts` resolves the fire day as
`line.schedule ?? todayDailyKey(ref)`. Both it and `reminderCandidates` gain a
`noteDayKey: string | null` parameter, and the day becomes:

```ts
const dayKey = line.schedule ?? noteDayKey;

if (dayKey === null) {
    return null;
}
```

An explicit `>` schedule therefore still wins over the note's own date, exactly
as now; the note's date takes over only where today's date used to be assumed.

### Single source of truth for a note's day

`workspace.ts` exports a new one-liner:

```ts
export function noteDayKey(note: LocalNote): string | null {
    return note.type === 'daily' ? note.dateKey : null;
}
```

`taskDayKey` is refactored to return `noteDayKey(task.note)` in place of its
inline daily check, so the Tasks view's notion of a task's day and the reminder
scheduler's notion of a reminder's day cannot drift apart.

All three `reminderCandidates` callers already iterate `liveNotes` with the note
in hand and pass `noteDayKey(note)`:

- `stores/reminderScheduler.ts` — OS notification scheduling
- `components/notes/ReminderHost.vue` — in-app due popups
- `components/notes/RemindersView.vue` — the Reminders list

### Why no new plumbing is needed for the move

`reminderKey` already includes the fire timestamp, so relocating the task mints
a different key. The scheduler's `reconcileReminderNotifications` rebuilds the
desired set from every note and hands it to `reconcileNotifications`, which
cancels notifications no longer desired. The existing `liveNotes` watcher fires
that reconcile within `NOTE_CHANGE_DEBOUNCE_MS` (500 ms) of the edit, on top of
the 30 s interval. Moving a task therefore cancels the old OS notification and
schedules the new one on the next tick, with no change to the scheduler beyond
the extra argument.

### Deliberate behaviour changes

- **`@time` with no schedule in a non-daily note stops firing.** A task in a
  project, weekly, monthly, quarterly or yearly note carrying `@9am` and no `>`
  token previously fired today; it now produces no candidate at all. This was
  chosen over keeping a today fallback: a reminder with no date anywhere is not
  a today reminder, and the daily-note-only rule matches `taskDayKey`.
- **A stale `@time` in an old daily note stops re-firing daily.** It now
  resolves to that note's past date, which falls outside `REMINDER_GRACE_MS`
  (12 h), so no popup. This is the intended correction of a nagging bug, not a
  regression.

## Out of scope

`RemindersView.vue`'s own date grouping. It buckets by fire timestamp rather
than by day key and keeps its four sections; it is not converted to
`groupTasksByDate`. Part 2 still changes which reminders it lists, via the
shared `reminderCandidates`.

## Testing

New `resources/js/core/taskGroups.test.ts`, with `ref` pinned to a mid-week date
(Wednesday 2026-07-29, inside week 2026-W31):

- a past daily key and a past week key both land in Overdue
- today's daily key lands in Today
- tomorrow's daily key lands in a section labelled "Tomorrow"
- Friday's daily key lands in a section labelled "Friday"
- `>2026-W31` lands in This week, not in a day section
- `>2026-08` lands in Later even though August starts inside the week
- `>2026-07` and `>2026-Q3` land in Today
- a daily key next week lands in Later
- a null day key lands in No date
- sections with no tasks are absent from the result
- section order is Overdue, Today, Tomorrow, weekdays ascending, This week,
  Later, No date

Extended `resources/js/core/reminders.test.ts`:

- a line with `@9am` and no schedule, given a daily note's day key, fires at
  09:00 on that note's date rather than today
- the same line given a different note day key fires on that other date, which
  is what makes a move reschedule
- a line with `@9am` and no schedule in a non-daily note (`noteDayKey` null)
  yields no candidate
- an explicit `>` schedule still wins over the note's day key
- a line with no reminder token yields no candidate regardless of note day key

Existing `reminders.test.ts` cases that rely on the today fallback are updated
to pass today's key as the note day key, preserving their intent.
