<?php

namespace App\Actions\Notes;

use App\Enums\NoteType;
use App\Models\Note;
use App\Models\Team;
use App\Models\User;
use Carbon\CarbonImmutable;

class ApplyNoteChange
{
    /**
     * Apply a single client-side note change to the server workspace.
     *
     * Conflict strategy: an exact base_version match always applies. When the
     * versions diverge (an edit from another device landed first), the change
     * with the newest client timestamp wins (last-write-wins). Losing changes
     * report "conflict" together with the authoritative server copy.
     *
     * Calendar notes are unique per (type, date_key); when two devices create
     * the same calendar note under different ids, the incoming change is
     * redirected onto the existing note and reported as "remapped" so the
     * client can merge the duplicate away.
     *
     * @param  array<string, mixed>  $change
     * @return array{id: string, status: string, note: Note}
     */
    public function execute(Team $team, User $user, array $change): array
    {
        $id = (string) $change['id'];
        $type = NoteType::from($change['type']);
        $clientUpdatedAt = CarbonImmutable::parse($change['client_updated_at'])->min(now());

        $note = Note::withTrashed()
            ->visibleTo($team, $user)
            ->with('shares')
            ->find($id);

        $status = 'applied';

        if ($note === null && Note::withTrashed()->whereKey($id)->exists()) {
            abort(403, 'Note belongs to another workspace.');
        }

        if ($note === null && $type->isCalendar() && $change['date_key'] !== null) {
            $existing = Note::withTrashed()
                ->forWorkspace($team, $user)
                ->where('type', $type)
                ->where('date_key', $change['date_key'])
                ->first();

            if ($existing !== null) {
                $note = $existing;
                $status = 'remapped';
            }
        }

        if ($note === null) {
            return [
                'id' => $id,
                'status' => 'applied',
                'note' => $this->create($team, $user, $type, $change, $clientUpdatedAt),
            ];
        }

        // Authorize the change against the caller's access to an existing note.
        // Deleting or restoring is the author's alone; editing content needs
        // write access.
        $access = $note->accessFor($user);
        $togglesTrash = $change['deleted'] !== $note->trashed();

        if ($togglesTrash && ! $access->isOwner()) {
            abort(403, 'Only the author can delete or restore this note.');
        }

        if (! $togglesTrash && ! $access->canWrite()) {
            abort(403, 'You do not have write access to this note.');
        }

        $applies = $change['base_version'] === $note->version
            || $clientUpdatedAt->greaterThan($note->updated_at);

        if (! $applies) {
            return ['id' => $id, 'status' => 'conflict', 'note' => $note];
        }

        $this->update($note, $change, $clientUpdatedAt);

        return ['id' => $id, 'status' => $status, 'note' => $note->refresh()];
    }

    /**
     * Create a fresh note from a client change.
     *
     * @param  array<string, mixed>  $change
     */
    protected function create(Team $team, User $user, NoteType $type, array $change, CarbonImmutable $clientUpdatedAt): Note
    {
        $note = new Note([
            'id' => $change['id'],
            'team_id' => $team->id,
            'user_id' => $user->id,
            'type' => $type,
            'date_key' => $change['date_key'],
            'title' => $change['title'] ?? '',
            'content' => $change['content'] ?? '',
            'folder' => $change['folder'] ?? '',
            'pinned' => $change['pinned'],
            'version' => 1,
            'server_seq' => Note::nextServerSeq(),
        ]);

        $note->created_at = now();
        $note->updated_at = $clientUpdatedAt;
        $note->timestamps = false;
        $note->save();
        $note->timestamps = true;

        if ($change['deleted']) {
            $note->delete();
        }

        return $note;
    }

    /**
     * Apply a change on top of an existing note.
     *
     * @param  array<string, mixed>  $change
     */
    protected function update(Note $note, array $change, CarbonImmutable $clientUpdatedAt): void
    {
        $note->fill([
            'title' => $change['title'] ?? '',
            'content' => $change['content'] ?? '',
            'folder' => $change['folder'] ?? '',
            'pinned' => $change['pinned'],
            'version' => $note->version + 1,
            'server_seq' => Note::nextServerSeq(),
        ]);

        $note->updated_at = $clientUpdatedAt;
        $note->timestamps = false;
        $note->save();
        $note->timestamps = true;

        if ($change['deleted'] && ! $note->trashed()) {
            $note->delete();
        } elseif (! $change['deleted'] && $note->trashed()) {
            $note->restore();
        }
    }
}
