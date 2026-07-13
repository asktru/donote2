<?php

namespace App\Http\Controllers;

use App\Actions\Notes\ApplyNoteChange;
use App\Http\Requests\SyncNotesRequest;
use App\Http\Resources\NoteResource;
use App\Models\Note;
use App\Models\Team;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class NoteSyncController extends Controller
{
    /**
     * Pull note changes that happened after the client's cursor.
     */
    public function index(Request $request, Team $current_team): JsonResponse
    {
        $since = (int) $request->query('since', '0');

        $notes = Note::withTrashed()
            ->visibleTo($current_team, $request->user())
            ->with('shares')
            ->where('server_seq', '>', $since)
            ->orderBy('server_seq')
            ->limit(500)
            ->get();

        $last = $notes->last();

        return response()->json([
            'cursor' => $last !== null ? $last->server_seq : $since,
            'has_more' => $notes->count() === 500,
            'notes' => NoteResource::collection($notes),
        ]);
    }

    /**
     * The ids of every note currently visible to the caller — used by the
     * client to prune notes it has lost access to (revoked shares, a note
     * flipped back to private, a departed collaborator).
     */
    public function visibleIds(Request $request, Team $current_team): JsonResponse
    {
        return response()->json([
            'ids' => Note::query()
                ->visibleTo($current_team, $request->user())
                ->pluck('id'),
        ]);
    }

    /**
     * Push a batch of local note changes to the server.
     */
    public function store(SyncNotesRequest $request, Team $current_team, ApplyNoteChange $applyNoteChange): JsonResponse
    {
        $user = $request->user();

        /** @var array<int, array<string, mixed>> $changes */
        $changes = $request->validated('changes');

        $results = collect($changes)->map(
            fn (array $change): array => DB::transaction(
                fn (): array => $applyNoteChange->execute($current_team, $user, $change)
            )
        );

        return response()->json([
            'results' => $results->map(fn (array $result): array => [
                'id' => $result['id'],
                'status' => $result['status'],
                'note' => NoteResource::make($result['note']),
            ]),
        ]);
    }
}
