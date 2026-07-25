/**
 * Markdown helpers for appending captured content to a daily note.
 */

const AUDIO_MEMO_PARENT = '- [[Audio memo]]';

/**
 * Append `entry` as a nested bullet under the `- [[Audio memo]]` bullet,
 * creating that parent bullet at the end of the note when missing.
 * Multi-line transcripts collapse to a single line so the bullet
 * structure stays intact.
 */
export function appendUnderAudioMemo(content: string, entry: string): string {
    const bullet = `    - ${entry.replace(/\s*\n\s*/g, ' ').trim()}`;
    const lines = content === '' ? [] : content.split('\n');

    const parentIndex = lines.findIndex(
        (line) => line.trimEnd() === AUDIO_MEMO_PARENT,
    );

    if (parentIndex === -1) {
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
            lines.pop();
        }

        if (lines.length > 0) {
            lines.push('');
        }

        lines.push(AUDIO_MEMO_PARENT, bullet, '');

        return lines.join('\n');
    }

    // Insert after the parent's last indented child.
    let insertAt = parentIndex + 1;

    while (
        insertAt < lines.length &&
        lines[insertAt].trim() !== '' &&
        /^\s/.test(lines[insertAt])
    ) {
        insertAt += 1;
    }

    lines.splice(insertAt, 0, bullet);

    return lines.join('\n');
}

/**
 * Append `line` under an `## {heading}` H2, creating the heading (at the end of
 * the note) when it's missing. New lines go after the heading's existing
 * contiguous list, so repeated appends stack in order.
 */
export function appendUnderHeading(
    content: string,
    heading: string,
    line: string,
): string {
    const headingLine = `## ${heading}`;
    const lines = content === '' ? [] : content.split('\n');
    const index = lines.findIndex((l) => l.trimEnd() === headingLine);

    if (index === -1) {
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
            lines.pop();
        }

        if (lines.length > 0) {
            lines.push('');
        }

        lines.push(headingLine, line, '');

        return lines.join('\n');
    }

    let insertAt = index + 1;

    while (insertAt < lines.length && lines[insertAt].trim() !== '') {
        insertAt += 1;
    }

    lines.splice(insertAt, 0, line);

    return lines.join('\n');
}

/** Stitch a recording group's part transcripts, in part order, into one line. */
export function stitchTranscript(
    parts: { part: number; transcript: string | null }[],
): string {
    return [...parts]
        .sort((a, b) => a.part - b.part)
        .map((part) => part.transcript ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * A daily key we trust to be a real, current-era date. A bogus epoch/NaN
 * date (e.g. from a malformed segment timestamp) would otherwise file a
 * transcript into an invisible 1970 note — fall back to today instead.
 */
export function safeDailyKey(dateKey: string, fallback: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);

    if (match === null) {
        return fallback;
    }

    const year = Number(match[1]);

    return year >= 2020 && year <= 2100 ? dateKey : fallback;
}

/** Append a top-level line (e.g. a wiki link) at the end of a note. */
export function appendLine(content: string, line: string): string {
    const lines = content === '' ? [] : content.split('\n');

    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }

    lines.push(line, '');

    return lines.join('\n');
}
