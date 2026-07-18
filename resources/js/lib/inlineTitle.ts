export type InlineKind =
    | 'plain'
    | 'bold'
    | 'italic'
    | 'code'
    | 'highlight'
    | 'tag'
    | 'mention'
    | 'wikilink'
    | 'link';

export interface InlineSegment {
    kind: InlineKind;
    text: string;
}

const BOLD = /^\*\*([^*]+)\*\*/;
const HIGHLIGHT = /^==([^=]+)==/;
const CODE = /^`([^`]+)`/;
const ITALIC = /^\*([^*\n]+)\*/;
const WIKILINK = /^\[\[([^\]|\n]+?)(?:\s*\|\s*([^\]\n]+?))?\]\]/;
const LINK = /^\[([^\]\n]+)\]\(([^)\n]+)\)/;
const TAG = /^#([A-Za-z][\w/-]*)/;
const MENTION = /^@([A-Za-z][\w/.-]*)/;

/** A #tag / @mention only starts on a non-word boundary (mid-word `a#b` is not one). */
function atBoundary(text: string, index: number, sigil: '#' | '@'): boolean {
    if (index === 0) {
        return true;
    }

    const prev = text[index - 1];

    return sigil === '#' ? !/[\w#&]/.test(prev) : !/[\w@.]/.test(prev);
}

/**
 * Split a task title's raw markdown into styled segments so list views render
 * bold, tags, mentions, etc. the same way the editor does — instead of showing
 * literal `**` and plain-text `#tags`. Left-to-right, non-overlapping.
 */
export function inlineSegments(text: string): InlineSegment[] {
    const segments: InlineSegment[] = [];
    let plainStart = 0;
    let i = 0;

    const flushPlain = (end: number): void => {
        if (end > plainStart) {
            segments.push({ kind: 'plain', text: text.slice(plainStart, end) });
        }
    };

    while (i < text.length) {
        const rest = text.slice(i);
        let match: RegExpExecArray | null;
        let segment: InlineSegment | null = null;

        if ((match = BOLD.exec(rest))) {
            segment = { kind: 'bold', text: match[1] };
        } else if ((match = HIGHLIGHT.exec(rest))) {
            segment = { kind: 'highlight', text: match[1] };
        } else if ((match = CODE.exec(rest))) {
            segment = { kind: 'code', text: match[1] };
        } else if ((match = ITALIC.exec(rest))) {
            segment = { kind: 'italic', text: match[1] };
        } else if ((match = WIKILINK.exec(rest))) {
            segment = {
                kind: 'wikilink',
                text: (match[2] ?? match[1]).trim(),
            };
        } else if ((match = LINK.exec(rest))) {
            segment = { kind: 'link', text: match[1] };
        } else if (atBoundary(text, i, '#') && (match = TAG.exec(rest))) {
            segment = { kind: 'tag', text: `#${match[1]}` };
        } else if (atBoundary(text, i, '@') && (match = MENTION.exec(rest))) {
            segment = { kind: 'mention', text: `@${match[1]}` };
        }

        if (segment && match) {
            flushPlain(i);
            segments.push(segment);
            i += match[0].length;
            plainStart = i;
        } else {
            i += 1;
        }
    }

    flushPlain(text.length);

    return segments;
}
