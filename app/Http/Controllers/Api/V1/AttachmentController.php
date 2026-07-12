<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Attachments\StoreAttachment;
use App\Http\Controllers\Api\V1\Concerns\ResolvesApiWorkspace;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AttachmentController extends Controller
{
    use ResolvesApiWorkspace;

    public function __construct(public StoreAttachment $storeAttachment) {}

    /**
     * Upload an attachment and return the exact markdown to splice into a
     * note. The embed URL is relative so it resolves on every device
     * regardless of which host they reach the server through.
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file', 'max:51200'],
            'note_id' => ['nullable', 'uuid'],
        ]);

        [$user, $team] = $this->workspace($request);

        $attachment = $this->storeAttachment->execute(
            $team,
            $user,
            $validated['file'],
            $validated['note_id'] ?? null,
        );

        $url = route('attachments.show', [
            'current_team' => $team,
            'attachment' => $attachment,
        ], absolute: false);

        $label = str_replace(['[', ']', '(', ')'], '', $attachment->name);
        $prefix = str_starts_with($attachment->mime, 'image/') ? '!' : '';

        return response()->json([
            'id' => $attachment->id,
            'name' => $attachment->name,
            'mime' => $attachment->mime,
            'size' => $attachment->size,
            'url' => $url,
            'embed' => "{$prefix}[{$label}]({$url})",
        ], 201);
    }
}
