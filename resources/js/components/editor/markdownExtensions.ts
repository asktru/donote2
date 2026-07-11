import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import type {
    CompletionContext,
    CompletionResult,
} from '@codemirror/autocomplete';
import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
} from '@codemirror/commands';
import {
    markdown,
    markdownKeymap,
    markdownLanguage,
} from '@codemirror/lang-markdown';
import {
    codeFolding,
    foldGutter,
    foldKeymap,
    foldService,
    indentUnit,
    syntaxHighlighting,
    syntaxTree,
    HighlightStyle,
} from '@codemirror/language';
import {
    EditorSelection,
    RangeSetBuilder,
    StateField,
} from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { tags } from '@lezer/highlight';

import { todayDailyKey } from '@/core/dates';
import { COMMENT_RE, parseLine } from '@/core/parser';
import type { ParsedLine, Priority, TaskState } from '@/core/parser';
import { buildNextOccurrenceLine } from '@/core/repeat';
import { generateSyncId } from '@/core/syncedLines';

export interface EditorCallbacks {
    /** Open a wiki link target ([[Title]] or [[2026-07-11]]). */
    onOpenLink: (target: string, split: boolean) => void;
    /** Open a calendar note for a >date token. */
    onOpenDate: (dateKey: string, split: boolean) => void;
    /** Open a tag or mention view. */
    onOpenTag: (tag: string, split: boolean) => void;
    onOpenMention: (mention: string, split: boolean) => void;
    /** Titles for [[ autocompletion. */
    getNoteTitles: () => string[];
    getTags: () => string[];
    getMentions: () => string[];
}

/* ------------------------------------------------------------------ */
/* Widgets                                                             */
/* ------------------------------------------------------------------ */

class CheckboxWidget extends WidgetType {
    constructor(
        private kind: 'task' | 'checklist',
        private state: TaskState,
        private priority: Priority,
    ) {
        super();
    }

    eq(other: CheckboxWidget): boolean {
        return (
            other.kind === this.kind &&
            other.state === this.state &&
            other.priority === this.priority
        );
    }

