import { resolveScheduleToken } from './dates';

export type LineKind =
    'task' | 'checklist' | 'bullet' | 'heading' | 'empty' | 'text';

export type TaskState = 'open' | 'done' | 'cancelled' | 'scheduled';

export type Priority = 0 | 1 | 2 | 3;

export interface WikiLink {
    target: string;
    display: string;
    /** Character offsets of the whole [[...]] token within the raw line. */
    from: number;
    to: number;
}

export type RepeatRule =
    | {
          kind: 'interval';
          amount: number;
          unit: 'd' | 'w' | 'm' | 'y';
          fromCompletion: boolean;
          raw: string;
      }
    | { kind: 'weekdays'; weekdays: number[]; raw: string }
    | { kind: 'monthday'; day: number; raw: string };

export interface ParsedLine {
    index: number;
    raw: string;
    kind: LineKind;
    /** Indentation width (tabs count as 4). */
    indent: number;
    /** Line index of the task/checklist/bullet this line is nested under. */
    parent: number | null;
    headingLevel: number | null;
    state: TaskState | null;
    /** Task title with markers and metadata tokens stripped. */
    title: string;
    priority: Priority;
    /** Normalized schedule date key (daily/weekly/monthly/quarterly/yearly). */
    schedule: string | null;
    /** Due date as yyyy-mm-dd. */
    due: string | null;
    repeat: RepeatRule | null;
    /** Reminder as minutes since local midnight. */
    reminderMinutes: number | null;
    reminderRaw: string | null;
    tags: string[];
    mentions: string[];
    wikiLinks: WikiLink[];
    /** Synced-line block id (`text ^abc123`), shared across notes. */
    syncId: string | null;
    /** End-of-line comment text (after `//`), excluded from parsing. */
    comment: string | null;
}

