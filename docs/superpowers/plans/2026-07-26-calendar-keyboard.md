# Calendar Keyboard Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full calendar page keyboard-driveable — a cheatsheet, bindings for every mouse-only action, a side-by-side detail panel, and an event cursor — plus tinted weekends, a mark on repeating events, and a searchable timezone picker.

**Architecture:** The key handler stays one function on `pages/calendar/Index.vue`, which is already where every action these keys reach is imported. Anything with real logic (cursor ordering, timezone filtering) goes to a pure module under `core/` or `lib/` and is tested there; the handler itself is thin wiring verified by hand.

**Tech Stack:** TypeScript, Vue 3 (`<script setup>`), Tailwind v4, date-fns, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-calendar-keyboard-design.md`. Read it before starting.
- Bare-letter shortcuts must respect the existing typing guard (target is `HTMLInputElement`, `HTMLSelectElement` or `HTMLTextAreaElement`) — extend it with `isContentEditable`.
- Pure modules must not import from `components/` or `stores/`.
- The repo is not Prettier-clean; do NOT run `prettier --write` on existing files. Match surrounding style by hand: 4-space indent, single quotes, trailing commas, explicit return types on exported functions, JSDoc on exported symbols. `npx eslint --fix <file>` for import order only.
- Before each commit: `npx vitest run`, `npm run types:check`, `npx eslint resources/js`.
- Never `git push` — the user's SSH key is behind 1Password. Commit only.

**Phases:** Tasks 1–2 ship on their own (shortcuts + cheatsheet). Tasks 3–5 are the layout and readability work. Tasks 6–7 build the cursor on top and must land after Task 3.

---

### Task 1: Mechanical shortcuts and the ⌘J fix

**Files:**
- Modify: `resources/js/pages/calendar/Index.vue` (`onKeydown`, ~line 241)

**Interfaces:**
- Consumes, all already imported by the page: `goToday`, `setCalendarView`, `stepCalendar`, `hideDeclined`, `setHideDeclined`, `showHidden`, `secondZone`, `setSecondZone`; and the page-local `newTimeblock()`, `meetPickerOpen`, `fabOpen`.
- Produces: no exports.

- [ ] **Step 1: Drop the ⌘J guard**

In `onKeydown`, replace the gated body:

```ts
        if (colleagues.value.length > 0 || meetWith.value.length > 0) {
            fabOpen.value = false;
            meetPickerOpen.value = !meetPickerOpen.value;
        }
```

with the same thing the toolbar button does:

```ts
        // The panel handles the empty case itself (directory search, raw
        // email), so there is nothing to gate on.
        fabOpen.value = false;
        meetPickerOpen.value = !meetPickerOpen.value;
```

- [ ] **Step 2: Widen the typing guard and hoist it**

The guard currently sits below the ⌘-shortcuts and only protects the arrows. Move it to the top of `onKeydown`, above the ⌘J branch, and add contenteditable — the markdown editor and the event editor both use it:

```ts
function onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
```

Delete the later `const target` / `const typing` declarations, and change the arrow branch's condition to `if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey) {`.

- [ ] **Step 3: Add the bare-letter block**

Immediately before the arrow-key branch, add:

```ts
    // Bare letters (Vimcal parity). Never while typing, never with a modifier.
    if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const key = event.key.toLowerCase();

        if (!event.shiftKey && key === 't') {
            event.preventDefault();
            goToday();

            return;
        }

        const byLetter = { d: 'day', w: 'week', m: 'month' } as const;

        if (!event.shiftKey && key in byLetter) {
            event.preventDefault();
            setCalendarView(byLetter[key as keyof typeof byLetter]);

            return;
        }

        if (!event.shiftKey && (key === 'j' || key === 'k')) {
            event.preventDefault();
            stepCalendar(key === 'j' ? -1 : 1);

            return;
        }

        if (!event.shiftKey && key === 'c') {
            event.preventDefault();
            newTimeblock();

            return;
        }

        if (event.shiftKey && key === 'd') {
            event.preventDefault();
            setHideDeclined(!hideDeclined.value);

            return;
        }

        if (event.shiftKey && key === 'v') {
            event.preventDefault();
            showHidden.value = !showHidden.value;

            return;
        }

        if (!event.shiftKey && key === 'z') {
            event.preventDefault();
            toggleSecondZone();

            return;
        }
    }
