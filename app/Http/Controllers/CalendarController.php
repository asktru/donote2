<?php

namespace App\Http\Controllers;

use App\Models\Team;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class CalendarController extends Controller
{
    /**
     * Render the calendar workspace shell. Event data is loaded client-side
     * from the Google proxy + the native Apple bridge, like the notes app.
     */
    public function __invoke(Request $request, Team $current_team): Response
    {
        return Inertia::render('calendar/Index', [
            'workspace' => [
                'teamSlug' => $current_team->slug,
                'teamName' => $current_team->name,
                'userId' => $request->user()->id,
            ],
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
