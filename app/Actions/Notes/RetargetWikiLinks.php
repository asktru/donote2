<?php

namespace App\Actions\Notes;

use App\Models\Note;
use App\Models\Team;
use App\Models\User;

/**
 * PHP port of the client's link-rewriting engine (resources/js/core/wikiLinks.ts):
 * `[[wiki links]]` resolve by title, so renaming a note would strand every
 * link pointing at the old one. Server-side writes (MCP tools, the v1 API)
 * run this so a rename made by Claude behaves like one made in the app.
 *
 * Only the target moves: a named link (`[[Title|shown as]]`) keeps its label,
 * and so does the exact spacing around the separator — that is the author's
 * text rather than ours.
 */
class RetargetWikiLinks
{
    /**
     * `[[target]]` / `[[target|label]]`. The second group holds the separator
     * and label verbatim so a rewrite can put them back untouched.
     */
    protected const WIKI_LINK_PATTERN = '/\[\[([^\]|\n]+?)((?:\s*\|\s*)[^\]\n]*?)?\]\]/';

    public function __construct(protected ApplyNoteChange $applyNoteChange) {}

    /**
     * Repoint every link aimed at `$oldTitle` at `$newTitle`, across every
     * note in the workspace bar the one the caller is already writing.
     * Returns the number of notes updated.
     */
    public function execute(Team $team, User $user, string $oldTitle, string $newTitle, string $excludeNoteId): int
    {
        if (! $this->isRename($oldTitle, $newTitle)) {
            return 0;
        }

        $updated = 0;

        $notes = Note::query()
            ->forWorkspace($team, $user)
            ->whereKeyNot($excludeNoteId)
            ->get();

        foreach ($notes as $note) {
            $content = $this->apply($note->content, $oldTitle, $newTitle);

            if ($content === $note->content) {
                continue;
            }

            $this->applyNoteChange->execute($team, $user, [
                'id' => $note->id,
                'type' => $note->type->value,
                'date_key' => $note->date_key,
                'title' => $note->title,
                'content' => $content,
                'folder' => $note->folder,
                'pinned' => $note->pinned,
                'base_version' => $note->version,
                'deleted' => false,
                'client_updated_at' => now()->toISOString(),
            ]);

            $updated++;
        }

        return $updated;
    }

    /**
     * Whether a title change is one the links should follow. A rename out of
     * (or into) an empty title has nothing to match or nothing to write — the
     * link would end up as `[[]]`. Compared exactly, so re-casing a title
     * carries into its links: they resolve either way, but should read like
     * the note does.
     */
    public function isRename(string $oldTitle, string $newTitle): bool
    {
        return trim($oldTitle) !== ''
            && trim($newTitle) !== ''
            && trim($oldTitle) !== trim($newTitle);
    }

    /**
     * Rewrite one note's content, leaving the rest of it — and every link's
     * label — as it was. Titles match the way links resolve: trimmed and
     * case-insensitively.
     */
    public function apply(string $content, string $oldTitle, string $newTitle): string
    {
        if (! $this->isRename($oldTitle, $newTitle)) {
            return $content;
        }

        $from = mb_strtolower(trim($oldTitle));
        $to = trim($newTitle);

        return preg_replace_callback(
            self::WIKI_LINK_PATTERN,
            function (array $matches) use ($from, $to): string {
                if (mb_strtolower(trim($matches[1])) !== $from) {
                    return $matches[0];
                }

                return '[['.$to.($matches[2] ?? '').']]';
            },
            $content,
        ) ?? $content;
    }
}
