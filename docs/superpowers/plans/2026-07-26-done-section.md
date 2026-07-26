# Done Section & Subtree Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File closed tasks into a collapsed `# Done` section at the end of a note, rebuilding the heading/bullet structure they sat under, and make closing a task offer to close its open children (and re-opening one re-open its ancestors).

**Architecture:** All markdown logic lives in two new pure modules under `resources/js/core/` operating on strings and `ParsedLine[]`, with no DOM and no store access. The store and the CodeMirror editor call into them; neither grows its own copy of a rule. The transform is `string → string` and is handed to the existing `updateNoteContent`, so dirty-marking, sync, the open editor and undo all work through paths that already exist.

**Tech Stack:** TypeScript, Vue 3 (`<script setup>`), CodeMirror 6, Vitest, Tailwind v4.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-done-section-design.md`. Read it before starting.
- Closed = state `done` or `cancelled`. Open = state `open` or `scheduled`. Neutral = any line that is not a task or checklist item.
- Indentation unit is 4 spaces (`indentUnit.of('    ')`); the parser counts a tab as 4.
- Pure modules in `core/` must not import from `components/`, `stores/` or `lib/`.
- Run `npx vitest run <file>` for a single suite, `npm run types:check` and `npx eslint resources/js` before each commit.
- The repo is not Prettier-clean; do NOT run `prettier --write` on existing files. Match surrounding style by hand: 4-space indent, single quotes, trailing commas, explicit return types on exported functions, JSDoc on exported symbols.
- Never `git push` (the user's SSH key is behind 1Password). Commit only.

---

### Task 1: Subtree state rules

**Files:**
- Create: `resources/js/core/subtreeState.ts`
- Create: `resources/js/core/subtreeState.test.ts`

**Interfaces:**
- Consumes: `ParsedLine`, `TaskState`, `parseNote`, `childrenOf` from `@/core/parser`.
- Produces:
  - `isClosed(line: ParsedLine): boolean`
  - `isOpen(line: ParsedLine): boolean`
  - `openDescendants(lines: ParsedLine[], index: number): ParsedLine[]`
  - `closedAncestors(lines: ParsedLine[], index: number): ParsedLine[]`
  - `withTaskState(raw: string, state: TaskState): string`

- [ ] **Step 1: Write the failing test**

Create `resources/js/core/subtreeState.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseNote } from './parser';
import {
    closedAncestors,
    isClosed,
    isOpen,
    openDescendants,
    withTaskState,
} from './subtreeState';

const NOTE = [
    '- [x] Prepare release',
    '    - [ ] Write changelog',
    '    - [x] Update the docs',
    '        + [ ] Proofread',
    '    context line',
    '- [ ] Ship it',
].join('\n');

describe('isClosed / isOpen', () => {
    it('classifies task states', () => {
        const lines = parseNote(
            ['- [x] a', '- [-] b', '- [ ] c', '- [>] d', '- bullet'].join('\n'),
        );

        expect(lines.map(isClosed)).toEqual([true, true, false, false, false]);
        expect(lines.map(isOpen)).toEqual([false, false, true, true, false]);
    });

    it('counts checklist items as tasks for both', () => {
        const lines = parseNote(['+ [x] a', '+ [ ] b'].join('\n'));

        expect(lines.map(isClosed)).toEqual([true, false]);
        expect(lines.map(isOpen)).toEqual([false, true]);
    });
});

describe('openDescendants', () => {
    it('finds open items at any depth, skipping closed and neutral lines', () => {
        const lines = parseNote(NOTE);

        expect(openDescendants(lines, 0).map((line) => line.title)).toEqual([
            'Write changelog',
            'Proofread',
        ]);
    });

    it('is empty for a leaf', () => {
        expect(openDescendants(parseNote(NOTE), 5)).toEqual([]);
    });
});

describe('closedAncestors', () => {
    it('walks up through every closed ancestor, innermost first', () => {
        const lines = parseNote(NOTE);

        expect(closedAncestors(lines, 3).map((line) => line.title)).toEqual([
            'Update the docs',
            'Prepare release',
        ]);
    });

    it('skips ancestors that are already open or neutral', () => {
        const lines = parseNote(
            ['- bullet', '    - [ ] open', '        - [x] done'].join('\n'),
        );

        expect(closedAncestors(lines, 2)).toEqual([]);
    });
});

