<?php

namespace App\Actions\Notes;

use App\Models\Note;
use App\Models\Team;
use App\Models\User;

/**
 * PHP port of the client's synced-line engine (resources/js/core/syncedLines.ts):
 * lines ending in `^abc123` share their content across notes. Server-side
 * writes (MCP tools) run this so Claude's edits behave like a client's.
 */
class PropagateSyncedLines
{
    protected const SYNC_ID_PATTERN = '/\s\^([a-z0-9]{4,12})\s*$/';

    public function __construct(protected ApplyNoteChange $applyNoteChange) {}

    /**
     * Propagate synced-line edits between two versions of a note to every
     * other note in the workspace. Returns the number of notes updated.
     */
    public function execute(Team $team, User $user, string $oldContent, string $newContent, string $excludeNoteId): int
    {
        $changed = $this->changedSyncedLines($oldContent, $newContent);

        if ($changed === []) {
            return 0;
        }

        $updated = 0;

        $notes = Note::query()
            ->forWorkspace($team, $user)
            ->whereKeyNot($excludeNoteId)
            ->get();

        foreach ($notes as $note) {
            $content = $note->content;
            $dirty = false;

            foreach ($changed as $id => $body) {
                $applied = $this->applySyncedLine($content, $id, $body);

                if ($applied !== null) {
                    $content = $applied;
                    $dirty = true;
                }
            }

            if ($dirty) {
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
        }

        return $updated;
    }

    /**
     * Every synced-line body in a note (line minus leading indentation),
     * grouped by sync id in document order.
     *
     * @return array<string, array<int, string>>
     */
    public function collectSyncedLines(string $content): array
    {
        $byId = [];

        foreach (explode("\n", $content) as $raw) {
            if (preg_match(self::SYNC_ID_PATTERN, $raw, $matches) === 1) {
                $byId[$matches[1]][] = ltrim($raw);
            }
        }

        return $byId;
    }

    /**
     * Sync ids whose body changed between versions, mapped to the new
     * authoritative body. When a note holds several copies of one id and
     * only one was edited, the edited copy wins.
     *
     * @return array<string, string>
     */
    public function changedSyncedLines(string $oldContent, string $newContent): array
    {
        $before = $this->collectSyncedLines($oldContent);
        $after = $this->collectSyncedLines($newContent);
        $changed = [];

        foreach ($after as $id => $bodies) {
            $oldBodies = $before[$id] ?? [];
            $fresh = array_values(array_filter(
                $bodies,
                fn (string $body): bool => ! in_array($body, $oldBodies, true),
            ));

            if ($fresh !== []) {
                $changed[$id] = $fresh[0];
            }
        }

        return $changed;
    }

    /**
     * Replace every line carrying the given sync id with the new body,
     * preserving each occurrence's own indentation. Returns null when
     * nothing changed.
     */
    public function applySyncedLine(string $content, string $id, string $body): ?string
    {
        $lines = explode("\n", $content);
        $changed = false;

        foreach ($lines as $index => $raw) {
            if (preg_match(self::SYNC_ID_PATTERN, $raw, $matches) !== 1 || $matches[1] !== $id) {
                continue;
            }

            preg_match('/^\s*/', $raw, $indent);
            $next = ($indent[0] ?? '').$body;

            if ($raw !== $next) {
                $lines[$index] = $next;
                $changed = true;
            }
        }

        return $changed ? implode("\n", $lines) : null;
    }
}
