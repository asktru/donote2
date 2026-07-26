<?php

namespace App\Actions\Notes;

use App\Models\Note;
use App\Models\Team;
use App\Models\User;
use Illuminate\Support\Str;

class WriteNote
{
    public function __construct(
        private ApplyNoteChange $applyNoteChange,
        private PropagateSyncedLines $propagateSyncedLines,
        private RetargetWikiLinks $retargetWikiLinks,
    ) {}

    /**
     * Write a note through the same pipeline the sync API uses (version and
     * sequence bumps so every client pulls the change), then propagate any
     * edited synced lines (^id) to their copies in other notes and repoint
     * any `[[wiki link]]` left behind by a rename.
     *
     * @param  array{id?: string, type?: string, date_key?: ?string, title?: string, content: string, folder?: string}  $attributes
     */
    public function execute(Team $team, User $user, ?Note $existing, array $attributes): Note
    {
        $defaults = $existing !== null
            ? [
                'id' => $existing->id,
                'type' => $existing->type->value,
                'date_key' => $existing->date_key,
                'title' => $existing->title,
                'folder' => $existing->folder,
                'pinned' => $existing->pinned,
                'base_version' => $existing->version,
                'old_content' => $existing->content,
            ]
            : [
                'id' => (string) Str::uuid(),
                'type' => 'note',
                'date_key' => null,
                'title' => '',
                'folder' => '',
                'pinned' => false,
                'base_version' => 0,
                'old_content' => '',
            ];

        $oldTitle = $defaults['title'];
        $newTitle = $attributes['title'] ?? $oldTitle;
        // Only regular notes carry a title links can point at; an empty
        // "before" leaves the rewrite a no-op for calendar notes and for
        // notes being created.
        $renamedFrom = ($attributes['type'] ?? $defaults['type']) === 'note' ? $oldTitle : '';

        // The note's own links go in with the write it is already making;
        // everyone else's are rewritten below.
        $content = $this->retargetWikiLinks->apply($attributes['content'], $renamedFrom, $newTitle);

        $result = $this->applyNoteChange->execute($team, $user, [
            'id' => $attributes['id'] ?? $defaults['id'],
            'type' => $attributes['type'] ?? $defaults['type'],
            'date_key' => $attributes['date_key'] ?? $defaults['date_key'],
            'title' => $newTitle,
            'content' => $content,
            'folder' => $attributes['folder'] ?? $defaults['folder'],
            'pinned' => $defaults['pinned'],
            'base_version' => $defaults['base_version'],
            'deleted' => false,
            'client_updated_at' => now()->toISOString(),
        ]);

        $this->propagateSyncedLines->execute(
            $team,
            $user,
            $defaults['old_content'],
            $content,
            $result['note']->id,
        );

        $this->retargetWikiLinks->execute(
            $team,
            $user,
            $renamedFrom,
            $newTitle,
            $result['note']->id,
        );

        return $result['note'];
    }
}
