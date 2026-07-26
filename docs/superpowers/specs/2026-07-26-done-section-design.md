# Done section & subtree completion — design

Date: 2026-07-26

## Problem

Completed and cancelled tasks accumulate in long-lived notes, especially where
repeating tasks generate a fresh copy on every completion. The finished work
buries the live work, and a project's structure stops being readable.

Hiding completed lines in the editor was considered before and rejected: the
note is a plain-text document that the user edits directly, and hiding lines
makes cursor movement, selection and editing finicky.

NotePlan's answer — "move completed to the bottom", under a `## Done` heading —
loses the position each task held, so the project's shape is gone once things
are done. Things 3 keeps completed work grouped under the headings it came
from. This design takes the Things approach and expresses it in markdown.

A sibling gap surfaces from the same rules: closing a parent leaves its
children open, and re-opening a child leaves ancestors marked done.

## What we're building

Two features that share one notion of "this subtree is finished":

1. **Move completed to Done** — a note-dropdown action that files closed work
   into a collapsed `# Done` section at the end of the note, rebuilding the
   heading and bullet structure it sat under, and lifting re-opened items back
   out.
2. **Subtree completion** — closing a task with open children offers to close
   them too; re-opening any descendant re-opens its ancestors.

Both are markdown-only: no new fields, no index, nothing stored outside the
note's text.

## Definitions

- **Closed** — a task or checklist item in state `done` or `cancelled`.
- **Open** — state `open` or `scheduled` (`- [>]`).
- **Neutral** — anything that is not a task or checklist item: bullets,
  headings, prose, tables, code.
- **Path** — the trail leading to a line: the column-0 headings enclosing it
  (outermost first) plus its list ancestors from the parser's `parent` chain.

## The Done section

Plain markdown at the very end of the note:

```markdown
# Launch
- [ ] Ship the thing
- [x] Prepare release        ← stays: it has an open child
    - [ ] Write changelog

### Copy
- [ ] Draft the email

---
# Done …
## Launch
- [x] Tag v1.0
#### Copy
- [x] Write the announcement
## Research
- [x] Read the competitor teardown
```

**Recognition.** The last column-0 `# Done` heading in the note, matched
case-insensitively on the text `Done` with the fold marker ignored. The
section runs from that line to the end of the note. A `---` directly above it
(with at most one blank line between) is absorbed into the marker, so repeat
runs never stack separators. A `# Done` heading the user wrote themselves is
adopted rather than duplicated. Renaming the heading detaches it: the section
is identified purely by its text, with no state hidden anywhere else.

**Creation.** When absent, the section is appended as a blank line, `---`,
then `# Done …`.

**Collapsed by default.** The trailing ` …` is the existing NotePlan-compatible
fold marker. Writing it into the text is what makes the section come back
collapsed — `applyPersistedFolds` re-folds on open and after external replaces
— and the collapsed state travels across devices like every other fold.

**Why h1 + demotion.** The fold service ends a column-0 heading's section at
the next column-0 heading of the same or higher level. A rebuilt `# Launch`
inside Done would therefore terminate the Done section. Every rebuilt heading
is demoted one level (`h1→h2`, `h3→h4`, h6 unchanged) so it nests inside Done
and stays foldable on its own. Relative depth is preserved rather than
normalised: an `h1 → h3` gap in the body reproduces as `h2 → h4`. A note that
nests an h6 under an h5 produces two sibling h6 groups — an accepted edge case.

## Filing rules

### What moves down

A line moves into Done when all of these hold:

- it is a task or checklist item, and it is **closed**;
- every descendant of it is closed or neutral;
- **it has no task or checklist ancestor at all.**