```

- [ ] **Step 4: Add the timezone toggle**

Next to `newTimeblock()`, add — `lastSecondZone` remembers the choice so `Z` is a toggle rather than a one-way door:

```ts
/** The zone `Z` restores after switching the rail off. */
const lastSecondZone = ref<string | null>(secondZone.value);

/**
 * `Z` — show or hide the secondary time axis. With no zone ever chosen there
 * is nothing to toggle to, so open the picker instead.
 */
function toggleSecondZone(): void {
    if (secondZone.value !== null) {
        lastSecondZone.value = secondZone.value;
        setSecondZone(null);

        return;
    }

    if (lastSecondZone.value !== null) {
        setSecondZone(lastSecondZone.value);

        return;
    }

    timezonePickerOpen.value = true;
}
```

Add `const timezonePickerOpen = ref(false);` next to `meetPickerOpen`. Task 5 gives it a dialog; until then it is set but unread, which is fine — ESLint does not flag an assigned-and-declared ref used in a template later.

- [ ] **Step 5: Verify by hand**

`npm run dev`, open the calendar. Check: `T` returns to today from any view; `D`/`W`/`M` switch views; `j`/`k` step periods like `←`/`→`; `C` opens the timeblock editor; `⇧D` and `⇧V` flip the two filters in the dropdown; `⌘J` opens Meet with in a solo workspace (the bug); typing a letter inside the event editor's title field does none of these.

- [ ] **Step 6: Commit**

```bash
npm run types:check && npx eslint resources/js
git add resources/js/pages/calendar/Index.vue
git commit -m "Calendar: keyboard shortcuts for the mouse-only actions"
```

---

### Task 2: The cheatsheet on the calendar page

**Files:**
- Modify: `resources/js/components/notes/ShortcutsDialog.vue` (the `groups` array)
- Modify: `resources/js/pages/calendar/Index.vue` (render it, bind `⌘/`)

**Interfaces:**
- Consumes: `shortcutsOpen` from `@/stores/ui`.
- Produces: no exports.

`ShortcutsDialog` is shared by both pages, so it needs to show the right groups for the page it is on.

- [ ] **Step 1: Make the dialog page-aware**

In `ShortcutsDialog.vue`, add a prop and split the calendar entries out of the shared list:

```ts
const props = withDefaults(
    defineProps<{ page?: 'notes' | 'calendar' }>(),
    { page: 'notes' },
);
```

Replace the existing `Calendar` group's shortcuts with the full set from the spec, and gate the groups by page:

```ts
const calendarGroups: ShortcutGroup[] = [
    {
        title: 'Navigation',
        shortcuts: [
            ['T', 'Today'],
            ['D / W / M', 'Day / Week / Month view'],
            ['⌘1 / ⌘2 / ⌘3', 'Day / Week / Month view'],
            ['j / k or ← / →', 'Previous / next period'],
            ['⌘⌃1', 'Switch to Notes'],
        ],
    },
    {
        title: 'Creating',
        shortcuts: [
            ['C', 'New timeblock'],
            ['⌘J', 'Meet with — overlay a colleague’s schedule'],
        ],
    },
    {
        title: 'Events',
        shortcuts: [
            ['N', 'Select the next event from now'],
            ['↑ / ↓', 'Previous / next event in view'],
            ['⏎', 'Open the selected event in Google Calendar'],
            ['Esc', 'Close the event details'],
            ['H', 'Hide the selected event'],
            ['⇧H', 'Hide all occurrences of it'],
        ],
    },
    {
        title: 'View',
        shortcuts: [
            ['⇧D', 'Toggle hide declined events'],
            ['⇧V', 'Toggle show hidden events'],
            ['Z', 'Toggle the secondary timezone'],
            ['⌘/', 'Show this cheatsheet'],
        ],
    },
];

const shown = computed(() =>
    props.page === 'calendar' ? calendarGroups : groups,
);
```

Render `shown` instead of `groups` in the template, and keep the existing search filter working over it (the filter already derives from the rendered list — point it at `shown`).

- [ ] **Step 2: Render it on the calendar page**

Import it (`import ShortcutsDialog from '@/components/notes/ShortcutsDialog.vue';`) and add `<ShortcutsDialog page="calendar" />` next to `<EventEditor />`. Import `shortcutsOpen` from `@/stores/ui` and add the binding at the top of `onKeydown`, after the typing guard:

```ts
    // ⌘/ — the cheatsheet.
    if ((event.metaKey || event.ctrlKey) && event.key === '/') {
        event.preventDefault();
        shortcutsOpen.value = !shortcutsOpen.value;

        return;
    }
