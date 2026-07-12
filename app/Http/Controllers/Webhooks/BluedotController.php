<?php

namespace App\Http\Controllers\Webhooks;

use App\Http\Controllers\Controller;
use App\Jobs\ProcessBluedotSummary;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

class BluedotController extends Controller
{
    /**
     * Receive a Bluedot meeting summary and queue it for storage in the
     * recipient's Meetings folder. The recipient is identified by a
     * personal token (mint one with `php artisan bluedot:url`) passed as
     * ?token= or a Bearer header — the webhook is otherwise unauthenticated.
     */
    public function __invoke(Request $request): JsonResponse
    {
        $user = $this->resolveUser($request);

        if ($user === null) {
            return response()->json(['message' => 'Invalid or missing token.'], 401);
        }

        $validated = $request->validate([
            'type' => ['nullable', 'string'],
            'title' => ['nullable', 'string'],
            'summary' => ['nullable', 'string'],
            'summaryV2' => ['nullable', 'string'],
            'createdAt' => ['nullable', 'integer'],
            'attendees' => ['nullable', 'array'],
            'attendees.*' => ['string'],
            'meetingId' => ['nullable', 'string'],
            'videoId' => ['nullable', 'string'],
        ]);

        // Only summary-ready events carry a transcript worth storing.
        $type = $validated['type'] ?? 'video.summary.created';

        if ($type !== 'video.summary.created') {
            return response()->json(['status' => 'ignored', 'type' => $type], 202);
        }

        if (($validated['summaryV2'] ?? $validated['summary'] ?? '') === '') {
            return response()->json(['message' => 'No summary in payload.'], 422);
        }

        ProcessBluedotSummary::dispatch($user->id, $validated);

        return response()->json(['status' => 'queued'], 202);
    }

    private function resolveUser(Request $request): ?User
    {
        $token = $request->query('token');

        if (! is_string($token) || $token === '') {
            $token = $request->bearerToken();
        }

        if (! is_string($token) || $token === '') {
            return null;
        }

        $accessToken = PersonalAccessToken::findToken($token);
        $tokenable = $accessToken?->tokenable;

        return $tokenable instanceof User ? $tokenable : null;
    }
}
