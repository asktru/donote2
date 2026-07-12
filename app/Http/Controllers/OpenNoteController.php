<?php

namespace App\Http\Controllers;

use App\Models\Note;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class OpenNoteController extends Controller
{
    /**
     * Stable per-note URL for deep links (donote://note/<id> resolves
     * here too): redirect into the notes app with the right view — the
     * calendar view for calendar notes, the note view otherwise.
     */
    public function __invoke(Request $request, string $note): RedirectResponse
    {
        $user = $request->user();

        foreach ($user->teams as $team) {
            $found = Note::query()->forWorkspace($team, $user)->find($note);

            if ($found !== null) {
                $view = $found->type->value === 'note'
                    ? "note:{$found->id}"
                    : "{$found->type->value}:{$found->date_key}";

                return redirect()->route('notes', ['current_team' => $team->slug, 'v' => $view]);
            }
        }

        abort(404);
    }
}