```

- [ ] **Step 3: Verify by hand**

`⌘/` on the calendar shows the calendar groups and nothing from the notes page; `⌘/` on the notes page is unchanged; the dialog's search still filters.

- [ ] **Step 4: Commit**

```bash
npm run types:check && npx eslint resources/js && npx vitest run
git add resources/js/components/notes/ShortcutsDialog.vue resources/js/pages/calendar/Index.vue
git commit -m "Calendar: ⌘/ opens a cheatsheet for the calendar's own keys"
```

---

### Task 3: Side-by-side detail panel

**Files:**
- Modify: `resources/js/components/calendar/EventDetailPanel.vue` (the wrapper, ~line 97)
- Modify: `resources/js/pages/calendar/Index.vue` (the calendar body row, ~line 528)

**Interfaces:**
- Consumes: `selectedEvent`, `closeEventDetail` from `@/stores/calendar`.
- Produces: no exports. The panel renders in-flow at `lg` and up, and as the existing sheet below it.

- [ ] **Step 1: Make the body a row**

In `pages/calendar/Index.vue`, the body is:

```vue
        <div class="min-h-0 flex-1 overflow-hidden px-2 py-1" data-cal-body>
```

Wrap it so the panel can sit beside it. Replace the opening tag with:

```vue
        <div class="flex min-h-0 flex-1 overflow-hidden">
            <div class="min-h-0 flex-1 overflow-hidden px-2 py-1" data-cal-body>
```

and close the new wrapper after the existing body's closing `</div>`, with the panel inside it:

```vue
            </div>
            <EventDetailPanel />
        </div>
```

`EventDetailPanel` is currently rendered further down the template — move that existing tag here rather than adding a second one.

- [ ] **Step 2: Give the panel two forms**

In `EventDetailPanel.vue`, replace the wrapper:

```vue
    <div
        v-if="selectedEvent"
        class="fixed inset-0 z-50"
        @click.self="closeEventDetail"
    >
        <div class="absolute inset-0 bg-black/20" @click="closeEventDetail" />

        <aside
            class="absolute inset-x-0 bottom-0 flex max-h-[85%] flex-col rounded-t-2xl border border-border/60 bg-background shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[380px] sm:rounded-none sm:border-y-0 sm:border-r-0 pb-[env(safe-area-inset-bottom)]"
        >
```

with a scrim that only exists below `lg`, and an aside that is fixed below `lg` and in-flow at `lg` and up:

```vue
    <template v-if="selectedEvent">
        <!-- Below lg the panel is a sheet over the grid; from lg it takes
             width from the grid instead, so an event and its details are
             visible together. -->
        <div
            class="fixed inset-0 z-40 bg-black/20 lg:hidden"
            @click="closeEventDetail"
        />

        <aside
            class="fixed inset-x-0 bottom-0 z-50 flex max-h-[85%] flex-col rounded-t-2xl border border-border/60 bg-background pb-[env(safe-area-inset-bottom)] shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[380px] sm:rounded-none sm:border-y-0 sm:border-r-0 lg:static lg:z-auto lg:max-h-none lg:w-[380px] lg:shrink-0 lg:border-l lg:pb-0 lg:shadow-none"
        >
```

Close with `</template>` instead of `</div>`. Vue requires a single root only for the component's own template — a `<template v-if>` with two children is fine here because the component is rendered inside a flex row, but if the linter objects, wrap the scrim and aside in a fragment-free structure by giving the scrim `v-if="selectedEvent"` and the aside its own `v-if` at the top level instead.

- [ ] **Step 3: Bind Esc**

In `pages/calendar/Index.vue`, at the top of `onKeydown` after the typing guard:

```ts
    // Esc — close the event details.
    if (event.key === 'Escape' && selectedEvent.value) {
        event.preventDefault();
        closeEventDetail();

        return;
    }
