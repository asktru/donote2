/**
 * Paste-time link niceties for the editor:
 * - pasting a URL over selected text wraps the selection as the link title
 * - pasting a bare URL from a known service (ClickUp) gets a readable title
 */

/** The pasted text when it is exactly one http(s) URL, else null. */
export function bareUrl(text: string): string | null {
    const trimmed = text.trim();

    return /^https?:\/\/\S+$/.test(trimmed) ? trimmed : null;
}

/** Human titles for well-known pasted URLs (ClickUp for now). */
export function knownLinkTitle(url: string): string | null {
    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    if (parsed.hostname !== 'app.clickup.com') {
        return null;
    }

    const path = parsed.pathname;

    if (/^\/\d+\/chat\//.test(path)) {
        return 'ClickUp Chat';
    }

    // Task with a custom id: /t/{workspace}/{PROJ-123}
    const custom = /^\/t\/\d+\/([\w-]+)$/.exec(path);

    if (custom) {
        return `ClickUp: ${custom[1]}`;
    }

    // Task short link: /t/{id}
    const short = /^\/t\/([a-z0-9]+)$/i.exec(path);

    if (short) {
        return `ClickUp: ${short[1]}`;
    }

    return 'ClickUp';
}

/**
 * The markdown link to insert for a paste, or null to let the default paste
 * happen. The selection (when non-empty) wins as the title; otherwise only
 * known services get auto-titles — an arbitrary bare URL stays a bare URL.
 */
export function pasteAsMarkdownLink(
    pasted: string,
    selection: string,
): string | null {
    const url = bareUrl(pasted);

    if (url === null) {
        return null;
    }

    const title =
        selection.trim() !== '' ? selection.trim() : knownLinkTitle(url);

    if (title === null) {
        return null;
    }

    return `[${title.replace(/[[\]]/g, '').replace(/\s+/g, ' ')}](${url})`;
}
