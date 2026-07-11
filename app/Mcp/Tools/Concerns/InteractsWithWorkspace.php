<?php

namespace App\Mcp\Tools\Concerns;

use App\Actions\Notes\ApplyNoteChange;
use App\Actions\Notes\PropagateSyncedLines;
use App\Models\Note;
use App\Models\Team;
use App\Models\User;
use Illuminate\Support\Str;
use Laravel\Mcp\Request;

trait InteractsWithWorkspace
{
    /**
     * Resolve the acting user: the authenticated user on web transports,
     * or the configured account for the local (stdio) transport.
     */
    protected function resolveUser(Request $request): ?User
    {
        $user = $request->user();

        if ($user instanceof User) {
            return $user;
        }

        $email = config('donote.mcp_user_email');

        if (is_string($email) && $email !== '') {
            return User::query()->whereRaw('LOWER(email) = ?', [strtolower($email)])->first();
        }

        return User::query()->orderBy('id')->first();
    }

    /**
     * The team whose workspace the MCP session operates on.
     */
    protected function resolveTeam(User $user): ?Team
    {
        return $user->currentTeam;
    }

    /**
     * Locate a note by id, exact title (case-insensitive), or calendar date
     * key (2026-07-15, 2026-W29, 2026-07, 2026-Q3, 2026).
     */
    protected function locateNote(Team $team, User $user, Request $request): ?Note
    {
        $query = Note::query()->forWorkspace($team, $user);
        $id = $request->get('id');

        if (is_string($id) && $id !== '') {
            return $query->find($id);
        }

        $date = $request->get('date');

        if (is_string($date) && $date !== '') {
            $kind = $this->calendarKindOf($date);

            if ($kind === null) {
                return null;
            }

            return $query->where('type', $kind)->where('date_key', $date)->first();
        }

        $title = $request->get('title');

        if (is_string($title) && $title !== '') {
            return $query
                ->where('type', 'note')
                ->whereRaw('LOWER(title) = ?', [strtolower(trim($title))])
                ->first();
        }

        return null;
    }

    /**
     * Which calendar note type a date key addresses, or null.
     */
    protected function calendarKindOf(string $key): ?string
    {
        return match (true) {
            preg_match('/^\d{4}-\d{2}-\d{2}$/', $key) === 1 => 'daily',
            preg_match('/^\d{4}-W\d{1,2}$/', $key) === 1 => 'weekly',
            preg_match('/^\d{4}-\d{2}$/', $key) === 1 => 'monthly',
            preg_match('/^\d{4}-Q[1-4]$/', $key) === 1 => 'quarterly',
            preg_match('/^\d{4}$/', $key) === 1 => 'yearly',
            default => null,
        };
    }

    /**
     * Write a note through the same pipeline the sync API uses (version and
     * sequence bumps so every client pulls the change), then propagate any
     * edited synced lines (^id) to their copies in other notes.
     *
     * @param  array{id?: string, type?: string, date_key?: ?string, title?: string, content: string, folder?: string}  $attributes
     */
    protected function writeNote(Team $team, User $user, ?Note $existing, array $attributes): Note
    {
        $applyNoteChange = app(ApplyNoteChange::class);

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

        $result = $applyNoteChange->execute($team, $user, [
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

        app(PropagateSyncedLines::class)->execute(
            $team,
            $user,
            $defaults['old_content'],
            $attributes['content'],
            $result['note']->id,
        );

        return $result['note'];
    }

    /**
     * One-line summary of a note for list output.
     */
    protected function summarize(Note $note): string
    {
        $label = $note->type->value === 'note'
            ? ($note->title !== '' ? $note->title : 'Untitled')
            : "{$note->type->value} {$note->date_key}";

        $folder = $note->folder !== '' ? " · folder: {$note->folder}" : '';

        return "- {$label} (id: {$note->id}, type: {$note->type->value}{$folder}, updated: {$note->updated_at?->toDateTimeString()})";
    }
}