    toDOM(): HTMLElement {
        const box = document.createElement('span');
        box.className = `cm-check cm-check-${this.kind} cm-check-${this.state} cm-check-p${this.priority}`;
        box.setAttribute('role', 'checkbox');
        box.setAttribute(
            'aria-checked',
            this.state === 'done' ? 'true' : 'false',
        );
        box.title =
            this.kind === 'task' ? 'Toggle task (⌘⏎)' : 'Toggle checklist item';

        if (this.state === 'done') {
            box.textContent = '✓';
        } else if (this.state === 'cancelled') {
            box.textContent = '✕';
        } else if (this.state === 'scheduled') {
            box.textContent = '›';
        }

        return box;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

class BulletDotWidget extends WidgetType {
    eq(): boolean {
        return true;
    }

    toDOM(): HTMLElement {
        const dot = document.createElement('span');
        dot.className = 'cm-bullet-dot';
        dot.textContent = '•';

        return dot;
    }
}

class SyncGlyphWidget extends WidgetType {
    constructor(private id: string) {
        super();
    }

    eq(other: SyncGlyphWidget): boolean {
        return other.id === this.id;
    }

    toDOM(): HTMLElement {
        const glyph = document.createElement('span');
        glyph.className = 'cm-sync-glyph';
        glyph.textContent = '⟲';
        glyph.title = `Synced line ^${this.id} — editing updates every copy`;

        return glyph;
    }
}

/* ------------------------------------------------------------------ */
/* Line decorations                                                    */
/* ------------------------------------------------------------------ */

const MARKER_RE = /^(\s*)([-*+]\s\[[ xX>-]\]\s)/;
const BULLET_MARKER_RE = /^(\s*)([-*+])\s(?!\[[ xX>-]\]\s)/;
const HEADING_MARKER_RE = /^(#{1,6})\s/;
const SCHEDULE_TOKEN_RE =
    />(\d{4}-\d{2}-\d{2}|\d{4}-W\d{1,2}|\d{4}-Q[1-4]|\d{4}-\d{2}|\d{4}|today)\b/g;
const META_TOKEN_RE = /@(?:due|repeat)\([^)]*\)/g;
const REMINDER_TOKEN_RE = /@\d{1,2}(?::\d{2})?(?:am|pm)?(?![\w(])/gi;
const TAG_TOKEN_RE = /(^|[^\w#&])(#[A-Za-z][\w/-]*)/g;
const MENTION_TOKEN_RE = /(^|[^\w@.])(@[A-Za-z][\w/.-]*)/g;
const WIKI_TOKEN_RE = /\[\[([^\]|\n]+?)(?:\s*\|\s*([^\]\n]*?))?\]\]/g;
const PRIORITY_TOKEN_RE = /^(\s*[-*+]\s\[[ xX>-]\]\s)(!{1,3})(?=\s)/;
const SYNC_TOKEN_RE = /\s(\^[a-z0-9]{4,12})\s*$/;

/** Syntax-tree node names whose text is pure markdown punctuation. */
const HIDDEN_MARK_NODES = new Set([
    'EmphasisMark',
    'CodeMark',
    'StrikethroughMark',
    'LinkMark',
    'URL',
]);

interface TokenDecoration {
    from: number;
    to: number;
    decoration: Decoration;
}

function selectionTouches(
    state: EditorState,
    from: number,
    to: number,
): boolean {
    for (const range of state.selection.ranges) {
        if (range.from <= to && range.to >= from) {
            return true;
        }
    }

    return false;
}

const hideDecoration = Decoration.replace({});
/**
 * Ancestor list-item indents per line (1-based), mirroring the parser's
 * nesting rules: headings reset, empty lines carry no guides (breaking the
 * visual run) while the surrounding structure survives them.
 */
function computeGuideLevels(state: EditorState, fmEnd: number): number[][] {
    const doc = state.doc;
    const levels: number[][] = new Array(doc.lines + 2).fill([]) as number[][];
    const stack: number[] = [];

    for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
        if (fmEnd !== -1 && lineNumber <= fmEnd) {
            continue;
        }

        const parsed = parseLine(doc.line(lineNumber).text);

        if (parsed.kind === 'heading') {
            stack.length = 0;
            continue;
        }

        if (parsed.kind === 'empty') {
            continue;
        }

        while (stack.length > 0 && stack[stack.length - 1] >= parsed.indent) {
            stack.pop();
        }

        levels[lineNumber] = [...stack];

        if (
            parsed.kind === 'task' ||
            parsed.kind === 'checklist' ||
            parsed.kind === 'bullet'
        ) {
            stack.push(parsed.indent);
        }
    }

    return levels;
}

/**
 * Char offset of the given indent width inside a line's leading whitespace
 * (tabs count as width 4), or null when the width falls inside a tab.
 */
function indentWidthToOffset(text: string, width: number): number | null {
    let current = 0;

    for (let offset = 0; offset < text.length; offset++) {
        if (current === width) {
            return offset;
        }

        const char = text[offset];

        if (char !== ' ' && char !== '\t') {
            return null;
        }

        current += char === '\t' ? 4 : 1;
    }

    return null;
}
const frontMatterLine = Decoration.line({ class: 'cm-frontmatter' });

/** End line (1-based) of a leading --- front matter block, or -1. */
function frontMatterEnd(state: EditorState): number {
    const doc = state.doc;

    if (doc.lines < 2 || doc.line(1).text.trim() !== '---') {
        return -1;
    }

    for (let index = 2; index <= Math.min(doc.lines, 50); index++) {
        if (doc.line(index).text.trim() === '---') {
            return index;
        }
    }

    return -1;
}

/* ------------------------------------------------------------------ */
/* Folding: front matter, heading sections, nested list children       */
/* ------------------------------------------------------------------ */

const donoteFoldService = foldService.of((state, lineStart) => {
    const line = state.doc.lineAt(lineStart);

    // Front matter block folds from the opening --- down to the closing ---.
    if (line.number === 1) {
        const fmEnd = frontMatterEnd(state);

        if (fmEnd > 1) {
            return { from: line.to, to: state.doc.line(fmEnd).to };
        }
    }

    const parsed = parseLine(line.text);

    // A heading folds everything until the next heading of the same or a
    // higher level.
    if (parsed.kind === 'heading') {
        const level = parsed.headingLevel ?? 1;
        let end = line.to;
        let sawContent = false;

        for (let n = line.number + 1; n <= state.doc.lines; n++) {
            const next = state.doc.line(n);
            const nextParsed = parseLine(next.text);

            if (
                nextParsed.kind === 'heading' &&
                (nextParsed.headingLevel ?? 1) <= level
            ) {
                break;
            }

            end = next.to;

            if (next.text.trim() !== '') {
                sawContent = true;
            }
        }

        return sawContent && end > line.to ? { from: line.to, to: end } : null;
    }

    // Tasks, checklists and bullets fold their indented children block.
    if (
        parsed.kind === 'task' ||
        parsed.kind === 'checklist' ||
        parsed.kind === 'bullet'
    ) {
        const end = endOfChildrenBlock(state, line.number, parsed.indent);

        return end > line.to ? { from: line.to, to: end } : null;
    }

    return null;
});

/**
 * Collect markdown punctuation (emphasis, code, strikethrough and link
 * marks) that should be hidden, grouped by line — hidden only while the
 * cursor is elsewhere (live preview).
 */
function collectSyntaxMarks(
    state: EditorState,
): Map<number, TokenDecoration[]> {
    const byLine = new Map<number, TokenDecoration[]>();

    syntaxTree(state).iterate({
        enter: (node) => {
            if (!HIDDEN_MARK_NODES.has(node.name)) {
                return;
            }

            const line = state.doc.lineAt(node.from);
            const list = byLine.get(line.number) ?? [];
            list.push({
                from: node.from,
                to: Math.min(node.to, line.to),
                decoration: hideDecoration,
            });
            byLine.set(line.number, list);
        },
    });

    return byLine;
}

function buildDecorations(state: EditorState): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = state.doc;
    const syntaxMarks = collectSyntaxMarks(state);
    const fmEnd = frontMatterEnd(state);
    const guideLevels = computeGuideLevels(state, fmEnd);

    for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
        const line = doc.line(lineNumber);

        // Front matter block: dim it and skip all other decorations.
        if (fmEnd !== -1 && lineNumber <= fmEnd) {
            builder.add(line.from, line.from, frontMatterLine);
            continue;
        }

        const parsed = parseLine(line.text);
        const revealed = selectionTouches(state, line.from, line.to);
        const tokens: TokenDecoration[] = [];

        // Indentation guides: one widened segment per ancestor level. The
        // guide line runs from the center of a run's first line to the
        // center of its last line, fading out at both ends.
        const ancestors = guideLevels[lineNumber];

        for (let level = 0; level < ancestors.length; level++) {
            const ancestorIndent = ancestors[level];
            const boundary =
                level + 1 < ancestors.length
                    ? ancestors[level + 1]
                    : parsed.indent;
            const fromOffset = indentWidthToOffset(line.text, ancestorIndent);
            const toOffset = indentWidthToOffset(line.text, boundary);

            if (
                fromOffset === null ||
                toOffset === null ||
                toOffset <= fromOffset
            ) {
                continue;
            }

            const isFirst =
                !guideLevels[lineNumber - 1]?.includes(ancestorIndent);
            const isLast =
                !guideLevels[lineNumber + 1]?.includes(ancestorIndent);

            tokens.push({
                from: line.from + fromOffset,
                to: line.from + toOffset,
                decoration: Decoration.mark({
                    class: [
                        'cm-indent-guide',
                        isFirst ? 'cm-indent-guide-first' : '',
                        isLast ? 'cm-indent-guide-last' : '',
                    ]
                        .filter(Boolean)
                        .join(' '),
                }),
            });
        }

        // Wiki tokens get bespoke hiding below; drop the markdown parser's
        // own LinkMark/URL marks inside them so both don't fight over ranges.
        const wikiSpans: [number, number][] = [];

        for (const match of line.text.matchAll(WIKI_TOKEN_RE)) {
            wikiSpans.push([
                line.from + match.index,
                line.from + match.index + match[0].length,
            ]);
        }

        const insideWiki = (from: number, to: number): boolean =>
            wikiSpans.some(([start, end]) => from >= start && to <= end);

        if (parsed.kind === 'task' || parsed.kind === 'checklist') {
            const marker = line.text.match(MARKER_RE);

            if (marker) {
                const from = line.from + marker[1].length;
                const to = from + marker[2].length;

                if (parsed.state === 'done' || parsed.state === 'cancelled') {
                    builder.add(
                        line.from,
                        line.from,
                        Decoration.line({ class: `cm-line-${parsed.state}` }),
                    );
                }

                if (!selectionTouches(state, from, to)) {
                    tokens.push({
                        from,
                        to: to - 1,
                        decoration: Decoration.replace({
                            widget: new CheckboxWidget(
                                parsed.kind,
                                parsed.state ?? 'open',
                                parsed.priority,
                            ),
                        }),
                    });
                }
            }

            const priority = line.text.match(PRIORITY_TOKEN_RE);

            if (priority) {
                const from = line.from + priority[1].length;
                tokens.push({
                    from,
                    to: from + priority[2].length,
                    decoration: Decoration.mark({
                        class: `cm-priority cm-priority-${priority[2].length}`,
                    }),
                });
            }
        }

        if (parsed.kind === 'heading' && !revealed) {
            const marker = line.text.match(HEADING_MARKER_RE);

            if (marker) {
                tokens.push({
                    from: line.from,
                    to: line.from + marker[0].length,
                    decoration: hideDecoration,
                });
            }
        }

        if (parsed.kind === 'bullet' && !revealed) {
            const marker = line.text.match(BULLET_MARKER_RE);

            if (marker) {
                const from = line.from + marker[1].length;
                tokens.push({
                    from,
                    to: from + 1,
                    decoration: Decoration.replace({
                        widget: new BulletDotWidget(),
                    }),
                });
            }
        }

        if (!revealed) {
            for (const mark of syntaxMarks.get(lineNumber) ?? []) {
                if (insideWiki(mark.from, mark.to)) {
                    continue;
                }

                tokens.push(mark);
            }
        }

        {
            const comment = line.text.match(COMMENT_RE);

            if (comment && comment.index !== undefined) {
                tokens.push({
                    from: line.from + comment.index + comment[1].length,
                    to: line.to,
                    decoration: Decoration.mark({ class: 'cm-line-comment' }),
                });
            }
        }

        for (const match of line.text.matchAll(SCHEDULE_TOKEN_RE)) {
            tokens.push({
                from: line.from + match.index,
                to: line.from + match.index + match[0].length,
                decoration: Decoration.mark({
                    class: 'cm-date-link',
                    attributes: {
                        'data-date-key': match[1],
                        title: 'Click to open · ⌥-click for split · ⌘⏎',
                    },
                }),
            });
        }

        for (const match of line.text.matchAll(META_TOKEN_RE)) {
            tokens.push({
                from: line.from + match.index,
                to: line.from + match.index + match[0].length,
                decoration: Decoration.mark({ class: 'cm-meta-pill' }),
            });
        }

        for (const match of line.text.matchAll(REMINDER_TOKEN_RE)) {
            tokens.push({
                from: line.from + match.index,
                to: line.from + match.index + match[0].length,
                decoration: Decoration.mark({
                    class: 'cm-meta-pill cm-reminder',
                }),
            });
        }

        {
            const sync = line.text.match(SYNC_TOKEN_RE);

            if (sync && sync.index !== undefined) {
                const tokenFrom = line.from + sync.index + 1;
                const tokenTo = line.from + line.text.length;

                tokens.push({
                    from: revealed ? tokenFrom : line.from + sync.index,
                    to: tokenTo,
                    decoration: revealed
                        ? Decoration.mark({ class: 'cm-sync-id' })
                        : Decoration.replace({
                              widget: new SyncGlyphWidget(sync[1].slice(1)),
                          }),
                });
            }
        }

        for (const match of line.text.matchAll(TAG_TOKEN_RE)) {
            const start = line.from + match.index + match[1].length;
            tokens.push({
                from: start,
                to: start + match[2].length,
                decoration: Decoration.mark({
                    class: 'cm-hashtag',
                    attributes: {
                        'data-tag': match[2].slice(1),
                        title: 'Click to open · ⌥-click for split · ⌘⏎',
                    },
                }),
            });
        }

        for (const match of line.text.matchAll(MENTION_TOKEN_RE)) {
            const name = match[2].slice(1);

            if (
                ['due', 'repeat'].includes(name.toLowerCase()) ||
                /^\d/.test(name)
            ) {
                continue;
            }

            const start = line.from + match.index + match[1].length;
            tokens.push({
                from: start,
                to: start + match[2].length,
                decoration: Decoration.mark({
                    class: 'cm-mention',
                    attributes: {
                        'data-mention': name,
                        title: 'Click to open · ⌥-click for split · ⌘⏎',
                    },
                }),
            });
        }

        for (const match of line.text.matchAll(WIKI_TOKEN_RE)) {
            const target = match[1].trim();

            if (target === '') {
                continue;
            }

            const from = line.from + match.index;
            const to = from + match[0].length;
            const linkAttributes = {
                'data-wiki-target': target,
                title: 'Click to open · ⌥-click for split · ⌘⏎',
            };

            if (revealed) {
                tokens.push({
                    from,
                    to,
                    decoration: Decoration.mark({
                        class: 'cm-wikilink',
                        attributes: linkAttributes,
                    }),
                });
                continue;
            }

            // Live preview: hide [[ ]], and for [[target|display]] hide the
            // target and pipe so only the display text remains visible.
            const display = match[2]?.trim() ?? '';
            const visibleLength =
                display !== '' ? match[2].length : match[1].length;
            const visibleFrom = to - 2 - visibleLength;

            tokens.push({
                from,
                to: visibleFrom,
                decoration: hideDecoration,
            });
            tokens.push({
                from: visibleFrom,
                to: to - 2,
                decoration: Decoration.mark({
                    class: 'cm-wikilink',
                    attributes: linkAttributes,
                }),
            });
            tokens.push({ from: to - 2, to, decoration: hideDecoration });
        }

        tokens.sort((a, b) => a.from - b.from || a.to - b.to);

        let lastEnd = -1;

        for (const token of tokens) {
            if (token.from < lastEnd) {
                continue;
            }

            builder.add(token.from, token.to, token.decoration);
            lastEnd = token.to;
        }
    }

