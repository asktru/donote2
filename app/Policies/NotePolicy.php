<?php

namespace App\Policies;

use App\Models\Note;
use App\Models\User;

class NotePolicy
{
    /**
     * The note must belong to a team the user is a member of before any
     * access level is considered.
     */
    protected function inTeam(User $user, Note $note): bool
    {
        return $user->belongsToTeam($note->team);
    }

    /**
     * Determine whether the user can view the note.
     */
    public function view(User $user, Note $note): bool
    {
        return $this->inTeam($user, $note) && $note->accessFor($user)->canRead();
    }

    /**
     * Determine whether the user can change the note's content.
     */
    public function update(User $user, Note $note): bool
    {
        return $this->inTeam($user, $note) && $note->accessFor($user)->canWrite();
    }

    /**
     * Determine whether the user can delete the note (author only).
     */
    public function delete(User $user, Note $note): bool
    {
        return $this->inTeam($user, $note) && $note->accessFor($user)->isOwner();
    }

    /**
     * Determine whether the user can change the note's sharing (author only).
     */
    public function share(User $user, Note $note): bool
    {
        return $this->inTeam($user, $note) && $note->accessFor($user)->isOwner();
    }
}