The last clause is what keeps a completed subtask under an unfinished parent in
place: it belongs to live work, and moving it alone would break the hierarchy
in both places. It has to exclude *closed* ancestors too, not just open ones —
consider a done parent with one done and one open child. The parent can't move
(its subtree isn't finished), so its done child mustn't move either, or it
would be torn out of a block that is still live. And nothing is lost by the
stricter rule: when an ancestor *is* movable, it moves first and takes the
child with it.

When a line qualifies, its **whole subtree** moves with it — including neutral
descendants (notes, bullets) — and its descendants are not considered
separately. Blocks are therefore maximal: if a closed parent qualifies, it
moves and takes its closed children along as one block.

Bullet ancestors are neutral: they can never move, so a closed task nested
under a bullet is filed under a **copy** of that bullet inside Done.

### What moves up

Within the Done section, any outermost task or checklist item that is **open**
moves back into the body, taking its subtree with it. Cascade-up (below)
guarantees that an open descendant implies open ancestors, so the outermost
open line is the right unit.

### Placement

Moving down, the line's path is rebuilt inside Done: headings demoted, bullet
ancestors reproduced verbatim, and only what is missing is created. Moving up,
the same path is matched against the body — headings un-demoted — and a
missing heading is recreated at the end of the note body (above the Done
marker).

**Matching** is by heading level and trimmed text, and by trimmed text for
bullets. A moved block is appended at the end of its matching group, so
filing order is preserved. Two body headings that share a level and text
collapse into one group inside Done — text is all the path carries, and
duplicate headings are ambiguous to the reader for the same reason.

**Lines with no path** — closed tasks at the top of a note under no heading —
are placed directly under `# Done`, with nothing rebuilt above them.

**Cleanup.** A rebuilt group left empty inside Done is removed. If Done itself
ends up empty, the section and its `---` are removed. Headings in the body are
never removed — they are the user's.

**Everything else is preserved byte for byte:** front matter, prose, tables,
code blocks, blank lines, sync ids (`^abc123`), and fold markers on lines that
did not move. Lines already inside Done are not re-filed.

### Interactions

- **Repeating tasks.** Completing one generates the next occurrence in place;
  the completed copy files itself away and the new occurrence stays in the
  body. This is the accumulation case that motivated the feature.
- **Note progress** counts task lines wherever they sit, so filing does not
  change a note's progress ring.
- **Tasks view, reminders, backlinks** read the same parsed lines and are
  unaffected: closed tasks were already filtered out of open-task lists.

## Subtree completion

One shared rule, so the editor, the Tasks view and reminder popups behave
identically.

**Down — asks.** Closing a task or checklist item (to `done` or `cancelled`)
that has open descendants: the line closes immediately, then a dialog reports
the count and offers **Complete all** / **Just this one**. "Complete all"
applies the same closing state to every open descendant as a follow-up edit;
descendants already cancelled keep their state. "Just this one" leaves the
mixed subtree alone, which the filing rules then decline to move — the two
features agree by construction.

Only the line the user acted on generates a repeat occurrence. A cascaded
`@repeat` child is marked done without spawning a next instance inside a
subtree being closed out.

**Up — silent.** Re-opening any descendant re-opens every ancestor above it
that was closed. No prompt: it corrects an inconsistent state rather than
making a bulk change, and it is the same "nothing inside is open" test the
filing rules use. Checklist items count — one rule, not two.

## Editor treatment

- A `Decoration.line` class (`cm-done-section`) on every line from the `# Done`
  heading to the end of the note gives the section a subtle background and
  muted text, mirroring what `cm-frontmatter` already does for front matter.
- Collapsed, that is a single tinted stripe under the `---`. The fold and its
  persistence are entirely the existing mechanism; nothing new is needed.

## Components

Pure markdown logic lives in `core/`, where this app keeps its dialect and
where tests need no DOM.

| Unit | Responsibility |
| --- | --- |
| `core/subtreeState.ts` | Open descendants of a line; ancestors needing re-opening; applying a closing state to a subtree. Pure, over `ParsedLine[]`. |
| `core/doneSection.ts` | Find/create the section; compute and render a path; demote/un-demote; merge; the two-directional re-file over a note's text. Pure, `string → string`. |
| `stores/workspace.ts` | `fileCompletedToDone(noteId)` — run the transform, hand the result to `updateNoteContent`. |
| `stores/workspace.ts` (`toggleTaskLine`), `editor/markdownExtensions.ts` (`setTaskState`) | Call into `subtreeState.ts` instead of each growing its own copy of the rule. |
| `components/notes/NotePane.vue` | The dropdown item, the confirm dialog wiring, and the empty-case toast. |
| `components/editor/markdownExtensions.ts` | The `cm-done-section` decoration. |

`ConfirmOptions` gains an optional `cancelLabel` so the dialog can say "Just
this one" instead of "Cancel".

## Data flow

```
menu item → fileCompletedToDone(noteId)
          → doneSection.refile(content)        pure
          → updateNoteContent(id, next)        existing path: dirty, sync, editor
          → editor replaces doc, re-applies folds → Done comes back collapsed
```

Closing a task:

```
editor / tasks view → subtreeState.close(lines, index, state)
                    → write the line
                    → openDescendants(lines, index) non-empty?
                        → confirmAction(…) → close the subtree in a second edit
```

Re-opening:

```
→ subtreeState.reopen(lines, index) → line + every closed ancestor, one edit
```

## Error handling

- Filing with nothing to move: no write, a toast saying so.
- A note whose Done section was hand-edited into something unparseable is
  treated as ordinary content; the next run creates a fresh section rather than
  attempting repair.
- Read-only notes (read shares, write shares while offline): the menu item is
  hidden, matching how the editor already gates edits.
- The transform is total — any input yields valid markdown — so there is no
  partial-failure state. It runs on the client only; the server stores whatever
  text it receives.

## Testing

Vitest against the pure modules carries the weight:

- **Filing down**: mixed subtree stays put; closed subtask under an open parent
  stays; maximal blocks (closed parent takes closed children); bullet ancestor
  reproduced; heading path rebuilt and demoted; h6 clamp; un-pathed lines;
  cancelled treated as closed; `scheduled` treated as open.
- **Merging**: a second run appends into existing groups without duplicating
  them; filing order preserved.
- **Filing up**: a re-opened item lifts back out under its matching heading;
  a missing heading is recreated; emptied groups and an emptied section are
  removed.
- **Preservation**: front matter, code blocks, tables, sync ids and untouched
  fold markers survive byte for byte; a note with no closed tasks is returned
  unchanged.
- **Subtree completion**: open-descendant counting across depths; cascade
  closes only open descendants; cancelled descendants keep their state;
  re-opening re-opens all closed ancestors and stops there; checklist items
  count in both directions.

Cascade behaviour from the editor gets cases in the existing
`editorLineActions` suite. The store action and the dropdown are thin wiring
over tested pure functions and are verified by hand in the running app.

## Out of scope

- Automatic filing (on open, or on a timer after completion). The menu action
  proves the rules first; automation can be layered on later.
- Moving filed items back to their exact original position — the path is what
  is preserved, not the index within a group.
- Any server-side counterpart. Filing is a user action in the app, and its
  result syncs as ordinary content.
