/**
 * Pure parsing helpers for GFM pipe tables, kept out of the editor module so
 * they can be unit-tested without CodeMirror. The editor's table decoration
 * renders a row as an HTML `<table>` when the cursor is elsewhere; these
 * functions turn the raw markdown lines into cells and per-column alignment.
 */

export type ColumnAlign = 'left' | 'center' | 'right' | null;

/** Split a table row into trimmed cells, tolerating optional edge pipes. */
export function splitTableRow(line: string): string[] {
    let text = line.trim();

    if (text.startsWith('|')) {
        text = text.slice(1);
    }

    if (text.endsWith('|') && !text.endsWith('\\|')) {
        text = text.slice(0, -1);
    }

    // Split on unescaped pipes, then restore any escaped ones.
    return text
        .split(/(?<!\\)\|/)
        .map((cell) => cell.replace(/\\\|/g, '|').trim());
}

/**
 * If the line is a GFM delimiter row (`|---|:--:|`), return the per-column
 * alignment; otherwise null. This is what distinguishes a table from an
 * ordinary run of pipe-containing lines.
 */
export function tableAligns(line: string): ColumnAlign[] | null {
    if (!line.includes('-')) {
        return null;
    }

    const cells = splitTableRow(line);

    if (cells.length === 0) {
        return null;
    }

    const aligns: ColumnAlign[] = [];

    for (const cell of cells) {
        if (!/^:?-+:?$/.test(cell)) {
            return null;
        }

        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        aligns.push(
            left && right ? 'center' : right ? 'right' : left ? 'left' : null,
        );
    }

    return aligns;
}

/** A candidate table row: has a pipe and isn't blank. */
export function isTableRow(text: string): boolean {
    return text.trim() !== '' && text.includes('|');
}