    return builder.finish();
}

const decorationsField = StateField.define<DecorationSet>({
    create: buildDecorations,
    update(value, transaction) {
        if (transaction.docChanged || transaction.selection) {
            return buildDecorations(transaction.state);
        }

        return value;
    },
    provide: (field) => EditorView.decorations.from(field),
});

/* ------------------------------------------------------------------ */
/* Task toggling                                                       */
/* ------------------------------------------------------------------ */

function parsedAt(
    state: EditorState,
    pos: number,
): { parsed: ParsedLine; lineFrom: number; text: string } {
    const line = state.doc.lineAt(pos);

    return {
        parsed: parseLine(line.text),
        lineFrom: line.from,
        text: line.text,
    };
}

/** Find the doc position after a task's indented children block. */
function endOfChildrenBlock(
    state: EditorState,
    taskLineNumber: number,
    taskIndent: number,
): number {
    const doc = state.doc;
    let end = doc.line(taskLineNumber).to;

    for (
        let lineNumber = taskLineNumber + 1;
        lineNumber <= doc.lines;
        lineNumber++
    ) {
        const line = doc.line(lineNumber);
        const parsed = parseLine(line.text);

        if (parsed.kind === 'empty' || parsed.indent <= taskIndent) {
            break;
        }

        end = line.to;
    }

    return end;
}

