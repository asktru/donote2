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

/** Append a top-level line (e.g. a wiki link) at the end of a note. */
export function appendLine(content: string, line: string): string {
    const lines = content === '' ? [] : content.split('\n');

    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }

    lines.push(line, '');

    return lines.join('\n');
}
