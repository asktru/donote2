<?php

namespace App\Http\Controllers;

use App\Models\Attachment;
use App\Models\Note;
use App\Models\Team;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AttachmentController extends Controller
{
    /**
     * Upload an attachment and return the URL to embed in markdown.
     */
    public function store(Request $request, Team $current_team): JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file', 'max:51200'],
            'note_id' => ['nullable', 'uuid'],
        ]);

        $user = $request->user();
        $file = $validated['file'];

        $noteId = null;
        if (! empty($validated['note_id'])) {
            $noteId = Note::withTrashed()
                ->forWorkspace($current_team, $user)
                ->whereKey($validated['note_id'])
                ->value('id');
        }

        $path = $file->store("attachments/{$current_team->id}");

        $attachment = Attachment::create([
            'team_id' => $current_team->id,
            'user_id' => $user->id,
            'note_id' => $noteId,
            'name' => $file->getClientOriginalName(),
            'path' => $path,
            'mime' => $file->getMimeType() ?? 'application/octet-stream',
            'size' => $file->getSize(),
        ]);

        return response()->json([
            'id' => $attachment->id,
            'name' => $attachment->name,
            'mime' => $attachment->mime,
            'size' => $attachment->size,
            'url' => route('attachments.show', ['current_team' => $current_team, 'attachment' => $attachment]),
        ], 201);
    }

    /**
     * Stream an attachment back to its owner.
     */
    public function show(Request $request, Team $current_team, Attachment $attachment): StreamedResponse
    {
        abort_unless(
            $attachment->team_id === $current_team->id && $attachment->user_id === $request->user()->id,
            404,
        );

        return Storage::response($attachment->path, $attachment->name, [
            'Content-Type' => $attachment->mime,
        ]);
    }
}
