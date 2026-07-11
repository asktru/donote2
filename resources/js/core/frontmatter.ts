import { differenceInCalendarDays, parseISO } from 'date-fns';

import { todayDailyKey } from './dates';
import { parseRepeatRule } from './parser';
import type { ParsedLine, RepeatRule } from './parser';
import { nextOccurrenceDay } from './repeat';

export type NoteKind = 'project' | 'area' | 'list';

export interface NoteMeta {
    /** Special note type from the front matter, or null for plain notes. */
    type: NoteKind | null;
    /** Review cadence (reuses the @repeat rule grammar: 2w, Sat, 20th…). */
    review: RepeatRule | null;
    /** Date of the last review (yyyy-mm-dd). */
    reviewed: string | null;
    /** Project start date (yyyy-mm-dd). */
    start: string | null;
    /** Project due date (yyyy-mm-dd). */
    due: string | null;
    /** All raw front matter entries. */
    properties: Record<string, string>;
    /** 0-based line index of the closing --- (or -1 without front matter). */
    endLine: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_VALUE_RE = /^([A-Za-z][\w-]*):\s*(.*)$/;
const NOTE_KINDS: NoteKind[] = ['project', 'area', 'list'];

export const EMPTY_META: NoteMeta = {
    type: null,
    review: null,
    reviewed: null,
    start: null,
    due: null,
    properties: {},
    endLine: -1,
};

/**
 * Locate a YAML-ish front matter block: the note must begin with `---` and
 * the block ends at the next `---` line. Returns [start, end] line indexes
 * of the delimiter lines, or null.
 */
export function frontMatterBounds(lines: string[]): [number, number] | null {
    if (lines[0]?.trim() !== '---') {
        return null;
    }

    for (let index = 1; index < Math.min(lines.length, 50); index++) {
        if (lines[index].trim() === '---') {
            return [0, index];
        }
    }

    return null;
}

/** Parse the front matter of a note into typed metadata. */
export function parseNoteMeta(content: string): NoteMeta {
    const lines = content.split('\n');
    const bounds = frontMatterBounds(lines);

    if (bounds === null) {
        return EMPTY_META;
    }

    const properties: Record<string, string> = {};

    for (let index = 1; index < bounds[1]; index++) {
        const match = lines[index].match(KEY_VALUE_RE);

        if (match) {
            properties[match[1].toLowerCase()] = match[2].trim();
        }
    }

    const type = (properties.type ?? '').toLowerCase();
    const reviewed = properties.reviewed ?? '';
    const start = properties.start ?? '';
    const due = properties.due ?? '';

    return {
        type: NOTE_KINDS.includes(type as NoteKind) ? (type as NoteKind) : null,
        review: properties.review ? parseRepeatRule(properties.review) : null,
        reviewed: DATE_RE.test(reviewed) ? reviewed : null,
        start: DATE_RE.test(start) ? start : null,
        due: DATE_RE.test(due) ? due : null,
        properties,
        endLine: bounds[1],
    };
}

/**
 * Insert or update one front matter key, creating the block when the note
 * has none yet. Passing an empty value removes the key.
 */
export function upsertFrontMatterKey(
    content: string,
    key: string,
    value: string,
): string {
    const lines = content.split('\n');
    const bounds = frontMatterBounds(lines);
    const entry = `${key}: ${value}`;

    if (bounds === null) {
        if (value === '') {
            return content;
        }

        return ['---', entry, '---', ...lines].join('\n');
    }

    const keyRe = new RegExp(`^${key}:`, 'i');

    for (let index = 1; index < bounds[1]; index++) {
        if (keyRe.test(lines[index])) {
            if (value === '') {
                lines.splice(index, 1);
            } else {
                lines[index] = entry;
            }

            return lines.join('\n');
        }
    }

    if (value === '') {
        return content;
    }

    lines.splice(bounds[1], 0, entry);

    return lines.join('\n');
}

/**
 * The next date (yyyy-mm-dd) a note should be reviewed. Never-reviewed
 * notes are due immediately.
 */
export function nextReviewDate(
    meta: NoteMeta,
    today: string = todayDailyKey(),
): string | null {
    if (meta.review === null) {
        return null;
    }

    if (meta.reviewed === null) {
        return today;
    }

    return nextOccurrenceDay(meta.review, null, meta.reviewed);
}

/** Whether the note's review is due on (or before) the given day. */
export function isReviewDue(
    meta: NoteMeta,
    today: string = todayDailyKey(),
): boolean {
    const next = nextReviewDate(meta, today);

    return next !== null && next <= today;
}

export interface NoteProgress {
    done: number;
    total: number;
    /** 0..1, or null when the note has no counted tasks. */
    fraction: number | null;
}

/**
 * Completion progress for project/list notes: real tasks only (checklist
 * items don't count) and cancelled tasks are excluded entirely.
 */
export function noteProgress(lines: ParsedLine[]): NoteProgress {
    let done = 0;
    let total = 0;

    for (const line of lines) {
        if (line.kind !== 'task' || line.state === 'cancelled') {
            continue;
        }

        total += 1;

        if (line.state === 'done') {
            done += 1;
        }
    }

    return { done, total, fraction: total > 0 ? done / total : null };
}

/**
 * Whole days from `today` until the date key: positive = in the future,
 * 0 = today, negative = overdue/past.
 */
export function daysUntil(
    dateKey: string,
    today: string = todayDailyKey(),
): number {
    return differenceInCalendarDays(parseISO(dateKey), parseISO(today));
}

/** Things-style human label for a due date. */
export function dueLabel(due: string, today: string = todayDailyKey()): string {
    const days = daysUntil(due, today);

    if (days === 0) {
        return 'due today';
    }

    if (days === 1) {
        return 'due tomorrow';
    }

    if (days > 1) {
        return `${days}d left`;
    }

    if (days === -1) {
        return '1d overdue';
    }

    return `${-days}d overdue`;
}

/** Is the note's start date still in the future (project not started)? */
export function startsInFuture(
    meta: NoteMeta,
    today: string = todayDailyKey(),
): boolean {
    return meta.start !== null && daysUntil(meta.start, today) > 0;
}