```

Add `closeEventDetail` and `selectedEvent` to the `@/stores/calendar` import.

- [ ] **Step 4: Verify by hand**

At a wide window: clicking an event narrows the grid and shows the panel beside it, with no dimming, and the grid re-lays out (a week view goes from 7 wide columns to 7 slightly narrower ones). Narrow the window below `lg`: the panel becomes the sheet again with its scrim. `Esc` closes it in both.

- [ ] **Step 5: Commit**

```bash
npm run types:check && npx eslint resources/js && npx vitest run
git add resources/js/components/calendar/EventDetailPanel.vue resources/js/pages/calendar/Index.vue
git commit -m "Calendar: event details sit beside the grid instead of over it"
```

---

### Task 4: Weekend tint and a mark on repeating events

**Files:**
- Modify: `resources/js/components/calendar/TimeGridView.vue` (`columns`, ~line 209; header cell ~line 283; day column ~line 363; chips)
- Modify: `resources/js/components/calendar/MonthView.vue` (`cells`, ~line 80; cell markup ~line 109)

**Interfaces:**
- Consumes: `isWeekend` from `date-fns`; `event.seriesId` from `CalendarEvent`.
- Produces: no exports.

- [ ] **Step 1: Tint the weekend columns**

In `TimeGridView.vue`, add to the `columns` computed:

```ts
        isWeekend: isWeekend(day),
```

(import `isWeekend` from `date-fns`.) On the day column div (`class="relative min-w-0 flex-1 border-l border-border/40"`), switch to a bound class:

```vue
                    :class="
                        cn(
                            'relative min-w-0 flex-1 border-l border-border/40',
                            col.isWeekend && 'bg-muted/25',
                        )
                    "
```

Do the same on the header cell (`class="flex-1 py-1.5 text-center"`), so the tint runs the full height of the column.

In `MonthView.vue`, add `isWeekend: isWeekend(day),` to `cells` and apply `cell.isWeekend && 'bg-muted/25'` to the cell's existing class binding, ordered *before* the `inMonth`/today classes so those still win.

- [ ] **Step 2: Mark repeating events**

Add a small glyph before the title wherever an event renders. In `TimeGridView.vue`'s timed block and all-day chip, and in `MonthView.vue`'s chip, put this immediately before the title text:

```vue
                            <Repeat
                                v-if="event.seriesId"
                                class="mr-0.5 inline size-3 shrink-0 opacity-60"
                                aria-label="Repeats"
                            />
```

Import `Repeat` from `@lucide/vue` in both files. In `EventDetailPanel.vue`, add the same glyph beside the `when` line so the panel says it too.

- [ ] **Step 3: Verify by hand**

Weekends read as a distinctly calmer column in week and month views, in both themes, and the tint sits *under* events rather than washing them out. A recurring meeting shows the glyph in day, week and month views and in the panel; a one-off does not.

- [ ] **Step 4: Commit**

```bash
npm run types:check && npx eslint resources/js && npx vitest run
git add resources/js/components/calendar
git commit -m "Calendar: tint weekends and mark repeating events"
```

---

### Task 5: Searchable timezone picker

**Files:**
- Create: `resources/js/lib/timezones.ts`
- Create: `resources/js/lib/timezones.test.ts`
- Create: `resources/js/components/calendar/TimezonePicker.vue`
- Modify: `resources/js/pages/calendar/Index.vue` (replace the `<select>`, ~line 483)

**Interfaces:**
- Produces:
  - `zoneCity(zone: string): string` — `'Europe/Kiev'` → `'Kiev'`
  - `zoneOffsetLabel(zone: string, at?: Date): string` — `'UTC+3'`, `'UTC−3:30'`
  - `searchZones(zones: string[], query: string, limit?: number): string[]`

- [ ] **Step 1: Write the failing test**

Create `resources/js/lib/timezones.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { searchZones, zoneCity, zoneOffsetLabel } from './timezones';

const ZONES = [
    'Europe/Kiev',
    'Europe/Lisbon',
    'Europe/London',
    'America/New_York',
    'Asia/Kolkata',
    'Pacific/Auckland',
];

describe('zoneCity', () => {
    it('takes the last segment and un-underscores it', () => {
        expect(zoneCity('America/New_York')).toBe('New York');
        expect(zoneCity('Europe/Kiev')).toBe('Kiev');
        expect(zoneCity('UTC')).toBe('UTC');
    });
});

describe('zoneOffsetLabel', () => {
    const winter = new Date('2026-01-15T12:00:00Z');

    it('labels whole-hour offsets either side of UTC', () => {
        expect(zoneOffsetLabel('Europe/London', winter)).toBe('UTC+0');
        expect(zoneOffsetLabel('Europe/Kiev', winter)).toBe('UTC+2');
        expect(zoneOffsetLabel('America/New_York', winter)).toBe('UTC−5');
    });

    it('labels half-hour offsets', () => {
        expect(zoneOffsetLabel('Asia/Kolkata', winter)).toBe('UTC+5:30');
    });
});

