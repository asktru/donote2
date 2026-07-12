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
    ) {}

    /**
     * Write a note through the same pipeline the sync API uses (version and
     * sequence bumps so every client pulls the change), then propagate any
     * edited synced lines (^id) to their copies in other notes.
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

        $result = $this->applyNoteChange->execute($team, $user, [
            'id' => $attributes['id'] ?? $defaults['id'],
            'type' => $attributes['type'] ?? $defaults['type'],
            'date_key' => $attributes['date_key'] ?? $defaults['date_key'],
            'title' => $attributes['title'] ?? $defaults['title'],
            'content' => $attributes['content'],
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
            $attributes['content'],
            $result['note']->id,
        );

        return $result['note'];
    }
}