/** Replace the state char of a task marker and handle @repeat insertion. */
export function setTaskState(
    view: EditorView,
    pos: number,
    nextState: TaskState,
): boolean {
    const line = view.state.doc.lineAt(pos);
    const marker = line.text.match(MARKER_RE);

    if (!marker) {
        return false;
    }

    const parsed = parseLine(line.text);
    const stateChar =
        nextState === 'done'
            ? 'x'
            : nextState === 'cancelled'
              ? '-'
              : nextState === 'scheduled'
                ? '>'
                : ' ';
    const bracketPos =
        line.from + marker[1].length + marker[2].indexOf('[') + 1;

    const changes: { from: number; to: number; insert: string }[] = [
        { from: bracketPos, to: bracketPos + 1, insert: stateChar },
    ];

    if (
        nextState === 'done' &&
        parsed.repeat !== null &&
        parsed.state !== 'done'
    ) {
        const nextLine = buildNextOccurrenceLine(
            { ...parsed, raw: line.text },
            todayDailyKey(),
        );

        if (nextLine !== null) {
            const insertAt = endOfChildrenBlock(
                view.state,
                line.number,
                parsed.indent,
            );
            changes.push({
                from: insertAt,
                to: insertAt,
                insert: `\n${nextLine}`,
            });
        }
    }

    view.dispatch({ changes });

    return true;
}

function cycleTaskAt(view: EditorView, pos: number): boolean {
    const { parsed } = parsedAt(view.state, pos);

    if (parsed.kind !== 'task' && parsed.kind !== 'checklist') {
        return false;
    }

    return setTaskState(view, pos, parsed.state === 'done' ? 'open' : 'done');
}

const toggleTaskCommand = (view: EditorView): boolean =>
    cycleTaskAt(view, view.state.selection.main.head);

const cancelTaskCommand = (view: EditorView): boolean => {
    const { parsed } = parsedAt(view.state, view.state.selection.main.head);

    if (parsed.kind !== 'task' && parsed.kind !== 'checklist') {
        return false;
    }

    return setTaskState(
        view,
        view.state.selection.main.head,
        parsed.state === 'cancelled' ? 'open' : 'cancelled',
    );
};

/** Rewrite the current line with a different marker, keeping its body. */
function rewriteLineMarker(view: EditorView, marker: string): boolean {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const indent = line.text.match(/^\s*/)?.[0] ?? '';
    const taskMatch = line.text.match(MARKER_RE);
    const bulletMatch = line.text.match(/^(\s*)([-*+])\s(.*)$/);

    const body = taskMatch
        ? line.text.slice(taskMatch[0].length)
        : bulletMatch
          ? bulletMatch[3]
          : line.text.trimStart();

    view.dispatch({
        changes: {
            from: line.from,
            to: line.to,
            insert: `${indent}${marker}${body}`,
        },
    });

    return true;
}

/** ⌘L — toggle the current line between task and plain text. */
const makeTaskCommand = (view: EditorView): boolean => {
    const { parsed } = parsedAt(view.state, view.state.selection.main.head);

    return rewriteLineMarker(view, parsed.kind === 'task' ? '' : '- [ ] ');
};

