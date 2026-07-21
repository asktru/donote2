/**
 * Google Calendar event descriptions arrive as HTML (`<div>`, `<a>`, `<ul>`,
 * `<br>`, …). Render them as readable plain text rather than raw markup:
 * block elements become line breaks, list items get bullets, and links keep
 * their URL. Deliberately produces text (never HTML) so it can be shown with
 * a plain interpolation — no `v-html`, no sanitizer, no injection surface.
 */

const BLOCK_TAGS = new Set([
    'p',
    'div',
    'ul',
    'ol',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'tr',
    'blockquote',
    'section',
    'header',
    'footer',
]);

function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
        // Collapse the source's pretty-print whitespace to single spaces;
        // real line structure comes from the block/br handling below.
        return (node.textContent ?? '').replace(/\s+/g, ' ');
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
    }

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === 'br') {
        return '\n';
    }

    const inner = Array.from(el.childNodes).map(walk).join('');

    if (tag === 'a') {
        const href = el.getAttribute('href')?.trim() ?? '';
        const text = inner.trim();

        // Keep the URL visible when it isn't already the link's text (and
        // isn't a mailto:, where the address is the text anyway).
        if (href && href !== text && !href.startsWith('mailto:')) {
            return text ? `${text} (${href})` : href;
        }

        return inner;
    }

    if (tag === 'li') {
        return `\n• ${inner.trim()}`;
    }

    if (BLOCK_TAGS.has(tag)) {
        return `\n${inner}\n`;
    }

    return inner;
}

/**
 * Convert an HTML fragment to readable plain text. A string with no tags is
 * returned as-is (plain-text descriptions, e.g. from Apple Calendar, pass
 * through untouched apart from entity decoding).
 */
export function htmlToText(html: string): string {
    if (!html.includes('<') && !html.includes('&')) {
        return html.trim();
    }

    if (typeof DOMParser === 'undefined') {
        // Non-browser fallback: strip tags without decoding entities.
        return html
            .replace(/<[^>]+>/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');

    return walk(doc.body)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
