import { childrenOf } from './parser';
import type { ParsedLine, TaskState } from './parser';

/**
 * The shared notion of "finished" behind both the Done section and subtree
 * completion: a task or checklist item is closed when it is done or
 * cancelled, and open while it is still to do or merely scheduled.
 *
 * Everything else — bullets, headings, prose — is neutral: it is never closed
 * and never open, so it neither blocks nor triggers either feature.
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
