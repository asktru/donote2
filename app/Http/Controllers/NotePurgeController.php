<?php

namespace App\Http\Controllers;

use App\Models\Note;
use App\Models\Team;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotePurgeController extends Controller
{
    /**
     * Permanently delete trashed notes ("Delete forever" / "Empty trash").
     * Only the owner can purge, and only notes already in the trash —
     * a live note must be trashed first so the deletion syncs to every
     * device before the row disappears for good.
     */
    public function __invoke(Request $request, Team $current_team): JsonResponse
    {
        $validated = $request->validate([
            'ids' => ['required', 'array', 'max:500'],
            'ids.*' => ['string', 'uuid'],
        ]);

        $notes = Note::onlyTrashed()
            ->where('team_id', $current_team->id)
            ->where('user_id', $request->user()->id)
            ->whereIn('id', $validated['ids'])
            ->get();

        foreach ($notes as $note) {
            $note->forceDelete();
        }

        return response()->json(['purged' => $notes->count()]);
    }
}
