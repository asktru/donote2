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
    moveLineDown,
    moveLineUp,
} from '@codemirror/commands';
import {
    markdown,
    markdownKeymap,
    markdownLanguage,
} from '@codemirror/lang-markdown';
import {
    codeFolding,
    foldable,
    foldEffect,
    foldGutter,
    foldKeymap,
    foldService,
    indentUnit,
    syntaxHighlighting,
    syntaxTree,
    unfoldEffect,
    HighlightStyle,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import {
    EditorSelection,
    RangeSetBuilder,
    StateField,
} from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
    Decoration,
    EditorView,
    keymap,
    ViewPlugin,
    WidgetType,
} from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';

import { todayDailyKey } from '@/core/dates';
import { COMMENT_RE, parseLine } from '@/core/parser';
import type { ParsedLine, Priority, TaskState } from '@/core/parser';
import { buildNextOccurrenceLine } from '@/core/repeat';
import { generateSyncId } from '@/core/syncedLines';
import { filePreview, lightboxImage, syncedLinePanel } from '@/stores/ui';

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

const SVG_NS = 'http://www.w3.org/2000/svg';

const CHECK_ICONS: Partial<Record<TaskState, string>> = {
    done: 'M3.8 8.7 6.7 11.4 12.2 4.8',
    cancelled: 'M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6',
    scheduled: 'M6.2 3.8 10.4 8l-4.2 4.2',
};

function checkIcon(state: TaskState): SVGElement | null {
    const path = CHECK_ICONS[state];

    if (!path) {
        return null;
    }

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');

    const stroke = document.createElementNS(SVG_NS, 'path');
    stroke.setAttribute('d', path);
    stroke.setAttribute('stroke', 'currentColor');
    stroke.setAttribute('stroke-width', '2.4');
    stroke.setAttribute('stroke-linecap', 'round');
    stroke.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(stroke);

    return svg;
}

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

        const icon = checkIcon(this.state);

        if (icon) {
            box.appendChild(icon);
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

/** A `---` thematic break rendered as a horizontal separator. */
class HorizontalRuleWidget extends WidgetType {
    override eq(): boolean {
        return true;
    }

    toDOM(): HTMLElement {
        const rule = document.createElement('span');
        rule.className = 'cm-hr';
        rule.setAttribute('aria-hidden', 'true');

        return rule;
    }

    override ignoreEvent(): boolean {
        return false;
    }
}

/** `![alt](url)` rendered as the actual image while the cursor is away. */
class ImagePreviewWidget extends WidgetType {
    constructor(
        readonly url: string,
        readonly alt: string,
    ) {
        super();
    }

    override eq(other: ImagePreviewWidget): boolean {
        return other.url === this.url && other.alt === this.alt;
    }

    override get estimatedHeight(): number {
        return 220;
    }

    toDOM(): HTMLElement {
        const wrap = document.createElement('span');
        wrap.className = 'cm-image-preview';

        const img = document.createElement('img');
        img.src = this.url;
        img.alt = this.alt;
        img.loading = 'lazy';
        img.draggable = false;
        img.title = 'Click to view full size';
        img.onerror = () => {
            wrap.textContent = `🖼 ${this.alt || 'image'} (failed to load)`;
            wrap.classList.add('cm-image-preview-broken');
        };
        img.onclick = (event) => {
            event.preventDefault();
            lightboxImage.value = { url: this.url, alt: this.alt };
        };

        wrap.appendChild(img);

        return wrap;
    }

    override ignoreEvent(): boolean {
        return true;
    }
}

const IMAGE_TOKEN_RE = /!\[([^\]\n]*)\]\(([^)\s]+)\)/g;
const LINK_URL_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const BARE_URL_RE = /https?:\/\/[^\s)]+/g;

/**
 * URL of the link at `offset`: the target of a `[title](url)` link, or a
 * bare URL (GFM autolink) sitting there directly. Markdown links win so a
 * `](url)` tail is never mistaken for a bare URL.
 */
