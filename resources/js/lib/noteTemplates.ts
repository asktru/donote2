/**
 * Note templates: any note living in the Templates folder can be
 * instantiated into a fresh note for a chosen month (NotePlan-style).
 *
 * Template anatomy (every part optional, in this order):
 *
 *     ---                      template metadata (dropped on generation)
 *     title: …
 *     type: empty-note
 *     ---
 *     --                       front matter FOR THE GENERATED NOTE,
 *     type: project            delimited with `--` so it doesn't clash
 *     --                       with the template's own front matter
 *     # Title with %tokens%    becomes the generated note's title
 *     …body…
 *
 * Date placeholders use a strict whitelist — note bodies contain
 * URL-encoded sequences (`%20reports%`, `%2Cin%`) that a generic
 * `%…%` regex would destroy.
 */

export const TEMPLATE_FOLDER = 'Templates';

export function isTemplateNote(note: { folder: string }): boolean {
    return (
        note.folder === TEMPLATE_FOLDER ||
        note.folder.startsWith(`${TEMPLATE_FOLDER}/`)
    );
}

export interface TemplateMonth {
    /** Full year, e.g. 2026. */
    year: number;
    /** 1-based month, 1–12. */
    month: number;
}

export interface RenderedTemplate {
    title: string;
    content: string;
}

const TOKEN_RE =
    /%(year|yearShort|month|month0|monthName|prevYear|prevYearShort|prevMonth|prevMonth0|prevMonthName)%/g;

function monthName(year: number, month: number): string {
    return new Date(year, month - 1, 1).toLocaleString('en-US', {
        month: 'long',
    });
}

function tokenValues(target: TemplateMonth): Record<string, string> {
    const prev: TemplateMonth =
        target.month === 1
            ? { year: target.year - 1, month: 12 }
            : { year: target.year, month: target.month - 1 };

    return {
        year: String(target.year),
        yearShort: String(target.year % 100).padStart(2, '0'),
        month: String(target.month),
        month0: String(target.month).padStart(2, '0'),
        monthName: monthName(target.year, target.month),
        prevYear: String(prev.year),
        prevYearShort: String(prev.year % 100).padStart(2, '0'),
        prevMonth: String(prev.month),
        prevMonth0: String(prev.month).padStart(2, '0'),
        prevMonthName: monthName(prev.year, prev.month),
    };
}

export function substituteTokens(text: string, target: TemplateMonth): string {
    const values = tokenValues(target);

    return text.replace(TOKEN_RE, (_match, token: string) => values[token]);
}

interface TemplateParts {
    /** Inner `--`…`--` block, already re-delimited as regular front matter. */
    frontMatter: string | null;
    /** The `# …` line's text, tokens not yet substituted. */
    titleTemplate: string | null;
    body: string;
}

/** Find the line index closing a block opened at `start` with `fence`. */
function closingFence(lines: string[], start: number, fence: string): number {
    for (let i = start + 1; i < lines.length; i++) {
        if (lines[i].trim() === fence) {
            return i;
        }
    }

    return -1;
}

export function parseTemplateParts(content: string): TemplateParts {
    const lines = content.split('\n');
    let cursor = 0;

    // Template metadata block — describes the template, never the output.
    if (lines[cursor]?.trim() === '---') {
        const close = closingFence(lines, cursor, '---');

        if (close !== -1) {
            cursor = close + 1;
        }
    }

    while (lines[cursor]?.trim() === '') {
        cursor++;
    }

    // Front matter destined for the generated note.
    let frontMatter: string | null = null;

    if (lines[cursor]?.trim() === '--') {
        const close = closingFence(lines, cursor, '--');

        if (close !== -1) {
            frontMatter = lines.slice(cursor + 1, close).join('\n');
            cursor = close + 1;
        }
    }

    while (lines[cursor]?.trim() === '') {
        cursor++;
    }

    // A leading `# Heading` names the generated note.
    let titleTemplate: string | null = null;
    const heading = lines[cursor]?.match(/^#\s+(.*)$/);

    if (heading) {
        titleTemplate = heading[1].trim();
        cursor++;

        if (lines[cursor]?.trim() === '') {
            cursor++;
        }
    }

    return { frontMatter, titleTemplate, body: lines.slice(cursor).join('\n') };
}

/**
 * Instantiate a template for the given month. `fallbackTitle` (usually the
 * template note's own title) is used when the template has no `# …` line.
 */
export function renderTemplate(
    content: string,
    fallbackTitle: string,
    target: TemplateMonth,
): RenderedTemplate {
    const parts = parseTemplateParts(content);

    const title = substituteTokens(
        parts.titleTemplate ?? fallbackTitle,
        target,
    );

    const assembled =
        parts.frontMatter !== null
            ? `---\n${parts.frontMatter}\n---\n${parts.body}`
            : parts.body;

    return { title, content: substituteTokens(assembled, target) };
}

/** The month a freshly opened dialog should suggest: the previous one. */
export function defaultTemplateMonth(now = new Date()): TemplateMonth {
    return now.getMonth() === 0
        ? { year: now.getFullYear() - 1, month: 12 }
        : { year: now.getFullYear(), month: now.getMonth() };
}
