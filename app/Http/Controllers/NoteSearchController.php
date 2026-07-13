<?php

namespace App\Http\Controllers;

use App\Models\Note;
use App\Models\Team;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class NoteSearchController extends Controller
{
    /**
     * Search the user's workspace notes via the configured Scout engine.
     */
    public function __invoke(Request $request, Team $current_team): JsonResponse
    {
        $query = (string) $request->string('q')->trim();

        if ($query === '') {
            return response()->json(['results' => []]);
        }

        $user = $request->user();

        // The note_shares subquery isn't expressible as a Scout filter, so
        // match within the team then drop anything the viewer can't see.
        $visibleIds = Note::query()
            ->visibleTo($current_team, $user)
            ->pluck('id')
            ->flip();

        $notes = Note::search($query)
            ->where('team_id', $current_team->id)
            ->take(50)
            ->get()
            ->filter(fn (Note $note): bool => $visibleIds->has($note->id))
            ->take(20)
            ->values();

        return response()->json([
            'results' => $notes->map(fn (Note $note): array => [
                'id' => $note->id,
                'type' => $note->type->value,
                'date_key' => $note->date_key,
                'title' => $note->title,
                'folder' => $note->folder,
                'snippet' => $this->snippet($note->content, $query),
            ]),
        ]);
    }

    /**
     * Extract a short excerpt of the content around the first query match.
     */
    protected function snippet(string $content, string $query): string
    {
        $position = mb_stripos($content, $query);

        if ($position === false) {
            return Str::limit(trim($content), 120);
        }

        $start = max(0, $position - 40);

        return ($start > 0 ? '…' : '').Str::limit(trim(mb_substr($content, $start)), 120);
    }
}