function mdLinkUrlAt(text: string, offset: number): string | null {
    for (const match of text.matchAll(LINK_URL_RE)) {
        if (
            match.index <= offset &&
            offset <= match.index + match[0].length
        ) {
            return match[2];
        }
    }

    for (const match of text.matchAll(BARE_URL_RE)) {
        if (
            match.index <= offset &&
            offset <= match.index + match[0].length
        ) {
            return match[0];
        }
    }

    return null;
}

/**
 * Open external URLs in a new tab. Attachments route by content type:
 * images to the lightbox, text/html/csv into the fullscreen file
 * viewer, everything else downloads through the session.
 */
async function openMarkdownUrl(url: string): Promise<void> {
    const sameOrigin =
        url.startsWith('/') || url.startsWith(window.location.origin);

    if (!sameOrigin || !/\/attachments\//.test(url)) {
        window.open(url, '_blank', 'noopener');

        return;
    }

    const response = await fetch(url, { credentials: 'same-origin' });

    if (!response.ok) {
        return;
    }

    const disposition = response.headers.get('Content-Disposition') ?? '';
    const filename = decodeURIComponent(
        /filename\*?=(?:UTF-8'')?"?([^";]+)/.exec(disposition)?.[1] ??
            'attachment',
    );
    const mime = (response.headers.get('Content-Type') ?? '').split(';')[0];

    if (mime.startsWith('image/')) {
        lightboxImage.value = { url, alt: filename };

        return;
    }

    // Extension beats mime: small text-like files get sniffed as
    // text/plain at upload regardless of what they really are.
    const TEXT_EXT_RE =
        /\.(json|xml|ya?ml|toml|ini|log|md|txt|sql|sh|zsh|py|rb|php|js|jsx|ts|tsx|vue|css|scss|env|conf|srt|vtt)$/i;
    const previewKind =
        mime === 'text/html' || /\.html?$/i.test(filename)
            ? 'html'
            : mime === 'text/csv' || /\.csv$/i.test(filename)
              ? 'csv'
              : mime.startsWith('text/') ||
                  mime === 'application/json' ||
                  mime === 'application/xml' ||
                  TEXT_EXT_RE.test(filename)
                ? 'text'
                : null;

    if (previewKind !== null) {
        let content = await response.text();

        if (/\.json$/i.test(filename) || mime === 'application/json') {
            try {
                content = JSON.stringify(JSON.parse(content), null, 2);
            } catch {
                // Not valid JSON after all — show it as-is.
            }
        }

        filePreview.value = {
            kind: previewKind,
            name: filename,
            url,
            content,
        };

        return;
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
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
        glyph.title = `Synced line ^${this.id} — click to see every location`;

        const id = this.id;
        glyph.onclick = (event) => {
            event.preventDefault();
            syncedLinePanel.value = {
                syncId: id,
                x: event.clientX,
                y: event.clientY,
            };
        };

        return glyph;
    }

    override ignoreEvent(): boolean {
        return true;
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
// ==highlight==: no `=` or whitespace hugging the delimiters, so "a == b"
// and "====" never match.
const HIGHLIGHT_TOKEN_RE = /==(?!\s)([^\n=]+?)(?<!\s)==/g;
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

            // A URL node is punctuation only inside a real [title](url)
            // link, where the visible title stays. A bare URL is parsed
            // (via GFM autolink) as a standalone URL node with no Link
            // parent — hiding that would leave the line blank until the
            // cursor lands on it. Keep those visible.
            if (node.name === 'URL' && node.node.parent?.name !== 'Link') {
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

/**
 * Line numbers holding a `---`/`***`/`___` thematic break. Taken from the
 * markdown tree (node `HorizontalRule`) so front matter fences, Setext
 * heading underlines, and dashes inside code never qualify.
 */
function collectHorizontalRules(state: EditorState): Set<number> {
    const lines = new Set<number>();

    syntaxTree(state).iterate({
        enter: (node) => {
            if (node.name === 'HorizontalRule') {
                lines.add(state.doc.lineAt(node.from).number);
            }
        },
    });

    return lines;
}

function buildDecorations(state: EditorState): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = state.doc;
    const syntaxMarks = collectSyntaxMarks(state);
    const horizontalRules = collectHorizontalRules(state);
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

        // A --- / *** / ___ thematic break renders as a separator, unless
        // the cursor is on the line (then it stays editable). Front matter
        // fences are already skipped above, so they're never touched.
        if (horizontalRules.has(lineNumber) && !revealed) {
            builder.add(
                line.from,
                line.to,
                Decoration.replace({ widget: new HorizontalRuleWidget() }),
            );
            continue;
        }

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

        // Image tokens become inline previews while the cursor is away;
        // their span replaces syntax marks the parser would hide within.
        const imageSpans: [number, number][] = [];

        if (!revealed) {
            for (const match of line.text.matchAll(IMAGE_TOKEN_RE)) {
                const from = line.from + match.index;
                const to = from + match[0].length;
                imageSpans.push([from, to]);
                tokens.push({
                    from,
                    to,
                    decoration: Decoration.replace({
                        widget: new ImagePreviewWidget(match[2], match[1]),
                    }),
                });
            }
        }

        const insideImage = (from: number, to: number): boolean =>
            imageSpans.some(([start, end]) => from >= start && to <= end);

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
                if (
                    insideWiki(mark.from, mark.to) ||
                    insideImage(mark.from, mark.to)
                ) {
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

        // Persisted-fold marker: invisible normally, muted when editing
        // the line so it can be removed by hand if ever needed.
        const foldMarker = line.text.match(FOLD_MARKER_RE);

        if (foldMarker && foldMarker.index !== undefined) {
            tokens.push({
                from: line.from + foldMarker.index,
                to: line.from + line.text.length,
                decoration: revealed
                    ? Decoration.mark({ class: 'cm-md-mark' })
                    : hideDecoration,
            });
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

        for (const match of line.text.matchAll(HIGHLIGHT_TOKEN_RE)) {
            const from = line.from + match.index;
            const to = from + match[0].length;
            const innerFrom = from + 2;
            const innerTo = to - 2;
            const markClass = revealed ? 'cm-md-mark' : undefined;

            tokens.push({
                from,
                to: innerFrom,
                decoration: markClass
                    ? Decoration.mark({ class: markClass })
                    : hideDecoration,
            });
            tokens.push({
                from: innerFrom,
                to: innerTo,
                decoration: Decoration.mark({ class: 'cm-highlight' }),
            });
            tokens.push({
                from: innerTo,
                to,
                decoration: markClass
                    ? Decoration.mark({ class: markClass })
                    : hideDecoration,
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

const strikeDecoration = Decoration.mark({ class: 'cm-task-strike' });

/**
 * Strikethrough for done/cancelled tasks lives in its own decoration layer
 * so it can span the whole text (overlapping tag/date/pill marks) while
 * starting after the task marker — not across the checkbox or the indent.
 */
function buildStrikes(state: EditorState): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = state.doc;

    for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
        const line = doc.line(lineNumber);
        const marker = line.text.match(MARKER_RE);

        if (!marker) {
            continue;
        }

        const stateChar = marker[2].match(/\[(.)\]/)?.[1] ?? ' ';

        if (stateChar !== 'x' && stateChar !== 'X' && stateChar !== '-') {
            continue;
        }

        const from = line.from + marker[0].length;

        if (from < line.to) {
            builder.add(from, line.to, strikeDecoration);
        }
    }

    return builder.finish();
}

const strikeField = StateField.define<DecorationSet>({
    create: buildStrikes,
    update(value, transaction) {
        return transaction.docChanged ? buildStrikes(transaction.state) : value;
    },
    provide: (field) => EditorView.decorations.from(field),
});

/** Hover-revealed copy button inside fenced code blocks. */
class CopyWidget extends WidgetType {
    constructor(
        readonly text: string,
        readonly kind: 'block' | 'line',
    ) {
        super();
    }

    override eq(other: CopyWidget): boolean {
        return other.text === this.text && other.kind === this.kind;
    }

    toDOM(): HTMLElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `cm-copy-btn cm-copy-${this.kind}`;
        button.title = this.kind === 'block' ? 'Copy code block' : 'Copy line';
        button.setAttribute('aria-label', button.title);
        button.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

        button.addEventListener('mousedown', (event) =>
            event.preventDefault(),
        );
        button.addEventListener('click', (event) => {
            event.preventDefault();
            void navigator.clipboard.writeText(this.text);
            button.classList.add('cm-copied');
            setTimeout(() => button.classList.remove('cm-copied'), 900);
        });

        return button;
    }

    override ignoreEvent(): boolean {
        return true;
    }
}

/**
 * Fenced code blocks: one contiguous rectangle with dimmed ``` fences,
 * a copy-whole-block button on the opening fence, and per-line copy
 * buttons — all revealed on hover.
 */
function buildCodeBlocks(view: EditorView): DecorationSet {
    const state = view.state;
    const builder = new RangeSetBuilder<Decoration>();
    const seen = new Set<number>();

    for (const range of view.visibleRanges) {
        syntaxTree(state).iterate({
            from: range.from,
            to: range.to,
            enter(node) {
                if (node.name !== 'FencedCode' || seen.has(node.from)) {
                    return;
                }

                seen.add(node.from);
                const first = state.doc.lineAt(node.from);
                const last = state.doc.lineAt(node.to);
                const codeLines: string[] = [];

                for (let n = first.number + 1; n <= last.number; n++) {
                    const line = state.doc.line(n);

                    if (!/^\s*(`{3,}|~{3,})/.test(line.text)) {
                        codeLines.push(line.text);
                    }
                }

                for (let n = first.number; n <= last.number; n++) {
                    const line = state.doc.line(n);
                    const isFence =
                        n === first.number ||
                        (n === last.number &&
                            /^\s*(`{3,}|~{3,})/.test(line.text));
                    const classes = [
                        'cm-codeblock',
                        n === first.number ? 'cm-codeblock-first' : '',
                        n === last.number ? 'cm-codeblock-last' : '',
                        isFence ? 'cm-codeblock-fence' : '',
                    ]
                        .filter(Boolean)
                        .join(' ');

                    builder.add(
                        line.from,
                        line.from,
                        Decoration.line({ class: classes }),
                    );

                    if (n === first.number && codeLines.length > 0) {
                        builder.add(
                            line.to,
                            line.to,
                            Decoration.widget({
                                widget: new CopyWidget(
                                    codeLines.join('\n'),
                                    'block',
                                ),
                                side: 1,
                            }),
                        );
                    } else if (!isFence && line.text.trim() !== '') {
                        builder.add(
                            line.to,
                            line.to,
                            Decoration.widget({
                                widget: new CopyWidget(line.text, 'line'),
                                side: 1,
                            }),
                        );
                    }
                }
            },
        });
    }

    return builder.finish();
}

/* ------------------------------------------------------------------ */
/* Fold persistence (NotePlan-compatible trailing ellipsis)            */
/* ------------------------------------------------------------------ */

/** NotePlan marks collapsed lines with a trailing " …". */
export const FOLD_MARKER_RE = /[ \t]…[ \t]*$/;

const FRONT_MATTER_FOLD_KEY = 'donote:frontmatter-collapsed';

/**
 * Front matter fold state is a single global preference, not per-note:
 * collapse it once and it stays collapsed everywhere. It can't ride in
 * the text like other folds — a trailing " …" on the opening `---` breaks
 * the block — so it lives in localStorage instead.
 */
function frontMatterCollapsed(): boolean {
    try {
        return localStorage.getItem(FRONT_MATTER_FOLD_KEY) === '1';
    } catch {
        return false;
    }
}

function setFrontMatterCollapsed(collapsed: boolean): void {
    try {
        localStorage.setItem(FRONT_MATTER_FOLD_KEY, collapsed ? '1' : '0');
    } catch {
        // Best-effort — folding still works this session without it.
    }
}

/** Is `from` the fold range of a front matter block (opens on line 1)? */
function isFrontMatterFold(state: EditorState, from: number): boolean {
    return (
        state.doc.lineAt(from).number === 1 && frontMatterEnd(state) > 1
    );
}

/**
 * Mirror fold state into the note text: folding appends " …" to the
 * header line, unfolding removes it. The marker syncs with the note,
 * so collapsed sections survive reloads and travel across devices —
 * and folds from migrated NotePlan notes restore for free.
 *
 * Front matter is the exception: its state goes to the global preference,
 * never the text, so the `---` block stays intact.
 */
const foldPersistence = EditorView.updateListener.of((update) => {
    const changes: { from: number; to: number; insert: string }[] = [];

    for (const transaction of update.transactions) {
        for (const effect of transaction.effects) {
            if (effect.is(foldEffect)) {
                if (isFrontMatterFold(update.state, effect.value.from)) {
                    setFrontMatterCollapsed(true);
                    continue;
                }

                const line = update.state.doc.lineAt(effect.value.from);

                if (!FOLD_MARKER_RE.test(line.text)) {
                    changes.push({
                        from: line.to,
                        to: line.to,
                        insert: ' …',
                    });
                }
            } else if (effect.is(unfoldEffect)) {
                if (isFrontMatterFold(update.state, effect.value.from)) {
                    setFrontMatterCollapsed(false);
                    continue;
                }

                const line = update.state.doc.lineAt(effect.value.from);
                const match = line.text.match(FOLD_MARKER_RE);

                if (match && match.index !== undefined) {
                    changes.push({
                        from: line.from + match.index,
                        to: line.to,
                        insert: '',
                    });
                }
            }
        }
    }

    if (changes.length > 0) {
        // A dispatch is illegal inside an update cycle.
        queueMicrotask(() => update.view.dispatch({ changes }));
    }
});

/**
 * Re-fold on note open: every line carrying the persisted " …" marker,
 * plus the front matter block when the global preference says collapsed.
 */
export function applyPersistedFolds(view: EditorView): void {
    // Heal front matter corrupted by an earlier build that stamped the
    // fold marker onto the opening `---` (which stops it from parsing as
    // front matter at all). Strip that stray marker before anything reads
    // the block; the repaired text syncs back out.
    const first = view.state.doc.line(1);

    if (
        FOLD_MARKER_RE.test(first.text) &&
        first.text.replace(FOLD_MARKER_RE, '').trim() === '---'
    ) {
        const marker = first.text.match(FOLD_MARKER_RE);

        if (marker && marker.index !== undefined) {
            view.dispatch({
                changes: {
                    from: first.from + marker.index,
                    to: first.to,
                    insert: '',
                },
            });
        }
    }

    const effects = [];
    const doc = view.state.doc;

    if (frontMatterCollapsed() && frontMatterEnd(view.state) > 1) {
        const line = doc.line(1);
        const range = foldable(view.state, line.from, line.to);

        if (range) {
            effects.push(foldEffect.of(range));
        }
    }

    for (let n = 1; n <= doc.lines; n++) {
        const line = doc.line(n);

        if (FOLD_MARKER_RE.test(line.text)) {
            const range = foldable(view.state, line.from, line.to);

            if (range) {
                effects.push(foldEffect.of(range));
            }
        }
    }

    if (effects.length > 0) {
        view.dispatch({ effects });
    }
}

/**
 * A ViewPlugin (not a StateField) because the decorations derive from
 * the syntax tree, which parses asynchronously — a field computed at
 * create time would see an empty tree and never refresh.
 */
const codeBlockPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildCodeBlocks(view);
        }

        update(update: ViewUpdate) {
            if (
                update.docChanged ||
                update.viewportChanged ||
                syntaxTree(update.state) !== syntaxTree(update.startState)
            ) {
                this.decorations = buildCodeBlocks(update.view);
            }
        }
    },
    { decorations: (plugin) => plugin.decorations },
);

const decorationsField = StateField.define<DecorationSet>({
    create: buildDecorations,
    update(value, transaction) {
        if (
            transaction.docChanged ||
            transaction.selection ||
            // The markdown parse is async: deep sections of long notes
            // gain their Link/Emphasis nodes after later parse batches,
            // each landing as a transaction. Without this, syntax marks
            // far from the top render raw until the first edit.
            syntaxTree(transaction.state) !==
                syntaxTree(transaction.startState)
        ) {
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

    // Priority is meaningless once a task is finished — strip !/!!/!!! (and
    // the space after it) when completing or cancelling. The range sits
    // after the checkbox, so it never overlaps the state change above.
    const priority =
        nextState === 'done' || nextState === 'cancelled'
            ? line.text.match(PRIORITY_TOKEN_RE)
            : null;

    if (priority && priority[2].length > 0) {
        const priorityFrom = line.from + priority[1].length;
        changes.push({
            from: priorityFrom,
            to: priorityFrom + priority[2].length + 1,
            insert: '',
        });
    }

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

            // Markdown links: open externally, or download attachments
            // through the authenticated session (an external browser opened
            // from the desktop shell would have no session cookie).
            const mdLink = target.closest<HTMLElement>(
                '.cm-md-link, .cm-md-url',
            );

            if (mdLink) {
                const pos = view.posAtDOM(mdLink);
                const line = view.state.doc.lineAt(pos);

                if (!selectionTouches(view.state, line.from, line.to)) {
                    const url = mdLinkUrlAt(line.text, pos - line.from);

                    if (url !== null) {
                        event.preventDefault();
                        void openMarkdownUrl(url);

                        return true;
                    }
                }
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
    // Code tokens inside fenced blocks (nested language parses).
    { tag: tags.keyword, color: 'var(--token-mention)' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--token-tag)' },
    { tag: [tags.number, tags.bool, tags.atom], color: '#eb8909' },
    { tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--token-link)' },
    { tag: [tags.typeName, tags.className, tags.tagName], color: '#dc4c3e' },
    { tag: [tags.operator, tags.punctuation], color: 'var(--muted-foreground)' },
    { tag: tags.propertyName, color: 'var(--token-link)' },
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
        padding: '12px 0 2rem',
        lineHeight: '1.65',
        maxWidth: '46rem',
    },
    '.cm-line': { padding: '0 4px' },
    '.cm-hr': {
        display: 'inline-block',
        width: '100%',
        height: '0',
        verticalAlign: 'middle',
        borderTop: '1px solid var(--border)',
    },
    '.cm-highlight': {
        backgroundColor: 'var(--highlight)',
        borderRadius: '3px',
        padding: '0.05em 0.15em',
        WebkitBoxDecorationBreak: 'clone',
        boxDecorationBreak: 'clone',
    },
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
    '.cm-md-link': {
        color: 'var(--token-link)',
        textDecoration: 'underline',
        textDecorationColor:
            'color-mix(in oklab, var(--token-link) 40%, transparent)',
        textUnderlineOffset: '2px',
    },
    '.cm-md-url': { color: 'var(--muted-foreground)' },
    '.cm-md-link, .cm-md-url': { cursor: 'pointer' },
    '.cm-image-preview': {
        display: 'inline-block',
        maxWidth: '100%',
        verticalAlign: 'top',
        padding: '2px 0',
    },
    '.cm-image-preview img': {
        display: 'block',
        maxWidth: 'min(480px, 100%)',
        maxHeight: '360px',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        cursor: 'zoom-in',
    },
    '.cm-image-preview-broken': {
        color: 'var(--muted-foreground)',
        fontSize: '0.85em',
    },

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
        // --wrap-extra (set per line by the hanging-indent plugin) is the
        // extra height of wrapped lines; without it the guide would only
        // cover the first visual row and leave gaps under wraps.
        bottom: 'calc(-0.36em - var(--wrap-extra, 0px))',
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

    '.cm-codeblock': {
        position: 'relative',
        backgroundColor: 'color-mix(in oklab, var(--muted) 55%, transparent)',
        fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Mono', monospace",
        fontSize: '0.86em',
        paddingRight: '34px',
    },
    '.cm-codeblock-first': {
        borderRadius: '8px 8px 0 0',
        marginTop: '2px',
    },
    '.cm-codeblock-last': {
        borderRadius: '0 0 8px 8px',
        marginBottom: '2px',
    },
    '.cm-codeblock-first.cm-codeblock-last': {
        borderRadius: '8px',
    },
    '.cm-codeblock-fence': {
        color: 'var(--muted-foreground)',
        opacity: '0.75',
    },
    // Inline-code chip styling bleeds into fenced blocks (both carry the
    // monospace tag) — the block already has its own background.
    '.cm-codeblock span': {
        backgroundColor: 'transparent',
    },
    '.cm-copy-btn': {
        position: 'absolute',
        right: '6px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
        height: '20px',
        borderRadius: '5px',
        border: '1px solid transparent',
        color: 'var(--muted-foreground)',
        backgroundColor: 'transparent',
        cursor: 'pointer',
        opacity: '0',
        transition: 'opacity 100ms ease',
    },
    '.cm-copy-btn svg': {
        width: '13px',
        height: '13px',
        pointerEvents: 'none',
    },
    '.cm-line:hover > .cm-copy-btn': {
        opacity: '1',
    },
    '.cm-copy-btn:hover': {
        color: 'var(--foreground)',
        borderColor: 'var(--border)',
        backgroundColor: 'var(--background)',
    },
    '.cm-copy-btn.cm-copied': {
        opacity: '1',
        color: 'var(--primary)',
        borderColor: 'var(--primary)',
    },

    // text-indent (hanging indents) inherits into inline-block widgets,
    // which establish their own block and would paint their glyph far
    // left of their box. Neutralize it for every widget in a line.
    '.cm-line :is(.cm-bullet-dot, .cm-fold-marker, .cm-check, .cm-sync-glyph, .cm-widgetBuffer)':
        {
            textIndent: '0',
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
    '.cm-check svg': {
        width: '72%',
        height: '72%',
    },
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
        borderColor:
            'color-mix(in oklab, var(--muted-foreground) 55%, transparent)',
        color: 'var(--muted-foreground)',
        backgroundColor: 'color-mix(in oklab, var(--muted) 70%, transparent)',
    },
    '.cm-check-scheduled': {
        borderColor: 'var(--muted-foreground)',
        color: 'var(--muted-foreground)',
    },
    '.cm-line-done': {
        color: 'var(--muted-foreground)',
    },
    '.cm-line-cancelled': {
        color: 'var(--muted-foreground)',
        opacity: '0.7',
    },
    '.cm-task-strike': {
        textDecoration: 'line-through',
        textDecorationColor:
            'color-mix(in oklab, var(--muted-foreground) 55%, transparent)',
        textDecorationThickness: '1px',
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

/** Leading indent + list/task/quote marker of a line (the hanging prefix). */
const HANGING_PREFIX_RE = /^(\s*)(?:[-+*] \[.\] |[-+*] |> |\d+[.)] )?/;

/**
 * Hanging indents: wrapped list, task, and quote lines continue under
 * their text, not at column 0. The font is proportional and markers
 * render as widgets, so prefix widths are measured from the live DOM
 * (cached per prefix string) and applied as line decorations whose
 * negative text-indent/padding pair leaves the first visual line put.
 */
const hangingIndents = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet = Decoration.none;
        widths = new Map<string, number>();
        scheduled = false;

        constructor(readonly view: EditorView) {
            this.decorations = this.build(view);
            this.measure(view);
        }

        update(update: ViewUpdate) {
            // Rebuild on every update: the width-measurement pass finishes
            // with an empty transaction, which carries none of the usual
            // change flags but must still re-apply decorations.
            this.decorations = this.build(update.view);

            if (
                update.docChanged ||
                update.viewportChanged ||
                update.geometryChanged
            ) {
                this.measure(update.view);
            }
        }

        prefixOf(text: string): string {
            return HANGING_PREFIX_RE.exec(text)?.[0] ?? '';
        }

        build(view: EditorView): DecorationSet {
            const builder = new RangeSetBuilder<Decoration>();
            const seen = new Set<number>();

            for (const range of view.visibleRanges) {
                for (let pos = range.from; pos <= range.to; ) {
                    const line = view.state.doc.lineAt(pos);
                    pos = line.to + 1;

                    if (seen.has(line.from)) {
                        continue;
                    }

                    seen.add(line.from);
                    const prefix = this.prefixOf(line.text);
                    const width = this.widths.get(prefix);
                    const styles: string[] = [];

                    if (prefix !== '' && width !== undefined && width > 0) {
                        styles.push(
                            `text-indent:-${width}px`,
                            `padding-left:${width + 4}px`,
                        );
                    }

                    if (prefix !== '') {
                        // Wrapped lines are taller than one row; indent
                        // guides read this to span the whole logical line.
                        const extra =
                            view.lineBlockAt(line.from).height -
                            view.defaultLineHeight;

                        if (extra > 1) {
                            styles.push(`--wrap-extra:${extra}px`);
                        }
                    }

                    if (styles.length > 0) {
                        builder.add(
                            line.from,
                            line.from,
                            Decoration.line({
                                attributes: { style: styles.join(';') },
                            }),
                        );
                    }
                }
            }

            return builder.finish();
        }

        measure(view: EditorView): void {
            const missing: { pos: number; end: number; prefix: string }[] = [];

            for (const range of view.visibleRanges) {
                for (let pos = range.from; pos <= range.to; ) {
                    const line = view.state.doc.lineAt(pos);
                    pos = line.to + 1;
                    const prefix = this.prefixOf(line.text);

                    if (
                        prefix !== '' &&
                        !this.widths.has(prefix) &&
                        !missing.some((entry) => entry.prefix === prefix)
                    ) {
                        missing.push({
                            pos: line.from,
                            end: line.from + prefix.length,
                            prefix,
                        });
                    }
                }
            }

            if (missing.length === 0) {
                return;
            }

            view.requestMeasure({
                read: () => {
                    const measured = new Map<string, number>();

                    for (const entry of missing) {
                        const start = view.coordsAtPos(entry.pos, 1);
                        const end = view.coordsAtPos(entry.end, 1);

                        if (start && end && end.left > start.left) {
                            measured.set(entry.prefix, end.left - start.left);
                        }
                    }

                    return measured;
                },
                write: (measured: Map<string, number>) => {
                    if (measured.size === 0) {
                        return;
                    }

                    measured.forEach((width, prefix) =>
                        this.widths.set(prefix, width),
                    );

                    if (!this.scheduled) {
                        this.scheduled = true;
                        setTimeout(() => {
                            this.scheduled = false;

                            // Empty transaction re-pulls decorations with
                            // the freshly measured widths.
                            view.dispatch({});
                        });
                    }
                },
            });
        }
    },
    { decorations: (plugin) => plugin.decorations },
);

export function donoteMarkdown(callbacks: EditorCallbacks): Extension {
    return [
        history(),
        indentUnit.of('    '),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(highlightStyle),
        decorationsField,
        strikeField,
        codeBlockPlugin,
        foldPersistence,
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
        hangingIndents,
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
            { key: 'Mod-Shift-h', run: (view) => toggleInlineMark(view, '==') },
            { key: 'Mod-Shift-s', run: scheduleTaskCommand },
            { key: 'Mod-Shift-d', run: dueTaskCommand },
            { key: 'Mod-Shift-y', run: makeSyncedLineCommand },
            { key: 'Mod-Shift-1', run: cyclePriorityCommand },
            // Reorder tasks: move the current line (or every line the
            // selection spans) up or down, keeping the selection on it.
            {
                mac: 'Cmd-Ctrl-ArrowUp',
                win: 'Ctrl-Alt-ArrowUp',
                linux: 'Ctrl-Alt-ArrowUp',
                run: moveLineUp,
            },
            {
                mac: 'Cmd-Ctrl-ArrowDown',
                win: 'Ctrl-Alt-ArrowDown',
                linux: 'Ctrl-Alt-ArrowDown',
                run: moveLineDown,
            },
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