const TASK_RE = /^(\s*)([-*])\s\[([ xX>-])\]\s(.*)$/;
const CHECKLIST_RE = /^(\s*)\+\s\[([ xX>-])\]\s(.*)$/;
const BULLET_RE = /^(\s*)([-*+])\s(?!\[[ xX>-]\]\s)(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

const SCHEDULE_RE =
    />(\d{4}-\d{2}-\d{2}|\d{4}-W\d{1,2}|\d{4}-Q[1-4]|\d{4}-\d{2}|\d{4}|today)\b/;
const DUE_RE = /@due\((\d{4}-\d{2}-\d{2})\)/;
const REPEAT_RE = /@repeat\(([^)]+)\)/;
const REMINDER_RE = /@(\d{1,2})(?::(\d{2}))?(am|pm)?(?![\w(])/i;
const TAG_RE = /(^|[^\w#&])#([A-Za-z][\w/-]*)/g;
const MENTION_RE = /(^|[^\w@.])@([A-Za-z][\w/.-]*)/g;
const WIKI_LINK_RE = /\[\[([^\]|\n]+?)(?:\s*\|\s*([^\]\n]*?))?\]\]/g;
const PRIORITY_RE = /^(!{1,3})\s+/;
export const SYNC_ID_RE = /\s\^([a-z0-9]{4,12})\s*$/;
/** `// comment` — requires start-of-text or whitespace so URLs stay intact. */
export const COMMENT_RE = /(^|\s)\/\/.*$/;

const WEEKDAY_NAMES: Record<string, number> = {
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
    sun: 7,
    sunday: 7,
};

/** Words that look like mentions but are metadata tokens. */
const RESERVED_MENTIONS = new Set(['due', 'repeat']);

function stateFromChar(char: string): TaskState {
    switch (char) {
        case 'x':
        case 'X':
            return 'done';
        case '-':
            return 'cancelled';
        case '>':
            return 'scheduled';
        default:
            return 'open';
    }
}

function indentWidth(whitespace: string): number {
    let width = 0;

    for (const char of whitespace) {
        width += char === '\t' ? 4 : 1;
    }

    return width;
}

/** Parse the payload of an @repeat(...) token. */
export function parseRepeatRule(payload: string): RepeatRule | null {
    const raw = payload.trim();

    const interval = raw.match(/^(\+)?(\d+)([dwmy])$/i);

    if (interval) {
        return {
            kind: 'interval',
            amount: Number(interval[2]),
            unit: interval[3].toLowerCase() as 'd' | 'w' | 'm' | 'y',
            fromCompletion: interval[1] === '+',
            raw,
        };
    }

    const monthday = raw.match(/^(\d{1,2})(st|nd|rd|th)$/i);

    if (monthday) {
        const day = Number(monthday[1]);

        return day >= 1 && day <= 31 ? { kind: 'monthday', day, raw } : null;
    }

    const parts = raw.split(',').map((part) => part.trim().toLowerCase());

    if (parts.length > 0 && parts.every((part) => part in WEEKDAY_NAMES)) {
        const weekdays = [
            ...new Set(parts.map((part) => WEEKDAY_NAMES[part])),
        ].sort();

        return { kind: 'weekdays', weekdays, raw };
    }

    return null;
}

function parseReminder(text: string): { minutes: number; raw: string } | null {
    const match = text.match(REMINDER_RE);

    if (!match) {
        return null;
    }

    const [token, hourPart, minutePart, meridiem] = match;

    // A bare "@8" is treated as a mention-like token, not a time.
    if (!minutePart && !meridiem) {
        return null;
    }

    let hours = Number(hourPart);
    const minutes = Number(minutePart ?? '0');

    if (hours > 23 || minutes > 59) {
        return null;
    }

    if (meridiem) {
        if (hours < 1 || hours > 12) {
            return null;
        }

        hours = (hours % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
    }

    return { minutes: hours * 60 + minutes, raw: token };
}

/** Extract wiki links with their positions from a raw line. */
export function extractWikiLinks(text: string): WikiLink[] {
    const links: WikiLink[] = [];

    for (const match of text.matchAll(WIKI_LINK_RE)) {
        const target = match[1].trim();

        if (target === '') {
            continue;
        }

        links.push({
            target,
            display: (match[2] ?? '').trim() || target,
            from: match.index,
            to: match.index + match[0].length,
        });
    }

    return links;
}

const URL_RE = /https?:\/\/[^\s)]+/g;

/**
 * Blank out URLs (with equal-length spaces so offsets stay valid) before
 * scanning for tags/mentions — a "#fragment" or "@handle" living inside a
 * link like https://mail.google.com/…#inbox/abc is not a tag or mention.
 */
function maskUrls(text: string): string {
    return text.replace(URL_RE, (url) => ' '.repeat(url.length));
}

function extractTags(text: string): string[] {
    const tags = new Set<string>();

    for (const match of maskUrls(text).matchAll(TAG_RE)) {
        tags.add(match[2]);
    }

    return [...tags];
}

function extractMentions(text: string): string[] {
    const mentions = new Set<string>();
    const masked = maskUrls(text);

    for (const match of masked.matchAll(MENTION_RE)) {
        const name = match[2];
        const offset = match.index + match[1].length;
        const after = masked[offset + name.length + 1];

        if (RESERVED_MENTIONS.has(name.toLowerCase()) && after === '(') {
            continue;
        }

        mentions.add(name);
    }

    return [...mentions];
}

/**
 * Reduce inline markdown to its readable text for display in task lists:
 * `[label](url)`/`![alt](url)` → the label, and emphasis/code/strike/
 * highlight markers drop while their content stays. The emphasis patterns
 * are guarded against intraword underscores/asterisks (snake_case, a * b)
 * so only real emphasis is unwrapped.
 */
function stripInlineMarkdown(text: string): string {
    return text
        .replace(/!?\[([^\]\n]+)\]\([^)\s]*\)/g, '$1')
        .replace(/\*\*([^*\n]+)\*\*/g, '$1')
        .replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, '$1')
        .replace(/__([^_\n]+)__/g, '$1')
        .replace(/(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/g, '$1')
        .replace(/~~([^~\n]+)~~/g, '$1')
        .replace(/==([^=\n]+)==/g, '$1')
        .replace(/`([^`\n]+)`/g, '$1');
}

/** Strip metadata tokens (schedule, due, repeat, reminder) from a task title. */
function cleanTitle(text: string): string {
    return stripInlineMarkdown(
        text.replace(
            WIKI_LINK_RE,
            (_match, target: string, display?: string) =>
                (display ?? '').trim() || target.trim(),
        ),
    )
        .replace(SCHEDULE_RE, '')
        .replace(DUE_RE, '')
        .replace(REPEAT_RE, '')
        .replace(REMINDER_RE, (token, _h, m, mer) =>
            m !== undefined || mer !== undefined ? '' : token,
        )
        .replace(SYNC_ID_RE, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/** Parse one raw markdown line into its structural parts. */
export function parseLine(raw: string, index = 0): ParsedLine {
    const line: ParsedLine = {
        index,
        raw,
        kind: 'text',
        indent: 0,
        parent: null,
        headingLevel: null,
        state: null,
        title: '',
        priority: 0,
        schedule: null,
        due: null,
        repeat: null,
        reminderMinutes: null,
        reminderRaw: null,
        tags: [],
        mentions: [],
        wikiLinks: extractWikiLinks(raw),
        syncId: raw.match(SYNC_ID_RE)?.[1] ?? null,
        comment: null,
    };

    if (raw.trim() === '') {
        line.kind = 'empty';

        return line;
    }

    const heading = raw.match(HEADING_RE);

    if (heading) {
        line.kind = 'heading';
        line.headingLevel = heading[1].length;
        line.title = heading[2].trim();
        line.tags = extractTags(raw);
        line.mentions = extractMentions(raw);

        return line;
    }

    let body: string | null = null;

    const task = raw.match(TASK_RE);
    const checklist = raw.match(CHECKLIST_RE);

    if (task) {
        line.kind = 'task';
        line.indent = indentWidth(task[1]);
        line.state = stateFromChar(task[3]);
        body = task[4];
    } else if (checklist) {
        line.kind = 'checklist';
        line.indent = indentWidth(checklist[1]);
        line.state = stateFromChar(checklist[2]);
        body = checklist[3];
    } else {
        const bullet = raw.match(BULLET_RE);

        if (bullet) {
            line.kind = 'bullet';
            line.indent = indentWidth(bullet[1]);
            body = bullet[3];
        } else {
            line.kind = 'text';
            const leading = raw.match(/^(\s*)/);
            line.indent = indentWidth(leading?.[1] ?? '');
            body = raw.trim();
        }
    }

    const commentMatch = body.match(COMMENT_RE);

    if (commentMatch && commentMatch.index !== undefined) {
        const start = commentMatch.index + commentMatch[1].length;
        line.comment = body.slice(start + 2).trim();
        body = body.slice(0, commentMatch.index).trimEnd();
    }

    const metaStripped = body
        .replace(DUE_RE, '')
        .replace(REPEAT_RE, '')
        .replace(SCHEDULE_RE, '');
    line.tags = extractTags(metaStripped);
    line.mentions = extractMentions(metaStripped);

    if (line.kind === 'task' || line.kind === 'checklist') {
        const schedule = body.match(SCHEDULE_RE);

        if (schedule) {
            line.schedule = resolveScheduleToken(schedule[1]);
        }

        const due = body.match(DUE_RE);

        if (due) {
            line.due = due[1];
        }

        const repeat = body.match(REPEAT_RE);

        if (repeat) {
            line.repeat = parseRepeatRule(repeat[1]);
        }

        const reminder = parseReminder(body);

        if (reminder) {
            line.reminderMinutes = reminder.minutes;
            line.reminderRaw = reminder.raw;
        }

        let title = cleanTitle(body);
        const priority = title.match(PRIORITY_RE);

        if (priority) {
            line.priority = priority[1].length as Priority;
            title = title.replace(PRIORITY_RE, '').trim();
        }

        line.title = title;
    } else {
        line.title = body.trim();
    }

    return line;
}

/** Parse a whole note and link indented lines to their parent task/checklist/bullet. */
export function parseNote(content: string): ParsedLine[] {
    const lines = content
        .split('\n')
        .map((raw, index) => parseLine(raw, index));

    const stack: { index: number; indent: number }[] = [];

    for (const line of lines) {
        if (line.kind === 'empty') {
            continue;
        }

        if (line.kind === 'heading') {
            stack.length = 0;
            continue;
        }

        while (
            stack.length > 0 &&
            stack[stack.length - 1].indent >= line.indent
        ) {
            stack.pop();
        }

        line.parent = stack.length > 0 ? stack[stack.length - 1].index : null;

        if (
            line.kind === 'task' ||
            line.kind === 'checklist' ||
            line.kind === 'bullet'
        ) {
            stack.push({ index: line.index, indent: line.indent });
        }
    }

    return lines;
}

/** All open tasks (and optionally checklists) of a parsed note. */
export function tasksOf(
    lines: ParsedLine[],
    includeChecklists = false,
): ParsedLine[] {
    return lines.filter(
        (line) =>
            line.kind === 'task' ||
            (includeChecklists && line.kind === 'checklist'),
    );
}

/** Direct + transitive children of a line (its indented context block). */
export function childrenOf(lines: ParsedLine[], index: number): ParsedLine[] {
    const result: ParsedLine[] = [];
    const family = new Set([index]);

    for (const line of lines) {
        if (line.parent !== null && family.has(line.parent)) {
            family.add(line.index);
            result.push(line);
        }
    }

    return result;
}
