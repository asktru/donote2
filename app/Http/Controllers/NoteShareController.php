<?php

namespace App\Http\Controllers;

use App\Enums\NoteType;
use App\Http\Requests\UpdateNoteShareRequest;
use App\Models\Note;
use App\Models\Team;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class NoteShareController extends Controller
{
    /**
     * Show a note's current sharing state (author only).
     */
    public function show(Request $request, Team $current_team, Note $note): JsonResponse
    {
        $this->authorizeShare($current_team, $note);

        return response()->json($this->sharingPayload($note));
    }

    /**
     * Replace a note's sharing (author only).
     */
    public function update(UpdateNoteShareRequest $request, Team $current_team, Note $note): JsonResponse
    {
        $this->authorizeShare($current_team, $note);

        abort_if($note->type !== NoteType::Note, 422, 'Only regular notes can be shared.');

        /** @var array<int, array{user_id: int, access: string}> $rawShares */
        $rawShares = $request->validated('shares');

        $incoming = collect($rawShares)
            ->reject(fn (array $share): bool => (int) $share['user_id'] === $note->user_id)
            ->unique('user_id')
            ->values()
            ->all();

        DB::transaction(function () use ($note, $request, $incoming): void {
            $note->team_readable = $request->boolean('team_readable');
            $note->server_seq = Note::nextServerSeq();
            $note->timestamps = false;
            $note->save();
            $note->timestamps = true;

            $note->shares()->delete();

            if ($incoming !== []) {
                $note->shares()->createMany(array_map(fn (array $share): array => [
                    'user_id' => $share['user_id'],
                    'access' => $share['access'],
                ], $incoming));
            }
        });

        return response()->json($this->sharingPayload($note->refresh()));
    }

    /**
     * The note must live in the current team and the caller must be its author.
     */
    protected function authorizeShare(Team $current_team, Note $note): void
    {
        abort_unless($note->team_id === $current_team->id, 404);
        Gate::authorize('share', $note);
    }

    /**
     * @return array{team_readable: bool, shares: array<int, array{user_id: int, access: string}>}
     */
    protected function sharingPayload(Note $note): array
    {
        return [
            'team_readable' => $note->team_readable,
            'shares' => $note->shares()
                ->get()
                ->map(fn ($share): array => [
                    'user_id' => $share->user_id,
                    'access' => $share->access,
                ])
                ->values()
                ->all(),
        ];
    }
}
