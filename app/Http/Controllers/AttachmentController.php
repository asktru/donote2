<?php

namespace App\Http\Controllers;

use App\Actions\Attachments\StoreAttachment;
use App\Models\Attachment;
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

        $attachment = app(StoreAttachment::class)->execute(
            $current_team,
            $request->user(),
            $validated['file'],
            $validated['note_id'] ?? null,
        );

        return response()->json([
            'id' => $attachment->id,
            'name' => $attachment->name,
            'mime' => $attachment->mime,
            'size' => $attachment->size,
            // Relative on purpose: notes sync across devices that reach the
            // server through different hosts (donote.test, the Expose
            // tunnel, a future deployment). An absolute URL would carry one
            // device's host into every other device's session-less origin.
            'url' => route('attachments.show', ['current_team' => $current_team, 'attachment' => $attachment], absolute: false),
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
