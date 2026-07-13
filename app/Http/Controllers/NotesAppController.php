<?php

namespace App\Http\Controllers;

use App\Models\Team;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class NotesAppController extends Controller
{
    /**
     * Render the notes workspace shell. All note data is loaded and kept
     * client-side (offline-first); this page only bootstraps the workspace.
     */
    public function __invoke(Request $request, Team $current_team): Response
    {
        return Inertia::render('notes/Index', [
            'workspace' => [
                'teamSlug' => $current_team->slug,
                'teamName' => $current_team->name,
                'userId' => $request->user()->id,
            ],
            // Team members drive the note-sharing picker.
            'members' => $current_team->members()
                ->get(['users.id', 'users.name', 'users.email'])
                ->map(fn ($member): array => [
                    'id' => $member->id,
                    'name' => $member->name,
                    'email' => $member->email,
                ])
                ->values(),
            'googleConnected' => $request->user()->googleAccounts()->exists(),
        ]);
    }
}