describe('searchZones', () => {
    it('matches the city, case-insensitively', () => {
        expect(searchZones(ZONES, 'kiev')).toEqual(['Europe/Kiev']);
        expect(searchZones(ZONES, 'NEW YORK')).toEqual(['America/New_York']);
    });

    it('matches across the underscore the id uses', () => {
        expect(searchZones(ZONES, 'new_york')).toEqual(['America/New_York']);
    });

    it('matches the region too', () => {
        expect(searchZones(ZONES, 'europe')).toEqual([
            'Europe/Kiev',
            'Europe/Lisbon',
            'Europe/London',
        ]);
    });

    it('ranks a city that starts with the query above one that contains it', () => {
        expect(searchZones(['Europe/London', 'Europe/Londrina'], 'lond')).toEqual([
            'Europe/London',
            'Europe/Londrina',
        ]);
        expect(searchZones(['America/Fort_Nelson', 'Europe/Lisbon'], 'lis')).toEqual([
            'Europe/Lisbon',
        ]);
    });

    it('returns everything for an empty query, capped', () => {
        expect(searchZones(ZONES, '  ')).toEqual(ZONES);
        expect(searchZones(ZONES, '', 2)).toHaveLength(2);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run resources/js/lib/timezones.test.ts`
Expected: FAIL — cannot resolve `./timezones`.

- [ ] **Step 3: Write the implementation**

Create `resources/js/lib/timezones.ts`:

```ts
/**
 * Choosing a secondary time axis. IANA ids are how the platform names zones
 * but not how anyone thinks about them — "Kiev" should find `Europe/Kiev`,
 * and what the user is really picking is an offset, so show that too.
 */

/** The city an IANA id names: `Europe/Kiev` → `Kiev`. */
export function zoneCity(zone: string): string {
    return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

/** A zone's current offset from UTC, e.g. `UTC+3`, `UTC−3:30`. */
export function zoneOffsetLabel(zone: string, at: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        timeZoneName: 'longOffset',
    }).formatToParts(at);
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);

    if (!match) {
        return 'UTC+0';
    }

    const [, sign, hours, minutes] = match;
    const hour = Number(hours);
    const minute = Number(minutes);

    return `UTC${sign === '-' ? '−' : '+'}${hour}${minute > 0 ? `:${minutes}` : ''}`;
}

/**
 * Zones matching a query, city matches first. Underscores in an id are
 * treated as spaces, so "new york" and "new_york" both work.
 */
export function searchZones(
    zones: string[],
    query: string,
    limit = 200,
): string[] {
    const needle = query.trim().toLowerCase().replace(/_/g, ' ');

    if (needle === '') {
        return zones.slice(0, limit);
    }

    const scored: { zone: string; score: number }[] = [];

    for (const zone of zones) {
        const city = zoneCity(zone).toLowerCase();
        const full = zone.toLowerCase().replace(/_/g, ' ');
        const score = city.startsWith(needle)
            ? 0
            : city.includes(needle)
              ? 1
              : full.includes(needle)
                ? 2
                : -1;

        if (score !== -1) {
            scored.push({ zone, score });
        }
    }

    return scored
        .sort((a, b) => a.score - b.score || a.zone.localeCompare(b.zone))
        .slice(0, limit)
        .map((entry) => entry.zone);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run resources/js/lib/timezones.test.ts`
Expected: PASS (9 tests). If the `europe` case comes back in a different order, note that ties sort by id — `Kiev`, `Lisbon`, `London` is already alphabetical.

- [ ] **Step 5: Build the picker**

Create `resources/js/components/calendar/TimezonePicker.vue` — a dialog modelled on `components/notes/SearchDialog.vue` (read it first for the established shape):

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { searchZones, zoneCity, zoneOffsetLabel } from '@/lib/timezones';
import { cn } from '@/lib/utils';

const props = defineProps<{ zones: string[]; modelValue: string | null }>();
const emit = defineEmits<{
    'update:open': [value: boolean];
    select: [zone: string | null];
}>();

const open = defineModel<boolean>('open', { required: true });
const query = ref('');
const results = computed(() => searchZones(props.zones, query.value, 60));

watch(open, (value) => {
    if (value) {
        query.value = '';
    }
});

function choose(zone: string | null): void {
    emit('select', zone);
    open.value = false;
}
</script>

<template>
    <Dialog v-model:open="open">
        <DialogContent class="max-w-md gap-0 p-0">
            <DialogTitle class="sr-only">Secondary timezone</DialogTitle>
            <Input
                v-model="query"
                placeholder="Search a city or region — “kiev”, “new york”…"
                class="rounded-b-none border-0 border-b border-border/60 focus-visible:ring-0"
                autofocus
            />
            <div class="max-h-80 overflow-y-auto p-1">
                <button
                    type="button"
                    class="flex w-full items-center rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    @click="choose(null)"
                >
                    <span class="text-muted-foreground">No second timezone</span>
                </button>
                <button
                    v-for="zone in results"
                    :key="zone"
                    type="button"
                    :class="
                        cn(
                            'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
                            zone === props.modelValue && 'bg-muted',
                        )
                    "
                    @click="choose(zone)"
                >
                    <span class="min-w-0 flex-1 truncate">
                        {{ zoneCity(zone) }}
                        <span class="text-xs text-muted-foreground">
                            {{ zone }}
                        </span>
                    </span>
                    <span class="shrink-0 text-xs text-muted-foreground">
                        {{ zoneOffsetLabel(zone) }}
                    </span>
                </button>
                <p
                    v-if="results.length === 0"
                    class="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                    No zone matches “{{ query }}”.
                </p>
            </div>
        </DialogContent>
    </Dialog>
</template>
```

- [ ] **Step 6: Swap out the `<select>`**

In `pages/calendar/Index.vue`, replace the `<label>`-wrapped `<select>` with a button that opens the picker, and render the picker next to `<EventEditor />`:

```vue
                <button
                    v-if="calendarView !== 'month'"
                    type="button"
                    class="hidden items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted/60 sm:flex"
                    title="Secondary timezone (Z)"
                    @click="timezonePickerOpen = true"
                >
                    <Globe class="size-3.5" />
                    {{ secondZone ? zoneCity(secondZone) : 'Add timezone' }}
                </button>
```

```vue
        <TimezonePicker
            v-model:open="timezonePickerOpen"
            :zones="allZones"
            :model-value="secondZone"
            @select="onPickZone"
        />
```

```ts
/** Picking from the dialog also updates what `Z` toggles back to. */
function onPickZone(zone: string | null): void {
    setSecondZone(zone);

    if (zone !== null) {
        lastSecondZone.value = zone;
    }
}
```

Drop the now-unused `zones` computed (the `{ value, label }` list) if nothing else reads it.

- [ ] **Step 7: Verify by hand**

Typing "kiev" finds `Europe/Kiev`; "new york" and "new_york" both find New York; each row shows its current offset; picking one puts the second axis on the grid; `Z` then toggles that same zone off and on.

- [ ] **Step 8: Commit**

```bash
npm run types:check && npx eslint resources/js && npx vitest run
git add resources/js/lib/timezones.ts resources/js/lib/timezones.test.ts resources/js/components/calendar/TimezonePicker.vue resources/js/pages/calendar/Index.vue
git commit -m "Calendar: search for a secondary timezone by city"
```

---

### Task 6: The event cursor's logic

**Files:**
- Create: `resources/js/core/eventCursor.ts`
- Create: `resources/js/core/eventCursor.test.ts`

**Interfaces:**
- Produces, over a structural type so `core/` needn't import the store:
  - `CursorEvent` — `{ key: string; start: string; title: string }`
  - `orderEvents<T extends CursorEvent>(events: T[]): T[]`
  - `nextFromNow<T extends CursorEvent>(events: T[], now: Date): T | null`
  - `stepEvent<T extends CursorEvent>(events: T[], currentKey: string | null, direction: 1 | -1, now: Date): T | null`

- [ ] **Step 1: Write the failing test**

Create `resources/js/core/eventCursor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { nextFromNow, orderEvents, stepEvent } from './eventCursor';

const EVENTS = [
    { key: 'c', start: '2026-07-27T09:00:00Z', title: 'Tuesday standup' },
    { key: 'a', start: '2026-07-26T09:00:00Z', title: 'Monday standup' },
    { key: 'b', start: '2026-07-26T09:00:00Z', title: 'Another at nine' },
    { key: 'd', start: '2026-07-26T14:00:00Z', title: 'Monday review' },
];

const NOW = new Date('2026-07-26T10:00:00Z');

describe('orderEvents', () => {
    it('sorts by start, then title, flattened across days', () => {
        expect(orderEvents(EVENTS).map((event) => event.key)).toEqual([
            'b',
            'a',
            'd',
            'c',
        ]);
    });

    it('does not mutate the input', () => {
        const input = [...EVENTS];
        orderEvents(input);

        expect(input.map((event) => event.key)).toEqual(['c', 'a', 'b', 'd']);
    });
});

describe('nextFromNow', () => {
    it('picks the first event starting at or after now', () => {
        expect(nextFromNow(EVENTS, NOW)?.key).toBe('d');
    });

    it('falls back to the first in range when nothing is upcoming', () => {
        const past = new Date('2026-07-28T00:00:00Z');

        expect(nextFromNow(EVENTS, past)?.key).toBe('b');
    });

    it('is null for an empty range', () => {
        expect(nextFromNow([], NOW)).toBeNull();
    });
});

describe('stepEvent', () => {
    it('moves to the next and previous event in order', () => {
        expect(stepEvent(EVENTS, 'a', 1, NOW)?.key).toBe('d');
        expect(stepEvent(EVENTS, 'd', -1, NOW)?.key).toBe('a');
    });

    it('stops at the ends rather than wrapping', () => {
        expect(stepEvent(EVENTS, 'c', 1, NOW)?.key).toBe('c');
        expect(stepEvent(EVENTS, 'b', -1, NOW)?.key).toBe('b');
    });

    it('starts from now when nothing is selected', () => {
        expect(stepEvent(EVENTS, null, 1, NOW)?.key).toBe('d');
        expect(stepEvent(EVENTS, null, -1, NOW)?.key).toBe('c');
    });

    it('starts from now when the selection is no longer in range', () => {
        expect(stepEvent(EVENTS, 'gone', 1, NOW)?.key).toBe('d');
    });

    it('is null for an empty range', () => {
        expect(stepEvent([], null, 1, NOW)).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run resources/js/core/eventCursor.test.ts`
Expected: FAIL — cannot resolve `./eventCursor`.

- [ ] **Step 3: Write the implementation**

Create `resources/js/core/eventCursor.ts`:

```ts
/**
 * Moving a cursor through the events on screen. The cursor is the selected
 * event — the one the detail panel is showing — so this only has to answer
 * which event comes next, in an order that matches how the grid reads:
 * by start time across the whole visible range, not down one day's column.
 */

/** The shape the cursor needs; the store's CalendarEvent satisfies it. */
export interface CursorEvent {
    key: string;
    /** ISO start, or a bare YYYY-MM-DD for an all-day event. */
    start: string;
    title: string;
}

/** The events of a range in the order the cursor walks them. */
export function orderEvents<T extends CursorEvent>(events: T[]): T[] {
    return [...events].sort(
        (a, b) =>
            new Date(a.start).getTime() - new Date(b.start).getTime() ||
            a.title.localeCompare(b.title),
    );
}

/**
 * The first event starting at or after `now`, falling back to the first in
 * range when the view holds no future — the view is never changed to find
 * one, so this always answers within what the user is looking at.
 */
export function nextFromNow<T extends CursorEvent>(
    events: T[],
    now: Date,
): T | null {
    const ordered = orderEvents(events);

    return (
        ordered.find(
            (event) => new Date(event.start).getTime() >= now.getTime(),
        ) ??
        ordered[0] ??
        null
    );
}

/**
 * The event one step from the current selection. With nothing selected (or a
 * selection that has gone out of range) it starts from now: forwards picks
 * the next upcoming event, backwards the last in range. It stops at the ends
 * rather than wrapping — wrapping a week view teleports you from Friday
 * evening to Monday morning with nothing to explain it.
 */
export function stepEvent<T extends CursorEvent>(
    events: T[],
    currentKey: string | null,
    direction: 1 | -1,
    now: Date,
): T | null {
    const ordered = orderEvents(events);

    if (ordered.length === 0) {
        return null;
    }

    const index =
        currentKey === null
            ? -1
            : ordered.findIndex((event) => event.key === currentKey);

    if (index === -1) {
        return direction === 1
            ? nextFromNow(events, now)
            : (ordered[ordered.length - 1] ?? null);
    }

    return ordered[Math.min(ordered.length - 1, Math.max(0, index + direction))];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run resources/js/core/eventCursor.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
npm run types:check && npx eslint resources/js/core
git add resources/js/core/eventCursor.ts resources/js/core/eventCursor.test.ts
git commit -m "Calendar: order events the way a cursor should walk them"
```

---

### Task 7: Wire the cursor

**Files:**
- Modify: `resources/js/pages/calendar/Index.vue` (`onKeydown`, and a watcher)

**Interfaces:**
- Consumes: `orderEvents`, `nextFromNow`, `stepEvent` from `@/core/eventCursor`; `displayEvents`, `selectedEvent`, `openEventDetail`, `closeEventDetail`, `hideEvent`, `openEventEditor` from `@/stores/calendar`.
- Produces: no exports.

`displayEvents` is the store's already-filtered list (hidden calendars, declined, hidden events) — exactly what is on screen. Overlay events live in `overlayEvents` and are deliberately not part of the cursor.

- [ ] **Step 1: Add the cursor keys**

In the bare-letter block from Task 1, before the view-filter branches:

`key` is already lower-cased, so shift is what separates hide-one from
hide-series — one branch, not two:

```ts
        if (!event.shiftKey && key === 'n') {
            event.preventDefault();
            selectEvent(nextFromNow(cursorEvents.value, new Date()));

            return;
        }

        if (key === 'h') {
            event.preventDefault();
            hideSelected(event.shiftKey ? 'series' : 'one');

            return;
        }
```

And in the arrow branch, alongside `ArrowLeft`/`ArrowRight`:

```ts
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            selectEvent(
                stepEvent(
                    cursorEvents.value,
                    selectedEvent.value?.key ?? null,
                    event.key === 'ArrowDown' ? 1 : -1,
                    new Date(),
                ),
            );

            return;
        }
```

Add `⏎` to the same block. There is no in-app editor for an existing event
(`EventDraft` only creates), so this opens the event where it can be edited —
the same link the detail panel offers:

```ts
        if (event.key === 'Enter' && selectedEvent.value?.htmlLink) {
            event.preventDefault();
            window.open(selectedEvent.value.htmlLink, '_blank', 'noopener');

            return;
        }
```

- [ ] **Step 2: Add the helpers**

```ts
/** What the cursor walks: the events actually on screen, yours only. */
const cursorEvents = computed(() => orderEvents(displayEvents.value));

function selectEvent(event: CalendarEvent | null): void {
    if (event) {
        openEventDetail(event);
    }
}

/**
 * Hide the selected event, then move the cursor on — so H H H clears a run of
 * noise without reaching for the mouse.
 */
function hideSelected(scope: 'one' | 'series'): void {
    const current = selectedEvent.value;

    if (!current) {
        return;
    }

    const next = stepEvent(cursorEvents.value, current.key, 1, new Date());
    hideEvent(current, scope);
    selectEvent(next?.key === current.key ? null : (next ?? null));

    if (!next || next.key === current.key) {
        closeEventDetail();
    }
}
```

- [ ] **Step 3: Drop a stale selection**

An event can vanish under the cursor when a refetch lands or a filter changes. Add next to the other watchers:

```ts
// A refetch or a filter change can drop the selected event; don't leave the
// panel describing something that is no longer on screen.
watch(displayEvents, (events) => {
    if (
        selectedEvent.value &&
        !events.some((event) => event.key === selectedEvent.value?.key)
    ) {
        closeEventDetail();
    }
});
```

- [ ] **Step 4: Verify by hand**

`N` selects the next upcoming event and the panel opens beside the grid; `↓`/`↑` walk events in reading order across a week and stop at the ends; the panel follows every move; `⏎` opens the selected one in Google Calendar; `H` hides it and the cursor lands on the next; `⇧H` hides the series; `Esc` closes the panel; `↑`/`↓` inside the event editor's fields still move the caret, not the cursor.

- [ ] **Step 5: Commit**

```bash
npm run types:check && npx eslint resources/js && npx vitest run
git add resources/js/pages/calendar/Index.vue
git commit -m "Calendar: drive events from the keyboard"
```

---

## Notes for the implementer

- **Do not** run `prettier --write` on existing files; the repo is not Prettier-clean and it produces large unrelated diffs.
- The key handler is one growing function. Keep the order: typing guard, then `Esc`, then `⌘`-combinations, then bare letters, then arrows. A branch that returns early is easier to reason about than a nested condition.
- `⌘⌃1`/`⌘⌃2` must keep being handled *before* the plain `⌘1/2/3` branch, or switching sections would switch views instead. This ordering exists today — don't disturb it when inserting new branches.