/** ⌘⇧L — toggle the current line between checklist and plain text. */
const makeChecklistCommand = (view: EditorView): boolean => {
    const { parsed } = parsedAt(view.state, view.state.selection.main.head);

    return rewriteLineMarker(view, parsed.kind === 'checklist' ? '' : '+ [ ] ');
};

/**
 * ⌘⇧1 — cycle the task's priority: none → ! → !! → !!! → none.
 */
const cyclePriorityCommand = (view: EditorView): boolean => {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const marker = line.text.match(MARKER_RE);

    if (!marker) {
        return false;
    }

    const markerEnd = line.from + marker[0].length;
    const priority = line.text.match(PRIORITY_TOKEN_RE);

    if (!priority) {
        view.dispatch({
            changes: { from: markerEnd, to: markerEnd, insert: '! ' },
        });

        return true;
    }

    const from = line.from + priority[1].length;
    const to = from + priority[2].length;

    view.dispatch(
        priority[2].length >= 3
            ? { changes: { from, to: to + 1, insert: '' } }
            : {
                  changes: {
                      from,
                      to,
                      insert: '!'.repeat(priority[2].length + 1),
                  },
              },
    );

    return true;
};

/* ------------------------------------------------------------------ */
/* Inline formatting + metadata tokens                                 */
/* ------------------------------------------------------------------ */

/** Wrap or unwrap every selection range with an inline markdown mark. */
function toggleInlineMark(view: EditorView, mark: string): boolean {
    const changes = view.state.changeByRange((range) => {
        const { from, to } = range;
        const before = view.state.sliceDoc(
            Math.max(0, from - mark.length),
            from,
        );
        const after = view.state.sliceDoc(to, to + mark.length);

        if (before === mark && after === mark) {
            return {
                changes: [
                    { from: from - mark.length, to: from, insert: '' },
                    { from: to, to: to + mark.length, insert: '' },
                ],
                range: EditorSelection.range(
                    from - mark.length,
                    to - mark.length,
                ),
            };
        }

        const selected = view.state.sliceDoc(from, to);

        if (
            selected.length >= mark.length * 2 &&
            selected.startsWith(mark) &&
            selected.endsWith(mark)
        ) {
            return {
                changes: {
                    from,
                    to,
                    insert: selected.slice(
                        mark.length,
                        selected.length - mark.length,
                    ),
                },
                range: EditorSelection.range(from, to - mark.length * 2),
            };
        }

        return {
            changes: [
                { from, to: from, insert: mark },
                { from: to, to, insert: mark },
            ],
            range: EditorSelection.range(from + mark.length, to + mark.length),
        };
    });

    view.dispatch(changes, { scrollIntoView: true, userEvent: 'input' });

    return true;
}

const SCHEDULE_SINGLE_RE =
    />(\d{4}-\d{2}-\d{2}|\d{4}-W\d{1,2}|\d{4}-Q[1-4]|\d{4}-\d{2}|\d{4}|today)\b/;
const DUE_SINGLE_RE = /@due\(([^)]*)\)/;

/**
 * Insert a metadata token at the end of the current line (or focus the
 * existing one), selecting the date payload for quick editing.
 */
function insertOrSelectLineToken(
    view: EditorView,
    findToken: RegExp,
    buildToken: (today: string) => string,
    payloadOffset: number,
): boolean {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const existing = line.text.match(findToken);

    if (existing && existing.index !== undefined) {
        const start = line.from + existing.index + payloadOffset;

        view.dispatch({
            selection: EditorSelection.single(
                start,
                start + existing[1].length,
            ),
            scrollIntoView: true,
        });

        return true;
    }

    const token = buildToken(todayDailyKey());
    const insertAt = line.to;
    const prefix = line.text.endsWith(' ') || line.text === '' ? '' : ' ';
    const payloadStart = insertAt + prefix.length + payloadOffset;

    view.dispatch({
        changes: { from: insertAt, to: insertAt, insert: `${prefix}${token}` },
        selection: EditorSelection.single(
            payloadStart,
            payloadStart + todayDailyKey().length,
        ),
        scrollIntoView: true,
        userEvent: 'input',
    });

    return true;
}

/** ⌘⇧S — schedule the current line (inserts or selects the >date token). */
const scheduleTaskCommand = (view: EditorView): boolean =>
    insertOrSelectLineToken(
        view,
        SCHEDULE_SINGLE_RE,
        (today) => `>${today}`,
        1,
    );

/** ⌘⇧D — set a due date on the current line. */
const dueTaskCommand = (view: EditorView): boolean =>
    insertOrSelectLineToken(
        view,
        DUE_SINGLE_RE,
        (today) => `@due(${today})`,
        5,
    );

/**
 * ⌘⇧Y — make the current line a synced line (appending a fresh ^id when it
 * has none) and copy it to the clipboard for pasting into other notes.
 */
const makeSyncedLineCommand = (view: EditorView): boolean => {
    const line = view.state.doc.lineAt(view.state.selection.main.head);

    if (line.text.trim() === '') {
        return false;
    }

    let text = line.text;

    if (!SYNC_TOKEN_RE.test(text)) {
        text = `${text.trimEnd()} ^${generateSyncId()}`;
        view.dispatch({
            changes: { from: line.from, to: line.to, insert: text },
        });
    }

    void navigator.clipboard?.writeText(text.replace(/^\s+/, '')).catch(() => {
        // Clipboard access denied — the line is still synced.
    });

    return true;
};

/* ------------------------------------------------------------------ */
/* Token navigation (click + ⌘⏎ / ⌘⌥⏎)                                 */
/* ------------------------------------------------------------------ */

interface CursorToken {
    type: 'wiki' | 'date' | 'tag' | 'mention';
    payload: string;
}

