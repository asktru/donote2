import { FOLD_MARKER_RE, parseNote } from './parser';
import type { ParsedLine } from './parser';
import { isClosed, isOpen } from './subtreeState';

/**
 * The `# Done` section: an archive at the end of a note holding work that is
 * finished, with the heading and bullet structure it came from rebuilt inside
 * it, so a project's shape survives its tasks being completed.
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
 * first, then the bullets it hangs under.
 *
 * `from` bounds the heading search and is exclusive — callers pass -1 for the
 * body, so line 0 is still searched, and the Done heading's own index when
 * reading a path inside the section, so the walk stops there instead of
 * escaping into the body above it.
 *
 * Heading levels are always the body's own levels; demotion happens when a
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
 * The ancestor rule has to exclude closed ancestors too, not merely open ones.
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
        if (
            isClosed(lines[index]) &&
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
        if (isOpen(lines[index]) && !hasTaskAncestor(lines, index)) {
            const end = blockEnd(lines, index);
            blocks.push({ start: index, end });
            index = end + 1;
            continue;
        }

        index++;
    }

    return blocks;
}

/**
 * Add a block at the end of the note's *body* — above the Done section when
 * there is one. The section runs to the end of the note, so appending to the
 * end of the text would file new work straight into the archive, where it is
 * collapsed out of sight.
 */
export function appendToBody(content: string, block: string): string {
    const trimmed = block.replace(/\s+$/, '');

    if (trimmed === '') {
        return content;
    }

    const raw = content.split('\n');
    const doneStart = findDoneHeading(raw);

    if (doneStart === -1) {
        const base = content.replace(/\s+$/, '');

        return `${base === '' ? '' : `${base}\n\n`}${trimmed}\n`;
    }

    // Step back over the marker that introduces the section — the `---` and
    // the blank line above it belong to it, not to the body.
    let end = doneStart;

    if (raw[end - 1]?.trim() === '---') {
        end--;
    }

    while (end > 0 && raw[end - 1].trim() === '') {
        end--;
    }

    const body = raw.slice(0, end).join('\n').replace(/\s+$/, '');
    const section = raw.slice(end).join('\n').replace(/^\n+/, '');

    return `${body === '' ? '' : `${body}\n\n`}${trimmed}\n\n${section}`;
}

/** Give the note a Done section if it hasn't got one, collapsed by default. */
export function ensureDoneSection(content: string): string {
    if (findDoneHeading(content.split('\n')) !== -1) {
        return content;
    }

    return `${content.replace(/\s+$/, '')}\n\n---\n${DONE_HEADING_LINE}\n`;
}

/** Last line of a heading's group: up to the next heading of its level or higher. */
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
        step.kind === 'heading' && demote
            ? Math.min(6, step.level + 1)
            : step.kind === 'heading'
              ? step.level
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

        return (
            INDENT.repeat(depth) +
            ' '.repeat(Math.max(0, line.indent - base)) +
            raw.trimStart()
        );
    });
}

/**
 * Insert a block under its path, creating only the rungs that are missing and
 * appending it at the end of the group it lands in, so filing order holds.
 *
 * `target` picks the region and the heading levels: 'done' writes below the
 * section heading with headings demoted, 'body' writes above it with the
 * levels the body uses. The content is re-parsed here, so callers can apply
 * blocks one at a time without tracking how the indexes shift.
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
    let end = lines.length - 1;
    let depth = 0;
    let step = 0;

    // The body ends before the Done marker — separator and all, so lifted
    // work never lands between the `---` and the heading it belongs to.
    if (!demote && doneStart !== -1) {
        end = doneStart - 1;

        if (raw[end]?.trim() === '---') {
            end--;
        }

        end = Math.max(0, end);
    }

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
                // Un-demote: a path read inside Done carries its demoted
                // levels, and the body wants its own back.
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

/** Is there any finished work to file, or re-opened work to lift back out? */
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
            lines.slice(from, to + 1).every((line) => line.kind === 'empty');

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

        // An empty section takes its separator and the blank line with it.
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
