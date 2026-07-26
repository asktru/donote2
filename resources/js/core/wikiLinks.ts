/**
 * Rewriting `[[wiki links]]` when the note they point at is renamed.
 *
 * Links resolve by title, so a rename would strand every link to the old one.
 * The target is the only part that moves: a named link (`[[Title|shown as]]`)
 * keeps its label, and so does the exact spacing around the separator, since
 * that is the author's text rather than ours.
 */

/**
 * `[[target]]` / `[[target|label]]`. The second group holds the separator and
 * label verbatim so a rewrite can put them back untouched. Mirrors the
 * parser's link regex, which is what decides where a link actually is.
 */
const WIKI_LINK_RE = /\[\[([^\]|\n]+?)((?:\s*\|\s*)[^\]\n]*?)?\]\]/g;

/** A note rename, as far as the links pointing at it are concerned. */
export interface TitleRename {
    from: string;
    to: string;
}

/**
 * Apply a batch of renames to one note's content, leaving the rest of it —
 * and every link's label — as it was.
 *
 * Every link is considered once, against all the renames: a burst of renaming
 * can shuffle titles around (`A`→`B` alongside `B`→`C`), and a link must land
 * on its note's new title rather than being handed down the chain.
 */
export function applyTitleRenames(
    content: string,
    renames: TitleRename[],
): string {
    // Titles match the way links resolve: trimmed, case-insensitively.
    const byTitle = new Map(
        renames
            .filter(
                (rename) =>
                    rename.from.trim() !== '' && rename.to.trim() !== '',
            )
            .map((rename) => [
                rename.from.trim().toLowerCase(),
                rename.to.trim(),
            ]),
    );

    if (byTitle.size === 0) {
        return content;
    }

    return content.replace(
        WIKI_LINK_RE,
        (whole, target: string, labelPart: string | undefined) => {
            const to = byTitle.get(target.trim().toLowerCase());

            return to === undefined ? whole : `[[${to}${labelPart ?? ''}]]`;
        },
    );
}

/** Point every link aimed at `from` to `to`. */
export function retargetWikiLinks(
    content: string,
    from: string,
    to: string,
): string {
    return applyTitleRenames(content, [{ from, to }]);
}