/** The navigable token (wiki link, date, tag, mention) under the cursor. */
function tokenAtCursor(state: EditorState): CursorToken | null {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const offset = head - line.from;

    const within = (index: number, length: number): boolean =>
        offset >= index && offset <= index + length;

    for (const match of line.text.matchAll(WIKI_TOKEN_RE)) {
        const target = match[1].trim();

        if (target !== '' && within(match.index, match[0].length)) {
            return { type: 'wiki', payload: target };
        }
    }

    for (const match of line.text.matchAll(SCHEDULE_TOKEN_RE)) {
        if (within(match.index, match[0].length)) {
            return { type: 'date', payload: match[1] };
        }
    }

    for (const match of line.text.matchAll(TAG_TOKEN_RE)) {
        if (within(match.index + match[1].length, match[2].length)) {
            return { type: 'tag', payload: match[2].slice(1) };
        }
    }

    for (const match of line.text.matchAll(MENTION_TOKEN_RE)) {
        const name = match[2].slice(1);

        if (
            ['due', 'repeat'].includes(name.toLowerCase()) ||
            /^\d/.test(name)
        ) {
            continue;
        }

        if (within(match.index + match[1].length, match[2].length)) {
            return { type: 'mention', payload: name };
        }
    }

    return null;
}

function openToken(
    callbacks: EditorCallbacks,
    token: CursorToken,
    split: boolean,
): void {
    switch (token.type) {
        case 'wiki':
            callbacks.onOpenLink(token.payload, split);
            break;
        case 'date':
            callbacks.onOpenDate(
                token.payload === 'today' ? todayDailyKey() : token.payload,
                split,
            );
            break;
        case 'tag':
            callbacks.onOpenTag(token.payload, split);
            break;
        case 'mention':
            callbacks.onOpenMention(token.payload, split);
            break;
    }
}

/* ------------------------------------------------------------------ */
/* Click handling                                                      */
/* ------------------------------------------------------------------ */

function clickHandlers(callbacks: EditorCallbacks): Extension {
    return EditorView.domEventHandlers({
        mousedown(event, view) {
            const target = event.target as HTMLElement;

            const checkbox = target.closest('.cm-check');

            if (checkbox) {
                const pos = view.posAtDOM(checkbox);
                cycleTaskAt(view, pos);
                event.preventDefault();

                return true;
            }

            const tokenEl = target.closest<HTMLElement>(
                '.cm-wikilink, .cm-date-link, .cm-hashtag, .cm-mention',
            );

            if (!tokenEl) {
                return false;
            }

            const split = event.altKey;
            const forced = event.metaKey || event.ctrlKey || split;

            if (!forced) {
                // Plain click: navigate only when the line is rendered (the
                // cursor is elsewhere). While editing the line, clicks keep
                // positioning the cursor as usual.
                const pos = view.posAtDOM(tokenEl);
                const line = view.state.doc.lineAt(pos);

                if (selectionTouches(view.state, line.from, line.to)) {
                    return false;
                }
            }

            if (tokenEl.classList.contains('cm-wikilink')) {
                callbacks.onOpenLink(tokenEl.dataset.wikiTarget ?? '', split);
            } else if (tokenEl.classList.contains('cm-date-link')) {
                const key = tokenEl.dataset.dateKey;

                if (!key) {
                    return false;
                }

                callbacks.onOpenDate(
                    key === 'today' ? todayDailyKey() : key,
                    split,
                );
            } else if (tokenEl.classList.contains('cm-hashtag')) {
                callbacks.onOpenTag(tokenEl.dataset.tag ?? '', split);
            } else {
                callbacks.onOpenMention(tokenEl.dataset.mention ?? '', split);
            }

            event.preventDefault();

            return true;
        },
    });
}

/* ------------------------------------------------------------------ */
/* Autocomplete                                                        */
/* ------------------------------------------------------------------ */

