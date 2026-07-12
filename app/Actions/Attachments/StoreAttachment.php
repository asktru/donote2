<?php

namespace App\Actions\Attachments;

use App\Models\Attachment;
use App\Models\Note;
use App\Models\Team;
use App\Models\User;
use Illuminate\Http\UploadedFile;

class StoreAttachment
{
    /**
     * Persist an uploaded file and register it as a workspace attachment.
     */
    public function execute(Team $team, User $user, UploadedFile $file, ?string $noteId = null): Attachment
    {
        if ($noteId !== null) {
            $noteId = Note::withTrashed()
                ->forWorkspace($team, $user)
                ->whereKey($noteId)
                ->value('id');
        }

        $path = $file->store("attachments/{$team->id}");

        return Attachment::create([
            'team_id' => $team->id,
            'user_id' => $user->id,
            'note_id' => $noteId,
            'name' => $file->getClientOriginalName(),
            'path' => $path,
            'mime' => $file->getMimeType() ?? 'application/octet-stream',
            'size' => $file->getSize(),
        ]);
    }
}