describe('withTaskState', () => {
    it('rewrites the checkbox, keeping indentation and the rest of the line', () => {
        expect(withTaskState('    - [ ] Ship it >2026-07-26', 'done')).toBe(
            '    - [x] Ship it >2026-07-26',
        );
        expect(withTaskState('+ [x] Proofread', 'open')).toBe('+ [ ] Proofread');
        expect(withTaskState('- [ ] Drop it', 'cancelled')).toBe('- [-] Drop it');
        expect(withTaskState('- [ ] Later', 'scheduled')).toBe('- [>] Later');
    });

    it('strips priority when closing, since it is meaningless once finished', () => {
        expect(withTaskState('- [ ] !! Pay invoices', 'done')).toBe(
            '- [x] Pay invoices',
        );
        expect(withTaskState('- [ ] !!! Urgent', 'cancelled')).toBe(
            '- [-] Urgent',
        );
    });

    it('leaves a line that is not a task alone', () => {
        expect(withTaskState('- bullet', 'done')).toBe('- bullet');
        expect(withTaskState('# Heading', 'done')).toBe('# Heading');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run resources/js/core/subtreeState.test.ts`
Expected: FAIL — cannot resolve `./subtreeState`.

- [ ] **Step 3: Write the implementation**

Create `resources/js/core/subtreeState.ts`:

```ts
import { childrenOf } from './parser';
import type { ParsedLine, TaskState } from './parser';

/**
 * The shared notion of "finished" behind both the Done section and subtree
 * completion: a task or checklist item is closed when it is done or
 * cancelled, and open while it is still to do or merely scheduled.
 *
 * Everything else — bullets, headings, prose — is neutral: it is never
 * closed and never open, so it neither blocks nor triggers either feature.
 */

const CHECKBOX_RE = /^(\s*)([-*+])(\s\[)[ xX>-](\]\s)/;
const PRIORITY_RE = /^(\s*[-*+]\s\[[ xX>-]\]\s)(!{1,3})\s/;

const STATE_CHARS: Record<TaskState, string> = {
    done: 'x',
    cancelled: '-',
    scheduled: '>',
    open: ' ',
};

/** A task or checklist item that is finished. */
export function isClosed(line: ParsedLine): boolean {
    return (
        (line.kind === 'task' || line.kind === 'checklist') &&
        (line.state === 'done' || line.state === 'cancelled')
    );
}

/** A task or checklist item that is still to do. */
export function isOpen(line: ParsedLine): boolean {
    return (
        (line.kind === 'task' || line.kind === 'checklist') &&
        (line.state === 'open' || line.state === 'scheduled')
    );
}

/** Open tasks and checklist items nested under a line, at any depth. */
export function openDescendants(
    lines: ParsedLine[],
    index: number,
): ParsedLine[] {
    return childrenOf(lines, index).filter(isOpen);
}

/**
 * Closed ancestors of a line, innermost first — the lines that have to
 * re-open with it, since a subtree holding an open item isn't finished.
 */
export function closedAncestors(
    lines: ParsedLine[],
    index: number,
): ParsedLine[] {
    const ancestors: ParsedLine[] = [];
    let parent = lines[index]?.parent ?? null;

    while (parent !== null) {
        const line = lines[parent];

        if (!line) {
            break;
        }

        if (isClosed(line)) {
            ancestors.push(line);
        }

        parent = line.parent;
    }

    return ancestors;
}

/**
 * Rewrite a task or checklist line's checkbox, leaving indentation, marker
 * and body untouched. Closing strips any !/!!/!!! priority — it is
 * meaningless once the item is finished, mirroring what the editor and the
 * store already do on completion. A line without a checkbox is returned
 * unchanged.
 */
export function withTaskState(raw: string, state: TaskState): string {
    if (!CHECKBOX_RE.test(raw)) {
        return raw;
    }

    const next = raw.replace(CHECKBOX_RE, `$1$2$3${STATE_CHARS[state]}$4`);

    return state === 'done' || state === 'cancelled'
        ? next.replace(PRIORITY_RE, '$1')
        : next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run resources/js/core/subtreeState.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Check types and lint, then commit**

```bash
npm run types:check && npx eslint resources/js/core/subtreeState.ts resources/js/core/subtreeState.test.ts
git add resources/js/core/subtreeState.ts resources/js/core/subtreeState.test.ts
git commit -m "Tasks: shared rules for when a subtree is finished"
```

---

### Task 2: Cascade completion through the editor and the store

**Files:**
- Modify: `resources/js/stores/prompt.ts` (add `cancelLabel` to `ConfirmOptions`)
- Modify: `resources/js/components/notes/ConfirmDialog.vue:33-38` (render it)
- Modify: `resources/js/components/editor/markdownExtensions.ts` (`setTaskState`, ~line 2227)
- Modify: `resources/js/stores/workspace.ts` (`toggleTaskLine`, ~line 969)
- Test: `resources/js/components/editor/editorLineActions.test.ts`

**Interfaces:**
- Consumes: `isClosed`, `isOpen`, `openDescendants`, `closedAncestors`, `withTaskState` from Task 1; `confirmAction` from `@/stores/prompt`; `parseNote` from `@/core/parser`.
- Produces: no new exports. `setTaskState(view, pos, nextState)` and `toggleTaskLine(noteId, lineIndex)` keep their signatures and gain the cascade.

Cascade rules (from the spec): closing a line re-opens nothing, but **asks** before closing open descendants; re-opening a line silently re-opens every closed ancestor in the same edit.

- [ ] **Step 1: Write the failing test**

Append to `resources/js/components/editor/editorLineActions.test.ts` (inside the existing `describe('editorLineActions', …)`):

```ts
    it('re-opens closed ancestors when a nested item is re-opened', () => {
        const doc = [
            '- [x] Prepare release',
            '    - [x] Update the docs',
            '        + [x] Proofread',
        ].join('\n');
        // Cursor on the innermost checklist item.
        const view = makeView(doc, doc.length - 2);
        run(view, 'complete'); // done → open

        expect(view.doc).toBe(
            [
                '- [ ] Prepare release',
                '    - [ ] Update the docs',
                '        + [ ] Proofread',
            ].join('\n'),
        );
    });

    it('leaves ancestors alone when the re-opened item has none that are closed', () => {
        const doc = ['- [ ] Prepare release', '    - [x] Update the docs'].join(
            '\n',
        );
        const view = makeView(doc, doc.length - 2);
        run(view, 'complete');

        expect(view.doc).toBe(
            ['- [ ] Prepare release', '    - [ ] Update the docs'].join('\n'),
        );
    });

    it('closes only the line itself until the cascade is confirmed', () => {
        const doc = ['- [ ] Prepare release', '    - [ ] Write changelog'].join(
            '\n',
        );
        const view = makeView(doc, 8); // on the parent
        run(view, 'complete');

        // The dialog resolves asynchronously; the immediate edit is the
        // single line, so the click always feels instant.
        expect(view.doc).toBe(
            ['- [x] Prepare release', '    - [ ] Write changelog'].join('\n'),
        );
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run resources/js/components/editor/editorLineActions.test.ts`
Expected: FAIL — the first test still shows `- [x] Prepare release` and `- [x] Update the docs`.

- [ ] **Step 3: Add `cancelLabel` to the confirm dialog**

In `resources/js/stores/prompt.ts`, extend the interface:

```ts
export interface ConfirmOptions {
    title: string;
    message?: string;
    confirmLabel?: string;
    /** Label for the dismiss button, when "Cancel" would read wrong. */
    cancelLabel?: string;
    /** Destructive actions render the confirm button in red. */
    destructive?: boolean;
}
```

In `resources/js/components/notes/ConfirmDialog.vue`, replace the literal `Cancel` in the ghost button's body with:

```vue
                    {{ confirmState.cancelLabel ?? 'Cancel' }}
```

- [ ] **Step 4: Cascade in the editor**

In `resources/js/components/editor/markdownExtensions.ts`, add to the imports (after the `@/core/priority` import, keeping alphabetical order):

```ts
import {
    closedAncestors,
    isClosed,
    openDescendants,
    withTaskState,
} from '@/core/subtreeState';
```

and add `parseNote` to the existing `@/core/parser` import:

```ts
import { COMMENT_RE, parseLine, parseNote } from '@/core/parser';
```

and `confirmAction` from the store (next to the `openDatePicker` import):

```ts
import { confirmAction } from '@/stores/prompt';
```

Add these helpers immediately above `export function setTaskState`:

```ts
/**
 * Re-opening an item re-opens everything it sits under: a subtree holding
 * an open item isn't finished. Silent and part of the same transaction —
 * it corrects an inconsistent state rather than making a bulk change.
 */
function reopenAncestorChanges(
    view: EditorView,
    lineNumber: number,
): { from: number; to: number; insert: string }[] {
    const lines = parseNote(view.state.doc.toString());

    return closedAncestors(lines, lineNumber - 1).map((ancestor) => {
        const line = view.state.doc.line(ancestor.index + 1);

        return {
            from: line.from,
            to: line.to,
            insert: withTaskState(line.text, 'open'),
        };
    });
}

/**
 * Closing an item that still holds open ones asks whether they should close
 * too. The line itself is already written by the time this runs, so the
 * click feels instant and "Just this one" simply does nothing further.
 */
async function confirmCascadeClose(
    view: EditorView,
    lineNumber: number,
    state: 'done' | 'cancelled',
): Promise<void> {
    const lines = parseNote(view.state.doc.toString());
    const target = lines[lineNumber - 1];
    const open = openDescendants(lines, lineNumber - 1);

    if (!target || open.length === 0) {
        return;
    }

    const verb = state === 'done' ? 'complete' : 'cancel';
    const count = `${open.length} item${open.length === 1 ? '' : 's'}`;

    const confirmed = await confirmAction({
        title: `Also ${verb} the ${count} inside?`,
        message: `“${target.title}” has ${count} still open nested under it.`,
        confirmLabel: state === 'done' ? 'Complete all' : 'Cancel all',
        cancelLabel: 'Just this one',
    });

    if (!confirmed) {
        return;
    }

    view.dispatch({
        changes: open.map((item) => {
            const line = view.state.doc.line(item.index + 1);

            return {
                from: line.from,
                to: line.to,
                insert: withTaskState(line.text, state),
            };
        }),
    });
}
```

Then, inside `setTaskState`, replace the final `view.dispatch({ changes });` and `return true;` with:

```ts
    if (nextState === 'open') {
        changes.push(...reopenAncestorChanges(view, line.number));
    }

    view.dispatch({ changes });

    if (nextState === 'done' || nextState === 'cancelled') {
        void confirmCascadeClose(view, line.number, nextState);
    }

    return true;
}
```

`reopenAncestorChanges` must run *before* the dispatch (it reads the pre-change doc, and ancestors never overlap the target line's ranges). `confirmCascadeClose` runs after, so it sees the closed line.

- [ ] **Step 5: Cascade in the store**

In `resources/js/stores/workspace.ts`, add the imports:

```ts
import { closedAncestors, openDescendants, withTaskState } from '@/core/subtreeState';
import { confirmAction } from '@/stores/prompt';
```

In `toggleTaskLine`, replace the checkbox rewrite and the priority strip (the block from `const nextChar = …` through the `if (completing) { … }` priority replacement) with a call into the shared helper, and add the cascades:

```ts
    const completing = line.state !== 'done';
    rawLines[lineIndex] = withTaskState(
        rawLines[lineIndex],
        completing ? 'done' : 'open',
    );

    // Re-opening an item re-opens everything it sits under.
    if (!completing) {
        for (const ancestor of closedAncestors(parsed, lineIndex)) {
            rawLines[ancestor.index] = withTaskState(
                rawLines[ancestor.index],
                'open',
            );
        }
    }
```

Then, immediately before the existing `await updateNoteContent(noteId, rawLines.join('\n'));`, add the cascade prompt:

```ts
    const open = completing ? openDescendants(parsed, lineIndex) : [];

    await updateNoteContent(noteId, rawLines.join('\n'));

    if (open.length === 0) {
        return;
    }

    const count = `${open.length} item${open.length === 1 ? '' : 's'}`;
    const confirmed = await confirmAction({
        title: `Also complete the ${count} inside?`,
        message: `“${line.title}” has ${count} still open nested under it.`,
        confirmLabel: 'Complete all',
        cancelLabel: 'Just this one',
    });

    if (!confirmed) {
        return;
    }

    const latest = notes.get(noteId);

    if (!latest) {
        return;
    }

    // Re-read: the note may have changed while the dialog was open (a repeat
    // occurrence was inserted above, or a sync pull landed).
    const after = latest.content.split('\n');
    const afterParsed = parsedNote(noteId);

    for (const item of openDescendants(afterParsed, lineIndex)) {
        after[item.index] = withTaskState(after[item.index], 'done');
    }

    await updateNoteContent(noteId, after.join('\n'));
```

Keep the existing repeat-occurrence block exactly where it is, before the first `updateNoteContent`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run resources/js/components/editor/editorLineActions.test.ts`
Expected: PASS. The third test passes because the dialog is awaited outside the synchronous edit.

Run: `npx vitest run` — expected: all suites pass.

- [ ] **Step 7: Check types and lint, then commit**

```bash
npm run types:check && npx eslint resources/js
git add resources/js/core resources/js/stores resources/js/components
git commit -m "Tasks: closing an item offers to close what's inside it"
```

---

### Task 3: Done section anatomy — find, create, and describe a path

**Files:**
- Modify: `resources/js/core/parser.ts` (move `FOLD_MARKER_RE` here)
- Modify: `resources/js/components/editor/markdownExtensions.ts:1942` (import it instead of declaring it)
- Create: `resources/js/core/doneSection.ts`
- Create: `resources/js/core/doneSection.test.ts`

**Interfaces:**
- Consumes: `parseNote`, `ParsedLine`, `FOLD_MARKER_RE` from `@/core/parser`.
- Produces:
  - `DONE_HEADING_RE: RegExp` — matches a `# Done` line, fold marker and all
  - `findDoneHeading(raw: string[]): number` — 0-based index, or -1
  - `PathStep` — `{ kind: 'heading'; level: number; text: string } | { kind: 'bullet'; raw: string; text: string }`
  - `pathOf(lines: ParsedLine[], index: number, from: number): PathStep[]`
  - `renderStep(step: PathStep, depth: number, demote: boolean): string`

`FOLD_MARKER_RE` moves into the parser because it is part of this app's markdown dialect (NotePlan's trailing ` …`), and both the editor and `core/` now need it. `markdownExtensions.ts` keeps re-exporting it so nothing else has to change.

- [ ] **Step 1: Write the failing test**

Create `resources/js/core/doneSection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseNote } from './parser';
import {
    DONE_HEADING_RE,
    findDoneHeading,
    pathOf,
    renderStep,
} from './doneSection';

describe('DONE_HEADING_RE', () => {
    it('matches the section heading, with or without the fold marker', () => {
        expect(DONE_HEADING_RE.test('# Done')).toBe(true);
        expect(DONE_HEADING_RE.test('# Done …')).toBe(true);
        expect(DONE_HEADING_RE.test('# done')).toBe(true);
    });

    it('does not match a heading that merely mentions done', () => {
        expect(DONE_HEADING_RE.test('## Done')).toBe(false);
        expect(DONE_HEADING_RE.test('# Done deals')).toBe(false);
        expect(DONE_HEADING_RE.test('    # Done')).toBe(false);
        expect(DONE_HEADING_RE.test('- [ ] Done')).toBe(false);
    });
});

describe('findDoneHeading', () => {
    it('finds the last one, so an earlier mention never wins', () => {
        const raw = ['# Done', 'text', '---', '# Done …'];

        expect(findDoneHeading(raw)).toBe(3);
    });

    it('returns -1 when the note has no section', () => {
        expect(findDoneHeading(['# Launch', '- [x] a'])).toBe(-1);
    });
});

describe('pathOf', () => {
    const NOTE = [
        '# Launch',
        '## Prep',
        '### Copy',
        '- Meeting notes',
        '    - [x] Write the announcement',
        '# Research',
        '- [x] Read the teardown',
        '- [ ] Skim the docs',
    ].join('\n');

    it('collects the heading trail outermost first, one per level', () => {
        const lines = parseNote(NOTE);

        expect(pathOf(lines, 6, -1)).toEqual([
            { kind: 'heading', level: 1, text: 'Research' },
        ]);
    });

    it('includes bullet ancestors after the headings', () => {
        const lines = parseNote(NOTE);

        expect(pathOf(lines, 4, -1)).toEqual([
            { kind: 'heading', level: 1, text: 'Launch' },
            { kind: 'heading', level: 2, text: 'Prep' },
            { kind: 'heading', level: 3, text: 'Copy' },
            { kind: 'bullet', raw: '- Meeting notes', text: 'Meeting notes' },
        ]);
    });

    it('is empty for a line under nothing', () => {
        const lines = parseNote(['- [x] Loose task'].join('\n'));

        expect(pathOf(lines, 0, -1)).toEqual([]);
    });

    it('stops at the line the search starts from', () => {
        // Reading a path inside the Done section must not escape into the
        // body's headings above it.
        const lines = parseNote(
            ['# Launch', '---', '# Done', '## Research', '- [ ] Reopened'].join(
                '\n',
            ),
        );

        expect(pathOf(lines, 4, 2)).toEqual([
            { kind: 'heading', level: 2, text: 'Research' },
        ]);
    });
});

describe('renderStep', () => {
    it('demotes a heading one level when writing into Done', () => {
        expect(renderStep({ kind: 'heading', level: 1, text: 'Launch' }, 0, true)).toBe(
            '## Launch',
        );
        expect(renderStep({ kind: 'heading', level: 3, text: 'Copy' }, 0, true)).toBe(
            '#### Copy',
        );
    });

    it('clamps at h6, which cannot demote further', () => {
        expect(
            renderStep({ kind: 'heading', level: 6, text: 'Deep' }, 0, true),
        ).toBe('###### Deep');
    });

    it('writes the level as-is when lifting back into the body', () => {
        expect(
            renderStep({ kind: 'heading', level: 2, text: 'Prep' }, 0, false),
        ).toBe('## Prep');
    });

    it('indents a bullet by its depth and keeps its text verbatim', () => {
        const step = { kind: 'bullet' as const, raw: '- Meeting notes', text: 'Meeting notes' };

        expect(renderStep(step, 0, true)).toBe('- Meeting notes');
        expect(renderStep(step, 2, true)).toBe('        - Meeting notes');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run resources/js/core/doneSection.test.ts`
Expected: FAIL — cannot resolve `./doneSection`.

- [ ] **Step 3: Move `FOLD_MARKER_RE` into the parser**

In `resources/js/core/parser.ts`, add next to `SYNC_ID_RE` (~line 73):

```ts
/** NotePlan marks a collapsed line with a trailing " …"; folds ride in the text. */
export const FOLD_MARKER_RE = /[ \t]…[ \t]*$/;
```

In `resources/js/components/editor/markdownExtensions.ts`, delete the local declaration at line 1942 and re-export the parser's instead, so existing importers keep working:

```ts
export { FOLD_MARKER_RE } from '@/core/parser';
```

Add `FOLD_MARKER_RE` to the existing value import from `@/core/parser` as well, since the file uses it directly:

```ts
import { COMMENT_RE, FOLD_MARKER_RE, parseLine, parseNote } from '@/core/parser';
```

- [ ] **Step 4: Write the implementation**

Create `resources/js/core/doneSection.ts`:

```ts
import { FOLD_MARKER_RE, parseNote } from './parser';
import type { ParsedLine } from './parser';

/**
 * The `# Done` section: an archive at the end of a note holding work that is
 * finished, with the heading and bullet structure it came from rebuilt inside
 * it so a project's shape survives its tasks being completed.
 *
 * Everything here is plain markdown. The section is found by its heading text
 * alone — no state is stored anywhere else — and its collapsed state is the
 * ordinary fold marker, so it travels with the note like every other fold.
 */

/** The heading that opens the section, fold marker and all. */
export const DONE_HEADING_RE = /^#[ \t]+done(?:[ \t]*…)?[ \t]*$/i;

/** The section's own heading line, written collapsed. */
export const DONE_HEADING_LINE = '# Done …';

const INDENT = '    ';

/**
 * Index of the note's Done heading among raw lines, or -1. The *last* match
 * wins: a note may mention "# Done" earlier, and only the trailing section is
 * the archive.
 */
export function findDoneHeading(raw: string[]): number {
    for (let index = raw.length - 1; index >= 0; index--) {
        if (DONE_HEADING_RE.test(raw[index])) {
            return index;
        }
    }

    return -1;
}

/** Heading text with the persisted fold marker removed. */
export function headingText(line: ParsedLine): string {
    return line.title.replace(FOLD_MARKER_RE, '').trim();
}

/** One rung of the trail leading to a line. */
export type PathStep =
    | { kind: 'heading'; level: number; text: string }
    | { kind: 'bullet'; raw: string; text: string };

/**
 * The trail leading to a line: the column-0 headings enclosing it, outermost
 * first, then the bullets it hangs under. `from` bounds the search, so a path
 * read inside the Done section never escapes into the body above it.
 *
 * Heading levels are always the body's own levels; demotion happens when the
 * step is rendered, not when it is read.
 */
export function pathOf(
    lines: ParsedLine[],
    index: number,
    from: number,
): PathStep[] {
    const headings: PathStep[] = [];
    let minLevel = Number.POSITIVE_INFINITY;

    for (let i = index - 1; i > from; i--) {
        const line = lines[i];

        if (line.kind !== 'heading' || line.indent !== 0) {
            continue;
        }

        const level = line.headingLevel ?? 1;

        if (level >= minLevel) {
            continue;
        }

        headings.unshift({ kind: 'heading', level, text: headingText(line) });
        minLevel = level;

        if (level === 1) {
            break;
        }
    }

    const bullets: PathStep[] = [];
    let parent = lines[index]?.parent ?? null;

    while (parent !== null) {
        const line = lines[parent];

        if (!line) {
            break;
        }

        if (line.kind === 'bullet') {
            bullets.unshift({
                kind: 'bullet',
                raw: line.raw.trim(),
                text: line.title.trim(),
            });
        }

        parent = line.parent;
    }

    return [...headings, ...bullets];
}

/**
 * Write a step as a line. Headings drop a level on the way into Done so they
 * nest under its h1 instead of ending the section (h6 has nowhere to go and
 * stays put); bullets are reproduced verbatim at their nesting depth.
 */
export function renderStep(
    step: PathStep,
    depth: number,
    demote: boolean,
): string {
    if (step.kind === 'bullet') {
        return INDENT.repeat(depth) + step.raw;
    }

    const level = demote ? Math.min(6, step.level + 1) : step.level;

    return `${'#'.repeat(level)} ${step.text}`;
}
```

`from` is **exclusive**: callers pass `-1` for the body, so line 0 is still searched, and the Done heading's own index when reading a path inside the section, so the walk stops there instead of escaping into the body's headings.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run resources/js/core/doneSection.test.ts`
Expected: PASS (13 tests).

Run: `npx vitest run` — expected: all suites pass, including the editor's, which still sees `FOLD_MARKER_RE`.

- [ ] **Step 6: Check types and lint, then commit**

```bash
npm run types:check && npx eslint resources/js
git add resources/js/core resources/js/components/editor/markdownExtensions.ts
git commit -m "Done section: find the section and describe a line's path"
```

---

### Task 4: Which blocks move

**Files:**
- Modify: `resources/js/core/doneSection.ts`
- Modify: `resources/js/core/doneSection.test.ts`

**Interfaces:**
- Consumes: `isClosed`, `isOpen` from `@/core/subtreeState`.
- Produces:
  - `Block` — `{ start: number; end: number }`, inclusive line indexes
  - `blockEnd(lines: ParsedLine[], index: number): number`
  - `movableBlocks(lines: ParsedLine[], limit: number): Block[]`
  - `liftableBlocks(lines: ParsedLine[], doneStart: number): Block[]`

- [ ] **Step 1: Write the failing test**

Append to `resources/js/core/doneSection.test.ts`:

```ts
describe('movableBlocks', () => {
    /** Titles of the lines each block covers, for readable assertions. */
    function moved(note: string): string[][] {
        const lines = parseNote(note);

        return movableBlocks(lines, lines.length).map((block) =>
            lines
                .slice(block.start, block.end + 1)
                .map((line) => line.title || line.raw),
        );
    }

    it('moves a closed task whose subtree is closed', () => {
        expect(moved(['- [x] Tag v1.0', '- [ ] Ship it'].join('\n'))).toEqual([
            ['Tag v1.0'],
        ]);
    });

    it('treats cancelled as closed and scheduled as open', () => {
        expect(moved(['- [-] Dropped', '- [>] Later'].join('\n'))).toEqual([
            ['Dropped'],
        ]);
    });

    it('keeps a closed parent that still holds open work', () => {
        expect(
            moved(
                [
                    '- [x] Prepare release',
                    '    - [ ] Write changelog',
                    '    - [x] Update the docs',
                ].join('\n'),
            ),
        ).toEqual([]);
    });

    it('keeps a closed subtask under an open parent', () => {
        expect(
            moved(['- [ ] Prepare release', '    - [x] Update the docs'].join('\n')),
        ).toEqual([]);
    });

    it('takes the whole subtree when the outermost line qualifies', () => {
        expect(
            moved(
                [
                    '- [x] Prepare release',
                    '    - [x] Update the docs',
                    '        context',
                    '    + [-] Proofread',
                ].join('\n'),
            ),
        ).toEqual([
            ['Prepare release', 'Update the docs', 'context', 'Proofread'],
        ]);
    });

    it('moves a closed task under a bullet — bullets are neutral', () => {
        expect(
            moved(['- Meeting notes', '    - [x] Write the announcement'].join('\n')),
        ).toEqual([['Write the announcement']]);
    });

    it('stops at the limit, so the Done section is never re-filed', () => {
        const note = ['- [x] Body task', '---', '# Done', '- [x] Filed'].join('\n');
        const lines = parseNote(note);

        expect(movableBlocks(lines, 1)).toEqual([{ start: 0, end: 0 }]);
    });
});

describe('liftableBlocks', () => {
    it('lifts an outermost re-opened item with its subtree', () => {
        const note = [
            '# Launch',
            '---',
            '# Done',
            '## Launch',
            '- [ ] Write changelog',
            '    - [x] Draft it',
            '- [x] Tag v1.0',
        ].join('\n');
        const lines = parseNote(note);

        expect(liftableBlocks(lines, 2)).toEqual([{ start: 4, end: 5 }]);
    });

    it('leaves a closed section alone', () => {
        const note = ['---', '# Done', '- [x] Tag v1.0'].join('\n');

        expect(liftableBlocks(parseNote(note), 1)).toEqual([]);
    });
});
```

Add `liftableBlocks` and `movableBlocks` to the file's import from `./doneSection`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run resources/js/core/doneSection.test.ts`
Expected: FAIL — `movableBlocks is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `resources/js/core/doneSection.ts` (and add the import at the top):

```ts
import { isClosed, isOpen } from './subtreeState';
```

```ts
/** A contiguous run of lines that moves as one: a line and everything under it. */
export interface Block {
    start: number;
    end: number;
}

/**
 * Last line of a line's block. Blank lines inside a nested run are carried
 * along, but trailing ones are not — the block ends at its last real content.
 */
export function blockEnd(lines: ParsedLine[], index: number): number {
    const base = lines[index].indent;
    let end = index;

    for (let i = index + 1; i < lines.length; i++) {
        const line = lines[i];

        if (line.kind === 'empty') {
            continue;
        }

        if (line.indent <= base) {
            break;
        }

        end = i;
    }

    return end;
}

/** Does a task or checklist item sit anywhere above this line? */
function hasTaskAncestor(lines: ParsedLine[], index: number): boolean {
    let parent = lines[index]?.parent ?? null;

    while (parent !== null) {
        const line = lines[parent];

        if (!line) {
            return false;
        }

        if (line.kind === 'task' || line.kind === 'checklist') {
            return true;
        }

        parent = line.parent;
    }

    return false;
}

/** Is everything nested under this line finished? */
function subtreeClosed(lines: ParsedLine[], index: number): boolean {
    const end = blockEnd(lines, index);

    for (let i = index + 1; i <= end; i++) {
        if (isOpen(lines[i])) {
            return false;
        }
    }

    return true;
}

/**
 * The blocks to file into Done: closed lines whose whole subtree is closed
 * and which hang under no task at all.
 *
 * The ancestor rule has to exclude closed ancestors too, not just open ones.
 * A done parent with one done and one open child cannot move — its subtree
 * isn't finished — so its done child mustn't move either, or it would be torn
 * out of a block that is still live. Nothing is lost: when an ancestor is
 * itself movable, it is reached first and takes the child along.
 *
 * `limit` bounds the scan (the Done heading's index, or the line count), so
 * work already filed is never filed again.
 */
export function movableBlocks(lines: ParsedLine[], limit: number): Block[] {
    const blocks: Block[] = [];
    let index = 0;

    while (index < limit) {
        const line = lines[index];

        if (
            isClosed(line) &&
            !hasTaskAncestor(lines, index) &&
            subtreeClosed(lines, index)
        ) {
            const end = Math.min(blockEnd(lines, index), limit - 1);
            blocks.push({ start: index, end });
            index = end + 1;
            continue;
        }

        index++;
    }

    return blocks;
}

/**
 * The blocks to lift back out of Done: items that have been re-opened. The
 * outermost open line is the unit — re-opening a child re-opens its ancestors,
 * so an open descendant always implies an open ancestor.
 */
export function liftableBlocks(
    lines: ParsedLine[],
    doneStart: number,
): Block[] {
    const blocks: Block[] = [];
    let index = doneStart + 1;

    while (index < lines.length) {
        const line = lines[index];

        if (isOpen(line) && !hasTaskAncestor(lines, index)) {
            const end = blockEnd(lines, index);
            blocks.push({ start: index, end });
            index = end + 1;
            continue;
        }

        index++;
    }

    return blocks;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run resources/js/core/doneSection.test.ts`
Expected: PASS (22 tests).

- [ ] **Step 5: Check types and lint, then commit**

```bash
npm run types:check && npx eslint resources/js/core
git add resources/js/core
git commit -m "Done section: decide which blocks move, in each direction"
```

---

### Task 5: Filing down — insert under a path, merging groups

**Files:**
- Modify: `resources/js/core/doneSection.ts`
- Modify: `resources/js/core/doneSection.test.ts`

**Interfaces:**
- Produces:
  - `ensureDoneSection(content: string): string`
  - `insertUnderPath(content: string, path: PathStep[], block: string[], target: 'done' | 'body'): string`

`insertUnderPath` re-parses the content it is handed, so callers can apply blocks one at a time without tracking index shifts.

- [ ] **Step 1: Write the failing test**

Append to `resources/js/core/doneSection.test.ts`:

```ts
describe('ensureDoneSection', () => {
    it('appends a collapsed section with a separator', () => {
        expect(ensureDoneSection('# Launch\n- [ ] Ship it')).toBe(
            ['# Launch', '- [ ] Ship it', '', '---', '# Done …', ''].join('\n'),
        );
    });

    it('adopts a section the note already has', () => {
        const content = ['# Launch', '', '---', '# Done …', '- [x] a'].join('\n');

        expect(ensureDoneSection(content)).toBe(content);
    });
});

describe('insertUnderPath', () => {
    const BASE = ['# Launch', '- [ ] Ship it', '', '---', '# Done …', ''].join(
        '\n',
    );

    it('rebuilds a missing heading path, demoted, and appends the block', () => {
        const next = insertUnderPath(
            BASE,
            [{ kind: 'heading', level: 1, text: 'Launch' }],
            ['- [x] Tag v1.0'],
            'done',
        );

        expect(next.split('\n')).toEqual([
            '# Launch',
            '- [ ] Ship it',
            '',
            '---',
            '# Done …',
            '## Launch',
            '- [x] Tag v1.0',
        ]);
    });

    it('merges into a group that is already there', () => {
        const once = insertUnderPath(
            BASE,
            [{ kind: 'heading', level: 1, text: 'Launch' }],
            ['- [x] Tag v1.0'],
            'done',
        );
        const twice = insertUnderPath(
            once,
            [{ kind: 'heading', level: 1, text: 'Launch' }],
            ['- [x] Write the docs'],
            'done',
        );

        expect(twice.split('\n').slice(4)).toEqual([
            '# Done …',
            '## Launch',
            '- [x] Tag v1.0',
            '- [x] Write the docs',
        ]);
    });

    it('nests a deeper path under the group it belongs to', () => {
        const once = insertUnderPath(
            BASE,
            [{ kind: 'heading', level: 1, text: 'Launch' }],
            ['- [x] Tag v1.0'],
            'done',
        );
        const twice = insertUnderPath(
            once,
            [
                { kind: 'heading', level: 1, text: 'Launch' },
                { kind: 'heading', level: 3, text: 'Copy' },
            ],
            ['- [x] Write the announcement'],
            'done',
        );

        expect(twice.split('\n').slice(4)).toEqual([
            '# Done …',
            '## Launch',
            '- [x] Tag v1.0',
            '#### Copy',
            '- [x] Write the announcement',
        ]);
    });

    it('reproduces a bullet ancestor and indents the block under it', () => {
        const next = insertUnderPath(
            BASE,
            [
                { kind: 'heading', level: 1, text: 'Launch' },
                { kind: 'bullet', raw: '- Meeting notes', text: 'Meeting notes' },
            ],
            ['    - [x] Write the announcement'],
            'done',
        );

        expect(next.split('\n').slice(4)).toEqual([
            '# Done …',
            '## Launch',
            '- Meeting notes',
            '    - [x] Write the announcement',
        ]);
    });

    it('puts a path-less block directly under the heading', () => {
        const next = insertUnderPath(BASE, [], ['- [x] Loose task'], 'done');

        expect(next.split('\n').slice(4)).toEqual(['# Done …', '- [x] Loose task']);
    });

    it('inserts into the body above the Done section when lifting out', () => {
        const next = insertUnderPath(
            BASE,
            [{ kind: 'heading', level: 1, text: 'Launch' }],
            ['- [ ] Write changelog'],
            'body',
        );

        expect(next.split('\n')).toEqual([
            '# Launch',
            '- [ ] Ship it',
            '- [ ] Write changelog',
            '',
            '---',
            '# Done …',
            '',
        ]);
    });

    it('recreates a heading the body no longer has', () => {
        const next = insertUnderPath(
            BASE,
            [{ kind: 'heading', level: 2, text: 'Research' }],
            ['- [ ] Read the teardown'],
            'body',
        );

        expect(next.split('\n')).toEqual([
            '# Launch',
            '- [ ] Ship it',
            '## Research',
            '- [ ] Read the teardown',
            '',
            '---',
            '# Done …',
            '',
        ]);
    });
});
```

Add `ensureDoneSection` and `insertUnderPath` to the test file's imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run resources/js/core/doneSection.test.ts`
Expected: FAIL — `ensureDoneSection is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `resources/js/core/doneSection.ts`:

```ts
/** Give the note a Done section if it hasn't got one, collapsed by default. */
export function ensureDoneSection(content: string): string {
    if (findDoneHeading(content.split('\n')) !== -1) {
        return content;
    }

    return `${content.replace(/\s+$/, '')}\n\n---\n${DONE_HEADING_LINE}\n`;
}

/** Last line of a heading's group: up to the next heading of the same level or higher. */
function headingGroupEnd(
    lines: ParsedLine[],
    index: number,
    end: number,
): number {
    const level = lines[index].headingLevel ?? 1;

    for (let i = index + 1; i <= end; i++) {
        const line = lines[i];

        if (
            line.kind === 'heading' &&
            line.indent === 0 &&
            (line.headingLevel ?? 1) <= level
        ) {
            return i - 1;
        }
    }

    return end;
}

/** The line a step already occupies within `[from, end]`, or -1. */
function findStep(
    lines: ParsedLine[],
    step: PathStep,
    from: number,
    end: number,
    depth: number,
    demote: boolean,
): number {
    const level =
        step.kind === 'heading'
            ? demote
                ? Math.min(6, step.level + 1)
                : step.level
            : 0;

    for (let i = from; i <= end; i++) {
        const line = lines[i];

        if (step.kind === 'heading') {
            if (
                line.kind === 'heading' &&
                line.indent === 0 &&
                (line.headingLevel ?? 1) === level &&
                headingText(line).toLowerCase() === step.text.toLowerCase()
            ) {
                return i;
            }
        } else if (
            line.kind === 'bullet' &&
            line.indent === depth * 4 &&
            line.title.trim() === step.text
        ) {
            return i;
        }
    }

    return -1;
}

/** Re-indent a block to sit at `depth`, keeping its lines' relative nesting. */
function reindent(block: string[], depth: number): string[] {
    const parsed = parseNote(block.join('\n'));
    const base = parsed[0]?.indent ?? 0;

    if (depth === 0 && base === 0) {
        return block;
    }

    return block.map((raw, index) => {
        const line = parsed[index];

        if (line.kind === 'empty') {
            return '';
        }

        const relative = Math.max(0, line.indent - base);

        return INDENT.repeat(depth) + ' '.repeat(relative) + raw.trimStart();
    });
}

/**
 * Insert a block under its path, creating only the rungs that are missing and
 * appending it at the end of the group it lands in, so filing order holds.
 *
 * `target` picks the region and the heading levels: 'done' writes below the
 * section heading with headings demoted, 'body' writes above it with the
 * levels the body uses.
 */
export function insertUnderPath(
    content: string,
    path: PathStep[],
    block: string[],
    target: 'done' | 'body',
): string {
    const raw = content.split('\n');
    const lines = parseNote(content);
    const doneStart = findDoneHeading(raw);
    const demote = target === 'done';

    let from = demote ? doneStart + 1 : 0;
    let end =
        demote || doneStart === -1
            ? lines.length - 1
            : Math.max(0, doneStart - 1);
    let depth = 0;
    let step = 0;

    for (; step < path.length; step++) {
        const found = findStep(lines, path[step], from, end, depth, demote);

        if (found === -1) {
            break;
        }

        end =
            path[step].kind === 'heading'
                ? headingGroupEnd(lines, found, end)
                : blockEnd(lines, found);
        from = found + 1;

        if (path[step].kind === 'bullet') {
            depth++;
        }
    }

    const created: string[] = [];

    for (let i = step; i < path.length; i++) {
        created.push(renderStep(path[i], depth, demote));

        if (path[i].kind === 'bullet') {
            depth++;
        }
    }

    // Land after the group's last real line, never after its trailing blanks.
    let at = end + 1;

    while (at > from && raw[at - 1] !== undefined && raw[at - 1].trim() === '') {
        at--;
    }

    raw.splice(at, 0, ...created, ...reindent(block, depth));

    return raw.join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run resources/js/core/doneSection.test.ts`
Expected: PASS (31 tests).

- [ ] **Step 5: Check types and lint, then commit**

```bash
npm run types:check && npx eslint resources/js/core
git add resources/js/core
git commit -m "Done section: insert a block under its path, merging groups"
```

---

### Task 6: The whole transform, both directions

**Files:**
- Modify: `resources/js/core/doneSection.ts`
- Modify: `resources/js/core/doneSection.test.ts`

**Interfaces:**
- Produces:
  - `refileCompleted(content: string): string`
  - `hasFileableWork(content: string): boolean`

- [ ] **Step 1: Write the failing test**

Append to `resources/js/core/doneSection.test.ts`:

```ts
describe('refileCompleted', () => {
    it('files closed work under a rebuilt, demoted path', () => {
        const note = [
            '# Launch',
            '- [ ] Ship the thing',
            '- [x] Tag v1.0',
            '',
            '### Copy',
            '- [x] Write the announcement',
        ].join('\n');

        expect(refileCompleted(note).split('\n')).toEqual([
            '# Launch',
            '- [ ] Ship the thing',
            '',
            '### Copy',
            '',
            '---',
            '# Done …',
            '## Launch',
            '- [x] Tag v1.0',
            '#### Copy',
            '- [x] Write the announcement',
        ]);
    });

    it('leaves a note with nothing to file byte for byte alone', () => {
        const note = [
            '---',
            'type: project',
            '---',
            '# Launch',
            '- [ ] Ship it',
            '    - [x] Sub-step under an open parent',
            '',
            '```js',
            'const done = true;',
            '```',
            '| a | b |',
            '| - | - |',
        ].join('\n');

        expect(refileCompleted(note)).toBe(note);
        expect(hasFileableWork(note)).toBe(false);
    });

    it('merges a second run into the groups the first one made', () => {
        const once = refileCompleted(
            ['# Launch', '- [x] Tag v1.0', '- [ ] Ship it'].join('\n'),
        );
        const twice = refileCompleted(once.replace('- [ ] Ship it', '- [x] Ship it'));

        expect(twice.split('\n').slice(-3)).toEqual([
            '## Launch',
            '- [x] Tag v1.0',
            '- [x] Ship it',
        ]);
    });

    it('lifts a re-opened item back out and clears the group it left', () => {
        const note = [
            '# Launch',
            '- [ ] Ship it',
            '',
            '---',
            '# Done …',
            '## Launch',
            '- [ ] Write changelog',
        ].join('\n');

        expect(refileCompleted(note).split('\n')).toEqual([
            '# Launch',
            '- [ ] Ship it',
            '- [ ] Write changelog',
        ]);
    });

    it('keeps sync ids and fold markers on the lines it moves', () => {
        const note = [
            '# Launch',
            '- [x] Tag v1.0 ^abc123',
            '- [x] Prepare release …',
            '    - [x] Update the docs',
        ].join('\n');
        const filed = refileCompleted(note);

        expect(filed).toContain('- [x] Tag v1.0 ^abc123');
        expect(filed).toContain('- [x] Prepare release …');
        expect(filed).toContain('    - [x] Update the docs');
    });

    it('reports whether there is anything to do', () => {
        expect(hasFileableWork('- [x] Tag v1.0')).toBe(true);
        expect(hasFileableWork('- [ ] Ship it')).toBe(false);
        expect(
            hasFileableWork(['---', '# Done', '- [ ] Reopened'].join('\n')),
        ).toBe(true);
    });
});
```

Add `hasFileableWork` and `refileCompleted` to the test file's imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run resources/js/core/doneSection.test.ts`
Expected: FAIL — `refileCompleted is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `resources/js/core/doneSection.ts`:

```ts
/** A block lifted out of the note, with the trail it has to land under. */
interface Move {
    path: PathStep[];
    block: string[];
    target: 'done' | 'body';
}

/** Read the moves a note needs, in both directions. */
function planMoves(content: string): Move[] {
    const raw = content.split('\n');
    const lines = parseNote(content);
    const doneStart = findDoneHeading(raw);
    const limit = doneStart === -1 ? lines.length : doneStart;
    const moves: Move[] = [];

    for (const block of movableBlocks(lines, limit)) {
        moves.push({
            path: pathOf(lines, block.start, -1),
            block: raw.slice(block.start, block.end + 1),
            target: 'done',
        });
    }

    if (doneStart !== -1) {
        for (const block of liftableBlocks(lines, doneStart)) {
            moves.push({
                path: pathOf(lines, block.start, doneStart).map((step) =>
                    step.kind === 'heading'
                        ? { ...step, level: Math.max(1, step.level - 1) }
                        : step,
                ),
                block: raw.slice(block.start, block.end + 1),
                target: 'body',
            });
        }
    }

    return moves;
}

/** Is there any closed work to file, or any re-opened work to lift back out? */
export function hasFileableWork(content: string): boolean {
    return planMoves(content).length > 0;
}

/** Drop the lines a set of blocks covers, back to front so indexes hold. */
function removeBlocks(raw: string[], blocks: Block[]): string[] {
    const next = [...raw];

    for (const block of [...blocks].sort((a, b) => b.start - a.start)) {
        next.splice(block.start, block.end - block.start + 1);
    }

    return next;
}

/**
 * Strip rebuilt groups inside Done that no longer hold anything, and the
 * section itself once it is empty. Body headings are never touched — they are
 * the user's, not ours.
 */
function pruneDone(content: string): string {
    let raw = content.split('\n');

    for (;;) {
        const lines = parseNote(raw.join('\n'));
        const doneStart = findDoneHeading(raw);

        if (doneStart === -1) {
            return raw.join('\n');
        }

        const empty = (from: number, to: number): boolean =>
            lines
                .slice(from, to + 1)
                .every((line) => line.kind === 'empty');

        let removed = false;

        for (let i = doneStart + 1; i < lines.length; i++) {
            const line = lines[i];
            const end =
                line.kind === 'heading' && line.indent === 0
                    ? headingGroupEnd(lines, i, lines.length - 1)
                    : line.kind === 'bullet'
                      ? blockEnd(lines, i)
                      : -1;

            if (end !== -1 && empty(i + 1, end)) {
                raw.splice(i, end - i + 1);
                removed = true;
                break;
            }
        }

        if (removed) {
            continue;
        }

        // An empty section takes its separator and blank line with it.
        if (empty(doneStart + 1, lines.length - 1)) {
            let from = doneStart;

            if (raw[from - 1]?.trim() === '---') {
                from--;
            }

            while (from > 0 && raw[from - 1].trim() === '') {
                from--;
            }

            raw = raw.slice(0, from);
        }

        return raw.join('\n');
    }
}

/**
 * File every finished block into the Done section and lift every re-opened
 * one back out, rebuilding the heading and bullet trail each block belongs
 * under. Everything the moves don't touch is left exactly as it was.
 */
export function refileCompleted(content: string): string {
    const moves = planMoves(content);

    if (moves.length === 0) {
        return content;
    }

    const raw = content.split('\n');
    const lines = parseNote(content);
    const doneStart = findDoneHeading(raw);
    const limit = doneStart === -1 ? lines.length : doneStart;
    const removals = [
        ...movableBlocks(lines, limit),
        ...(doneStart === -1 ? [] : liftableBlocks(lines, doneStart)),
    ];

    let next = removeBlocks(raw, removals).join('\n');

    if (moves.some((move) => move.target === 'done')) {
        next = ensureDoneSection(next);
    }

    for (const move of moves) {
        next = insertUnderPath(next, move.path, move.block, move.target);
    }

    return pruneDone(next);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run resources/js/core/doneSection.test.ts`
Expected: PASS (37 tests).

Run: `npx vitest run` — expected: every suite passes.

- [ ] **Step 5: Check types and lint, then commit**

```bash
npm run types:check && npx eslint resources/js/core
git add resources/js/core
git commit -m "Done section: file finished work down and re-opened work back up"
```

---

### Task 7: The menu action

**Files:**
- Modify: `resources/js/stores/workspace.ts` (new `fileCompletedToDone`)
- Modify: `resources/js/components/notes/NotePane.vue` (dropdown item, ~line 555-589)

**Interfaces:**
- Consumes: `refileCompleted`, `hasFileableWork` from `@/core/doneSection`; `updateNoteContent` from the store.
- Produces: `fileCompletedToDone(noteId: string): Promise<boolean>` — true when the note was rewritten.

- [ ] **Step 1: Add the store action**

In `resources/js/stores/workspace.ts`, add the import:

```ts
import { hasFileableWork, refileCompleted } from '@/core/doneSection';
```

and the action, next to `toggleTaskLine`:

```ts
/**
 * File the note's finished work into its Done section (and lift re-opened
 * work back out). Returns false when there was nothing to do, so the caller
 * can say so rather than writing an empty section.
 */
export async function fileCompletedToDone(noteId: string): Promise<boolean> {
    const note = notes.get(noteId);

    if (!note || !hasFileableWork(note.content)) {
        return false;
    }

    await updateNoteContent(noteId, refileCompleted(note.content));

    return true;
}
```

- [ ] **Step 2: Add the menu item**

In `resources/js/components/notes/NotePane.vue`, add `ArchiveRestore` to the `@lucide/vue` import, `fileCompletedToDone` to the `@/stores/workspace` import, and `toast` from `vue-sonner`. Add the handler next to `togglePin`:

```ts
async function moveCompletedToDone(): Promise<void> {
    if (!note.value) {
        return;
    }

    const filed = await fileCompletedToDone(note.value.id);

    if (!filed) {
        toast('Nothing to file — no completed work outside Done.');
    }
}
```

Add the item to the dropdown, after the "Connections graph" entry:

```vue
                            <DropdownMenuItem
                                v-if="!readOnly"
                                @select="moveCompletedToDone"
                            >
                                <ArchiveRestore class="size-4" /> Move completed
                                to Done
                            </DropdownMenuItem>
```

`readOnly` already exists in this component (`!canEditNote(access, online)`).

- [ ] **Step 3: Verify by hand in the running app**

Run `npm run dev` (or ask the user to). Open a note with completed tasks under headings and pick "Move completed to Done". Expect: a `---` + collapsed `# Done …` stripe at the end; expanding it shows the rebuilt, demoted headings; ⌘Z undoes the whole move in one step; running it again with nothing to file shows the toast.

- [ ] **Step 4: Check types and lint, then commit**

```bash
npm run types:check && npx eslint resources/js
git add resources/js/stores/workspace.ts resources/js/components/notes/NotePane.vue
git commit -m "Notes: move completed work to the Done section from the menu"
```

---

### Task 8: The section's look in the editor

**Files:**
- Modify: `resources/js/components/editor/markdownExtensions.ts` (decoration ~line 738-760, theme ~line 3388)

**Interfaces:**
- Consumes: `DONE_HEADING_RE` from `@/core/doneSection`.
- Produces: no exports; a `cm-done-section` line class from the Done heading to the end of the note.

- [ ] **Step 1: Add the decoration**

Add the import:

```ts
import { DONE_HEADING_RE } from '@/core/doneSection';
```

Declare the decoration next to `frontMatterLine` (~line 516):

```ts
const doneSectionLine = Decoration.line({ class: 'cm-done-section' });

/** Line number (1-based) where the note's Done section starts, or -1. */
function doneSectionStart(state: EditorState): number {
    for (let n = state.doc.lines; n >= 1; n--) {
        if (DONE_HEADING_RE.test(state.doc.line(n).text)) {
            return n;
        }
    }

    return -1;
}
```

In `buildDecorations`, compute it once next to `fmEnd`:

```ts
    const doneStart = doneSectionStart(state);
```

and add the line decoration at the top of the per-line loop, immediately *after* the front-matter branch's closing brace and before any other `builder.add` for that line — `RangeSetBuilder` needs positions in ascending order, and line decorations at the same position must come before that line's tokens:

```ts
        if (doneStart !== -1 && lineNumber >= doneStart) {
            builder.add(line.from, line.from, doneSectionLine);
        }
```

- [ ] **Step 2: Style it**

In the theme object, next to `.cm-frontmatter` (~line 3388):

```ts
    // The archive at the end of a note: present, but clearly not the work.
    '.cm-done-section': {
        backgroundColor:
            'color-mix(in oklab, var(--muted) 60%, transparent)',
        color: 'var(--muted-foreground)',
    },
```

- [ ] **Step 3: Verify by hand**

With the app running, expand the Done section: its lines carry a subtle tint distinguishing them from the note body, in both light and dark themes. Collapsed, the `# Done …` line reads as a single tinted stripe under the separator.

- [ ] **Step 4: Check types and lint, run everything, then commit**

```bash
npm run types:check && npx eslint resources/js && npx vitest run
git add resources/js/components/editor/markdownExtensions.ts
git commit -m "Editor: tint the Done section so it reads as an archive"
```

---

## Notes for the implementer

- **Do not** run `prettier --write` on any existing file: the repo is not Prettier-clean and it produces large unrelated diffs. New files should be written Prettier-clean by hand.
- `parseNote` is cheap (a split plus a regex pass per line) and `insertUnderPath` re-parses deliberately, so blocks can be applied one at a time without index bookkeeping. Don't optimise this away without a measurement.
- If a test fights the implementation, re-read the spec's filing rules before changing either. The rules are load-bearing for both features and were chosen together.