function completionSource(callbacks: EditorCallbacks) {
    return (context: CompletionContext): CompletionResult | null => {
        const wiki = context.matchBefore(/\[\[([^\]\n]*)$/);

        if (wiki) {
            return {
                from: wiki.from + 2,
                options: callbacks.getNoteTitles().map((title) => ({
                    label: title,
                    type: 'text',
                    apply: `${title}]]`,
                })),
                validFor: /^[^\]\n]*$/,
            };
        }

        const tag = context.matchBefore(/(?:^|[\s(])#[\w/-]*$/);

        if (tag) {
            const hashIndex = tag.text.indexOf('#');

            return {
                from: tag.from + hashIndex + 1,
                options: callbacks
                    .getTags()
                    .map((name) => ({ label: name, type: 'keyword' })),
                validFor: /^[\w/-]*$/,
            };
        }

        const mention = context.matchBefore(/(?:^|[\s(])@[\w/.-]*$/);

        if (mention) {
            const atIndex = mention.text.indexOf('@');
            const from = mention.from + atIndex + 1;
            const today = todayDailyKey();

            return {
                from,
                options: [
                    ...callbacks.getMentions().map((name) => ({
                        label: name,
                        type: 'variable' as const,
                    })),
                    {
                        label: 'due(…)',
                        type: 'function' as const,
                        apply: `due(${today})`,
                    },
                    {
                        label: 'repeat(…)',
                        type: 'function' as const,
                        apply: 'repeat(1w)',
                    },
                ],
                validFor: /^[\w/.-]*$/,
            };
        }

        return null;
    };
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

const highlightStyle = HighlightStyle.define([
    { tag: tags.heading1, class: 'cm-h1' },
    { tag: tags.heading2, class: 'cm-h2' },
    { tag: tags.heading3, class: 'cm-h3' },
    { tag: tags.heading4, class: 'cm-h4' },
    { tag: tags.strong, fontWeight: '600' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.monospace, class: 'cm-code' },
    { tag: tags.link, class: 'cm-md-link' },
    { tag: tags.url, class: 'cm-md-url' },
    { tag: tags.quote, class: 'cm-quote' },
    { tag: tags.processingInstruction, class: 'cm-md-mark' },
]);

/** Todoist-inspired priority palette (P1 red, P2 orange, P3 blue). */
const PRIORITY_COLORS = {
    3: '#dc4c3e',
    2: '#eb8909',
    1: '#246fe0',
} as const;

const editorTheme = EditorView.theme({
    '&': {
        height: '100%',
        fontSize: '15px',
        backgroundColor: 'transparent',
        color: 'var(--foreground)',
    },
    '.cm-content': {
        fontFamily: 'inherit',
        caretColor: 'var(--foreground)',
        padding: '12px 0 45vh',
        lineHeight: '1.65',
        maxWidth: '46rem',
    },
    '.cm-line': { padding: '0 4px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'color-mix(in oklab, var(--primary) 18%, transparent)',
    },
    '.cm-h1': { fontSize: '1.6em', fontWeight: '700', lineHeight: '1.3' },
    '.cm-h2': { fontSize: '1.35em', fontWeight: '700', lineHeight: '1.3' },
    '.cm-h3': { fontSize: '1.15em', fontWeight: '600' },
    '.cm-h4': { fontWeight: '600' },
    '.cm-md-mark': { color: 'var(--muted-foreground)', opacity: '0.55' },
    '.cm-quote': { color: 'var(--muted-foreground)', fontStyle: 'italic' },
    '.cm-code': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '0.9em',
        backgroundColor: 'color-mix(in oklab, var(--muted) 60%, transparent)',
        borderRadius: '4px',
        padding: '1px 4px',
    },
    '.cm-md-link, .cm-md-url': { color: 'var(--primary)' },

    '.cm-gutters': {
        backgroundColor: 'transparent',
        border: 'none',
    },
    '.cm-foldGutter .cm-gutterElement': {
        width: '16px',
        cursor: 'pointer',
    },
    '.cm-fold-marker': {
        display: 'inline-block',
        fontSize: '0.7em',
        lineHeight: '1.65rem',
        color: 'var(--muted-foreground)',
        opacity: '0',
        transition: 'transform 120ms ease, opacity 120ms ease',
    },
    '.cm-fold-marker.cm-fold-open': {
        transform: 'rotate(90deg)',
    },
    '.cm-fold-marker.cm-fold-closed': {
        opacity: '0.7',
    },
    '&:hover .cm-fold-marker': {
        opacity: '0.7',
    },
    '.cm-foldPlaceholder': {
        backgroundColor: 'color-mix(in oklab, var(--muted) 80%, transparent)',
        border: 'none',
        borderRadius: '4px',
        color: 'var(--muted-foreground)',
        margin: '0 4px',
        padding: '0 6px',
        cursor: 'pointer',
    },

    '.cm-line-comment': {
        color: 'var(--muted-foreground)',
        fontStyle: 'italic',
    },
    '.cm-sync-id': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '0.8em',
        color: 'var(--muted-foreground)',
        opacity: '0.7',
    },
    '.cm-sync-glyph': {
        color: 'color-mix(in oklab, var(--primary) 70%, var(--muted-foreground))',
        fontSize: '0.85em',
        marginLeft: '0.4em',
        cursor: 'default',
    },

    '.cm-frontmatter': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '0.82em',
        color: 'var(--muted-foreground)',
    },

    '.cm-indent-guide': {
        position: 'relative',
        // Widen nested indentation: every whitespace char in the guide
        // segment gets extra tracking, scaling the indent with depth.
        letterSpacing: '0.35em',
    },
    '.cm-indent-guide::before': {
        content: "''",
        position: 'absolute',
        left: '0.4em',
        top: '-0.36em',
        bottom: '-0.36em',
        width: '1.5px',
        backgroundColor:
            'color-mix(in oklab, var(--border) 55%, var(--muted-foreground))',
        pointerEvents: 'none',
    },
    // A guide run starts at the vertical center of its first line and ends
    // at the center of its last line, fading out at both tips.
    '.cm-indent-guide-first::before': {
        top: '50%',
        background:
            'linear-gradient(to bottom, transparent, color-mix(in oklab, var(--border) 55%, var(--muted-foreground)) 12px)',
    },
    '.cm-indent-guide-last::before': {
        bottom: '50%',
        background:
            'linear-gradient(to top, transparent, color-mix(in oklab, var(--border) 55%, var(--muted-foreground)) 12px)',
    },
    '.cm-indent-guide-first.cm-indent-guide-last::before': {
        display: 'none',
    },

    '.cm-bullet-dot': {
        display: 'inline-block',
        width: '0.84em',
        textAlign: 'center',
        color: 'var(--muted-foreground)',
    },

    '.cm-check': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.05em',
        height: '1.05em',
        verticalAlign: 'middle',
        marginTop: '-0.15em',
        border: '1.5px solid color-mix(in oklab, var(--primary) 65%, var(--muted-foreground))',
        marginRight: '0.45em',
        cursor: 'pointer',
        fontSize: '0.8em',
        fontWeight: '700',
        lineHeight: '1',
        color: 'transparent',
        transition: 'all 120ms ease',
    },
    '.cm-check-task': { borderRadius: '9999px' },
    '.cm-check-checklist': { borderRadius: '4px' },
    '.cm-check:hover': { transform: 'scale(1.12)' },
    '.cm-check-p3': {
        borderColor: PRIORITY_COLORS[3],
        backgroundColor: 'color-mix(in oklab, #dc4c3e 12%, transparent)',
    },
    '.cm-check-p2': {
        borderColor: PRIORITY_COLORS[2],
        backgroundColor: 'color-mix(in oklab, #eb8909 12%, transparent)',
    },
    '.cm-check-p1': {
        borderColor: PRIORITY_COLORS[1],
        backgroundColor: 'color-mix(in oklab, #246fe0 12%, transparent)',
    },
    '.cm-check-done': {
        backgroundColor: 'var(--primary)',
        borderColor: 'var(--primary)',
        color: 'var(--primary-foreground)',
    },
    '.cm-check-done.cm-check-p3': {
        backgroundColor: PRIORITY_COLORS[3],
        borderColor: PRIORITY_COLORS[3],
        color: '#fff',
    },
    '.cm-check-done.cm-check-p2': {
        backgroundColor: PRIORITY_COLORS[2],
        borderColor: PRIORITY_COLORS[2],
        color: '#fff',
    },
    '.cm-check-done.cm-check-p1': {
        backgroundColor: PRIORITY_COLORS[1],
        borderColor: PRIORITY_COLORS[1],
        color: '#fff',
    },
    '.cm-check-cancelled': {
        borderColor: 'var(--muted-foreground)',
        color: 'var(--muted-foreground)',
        backgroundColor: 'transparent',
    },
    '.cm-check-scheduled': {
        borderColor: 'var(--muted-foreground)',
        color: 'var(--muted-foreground)',
    },
    '.cm-line-done': {
        textDecoration: 'line-through',
        textDecorationColor:
            'color-mix(in oklab, var(--muted-foreground) 60%, transparent)',
        color: 'var(--muted-foreground)',
    },
    '.cm-line-cancelled': {
        textDecoration: 'line-through',
        color: 'var(--muted-foreground)',
        opacity: '0.7',
    },

    '.cm-priority': { fontWeight: '700' },
    '.cm-priority-3': { color: PRIORITY_COLORS[3] },
    '.cm-priority-2': { color: PRIORITY_COLORS[2] },
    '.cm-priority-1': { color: PRIORITY_COLORS[1] },
    '.cm-date-link': {
        color: 'var(--token-link)',
        backgroundColor: 'var(--token-link-bg)',
        borderRadius: '4px',
        padding: '0 3px',
        cursor: 'pointer',
    },
    '.cm-meta-pill': {
        color: 'var(--muted-foreground)',
        backgroundColor: 'color-mix(in oklab, var(--muted) 70%, transparent)',
        borderRadius: '9999px',
        padding: '0 6px',
        fontSize: '0.85em',
    },
    '.cm-reminder': {
        color: 'color-mix(in oklab, var(--primary) 80%, var(--foreground))',
    },
    '.cm-hashtag': {
        color: 'var(--token-tag)',
        backgroundColor: 'var(--token-tag-bg)',
        borderRadius: '4px',
        padding: '0 3px',
        cursor: 'pointer',
    },
    '.cm-mention': {
        color: 'var(--token-mention)',
        backgroundColor: 'var(--token-mention-bg)',
        borderRadius: '4px',
        padding: '0 3px',
        cursor: 'pointer',
    },
    '.cm-wikilink': {
        color: 'var(--token-link)',
        borderBottom:
            '1px solid color-mix(in oklab, var(--token-link) 45%, transparent)',
        cursor: 'pointer',
    },
    '.cm-tooltip.cm-tooltip-autocomplete': {
        backgroundColor: 'var(--popover)',
        color: 'var(--popover-foreground)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        overflow: 'hidden',
        boxShadow: '0 8px 24px rgb(0 0 0 / 0.12)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: 'color-mix(in oklab, var(--primary) 15%, transparent)',
        color: 'var(--foreground)',
    },
});

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

export function donoteMarkdown(callbacks: EditorCallbacks): Extension {
    return [
        history(),
        indentUnit.of('    '),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(highlightStyle),
        decorationsField,
        codeFolding(),
        donoteFoldService,
        foldGutter({
            markerDOM(open) {
                const marker = document.createElement('span');
                marker.className = `cm-fold-marker ${open ? 'cm-fold-open' : 'cm-fold-closed'}`;
                marker.textContent = '❯';
                marker.title = open ? 'Collapse' : 'Expand';

                return marker;
            },
        }),
        clickHandlers(callbacks),
        autocompletion({
            override: [completionSource(callbacks)],
            icons: false,
        }),
        EditorView.lineWrapping,
        editorTheme,
        keymap.of([
            {
                key: 'Mod-Enter',
                run: (view) => {
                    const token = tokenAtCursor(view.state);

                    if (token) {
                        openToken(callbacks, token, false);

                        return true;
                    }

                    return toggleTaskCommand(view);
                },
            },
            {
                key: 'Mod-Alt-Enter',
                run: (view) => {
                    const token = tokenAtCursor(view.state);

                    if (token) {
                        openToken(callbacks, token, true);

                        return true;
                    }

                    return false;
                },
            },
            { key: 'Mod-Shift-Enter', run: cancelTaskCommand },
            { key: 'Mod-l', run: makeTaskCommand },
            { key: 'Mod-Shift-l', run: makeChecklistCommand },
            { key: 'Mod-b', run: (view) => toggleInlineMark(view, '**') },
            { key: 'Mod-i', run: (view) => toggleInlineMark(view, '*') },
            { key: 'Mod-e', run: (view) => toggleInlineMark(view, '`') },
            { key: 'Mod-Shift-x', run: (view) => toggleInlineMark(view, '~~') },
            { key: 'Mod-Shift-s', run: scheduleTaskCommand },
            { key: 'Mod-Shift-d', run: dueTaskCommand },
            { key: 'Mod-Shift-y', run: makeSyncedLineCommand },
            { key: 'Mod-Shift-1', run: cyclePriorityCommand },
            // Consume Mod-/ so CodeMirror's comment toggle never fires; the
            // app-level handler opens the shortcuts cheatsheet instead.
            { key: 'Mod-/', run: () => true },
            ...completionKeymap,
            ...foldKeymap,
            ...markdownKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
        ]),
    ];
}
