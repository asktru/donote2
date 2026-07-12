<?php

namespace App\Http\Controllers\Api\V1\Concerns;

use App\Models\Note;
use App\Models\Team;
use App\Models\User;
use Illuminate\Http\Request;

trait ResolvesApiWorkspace
{
    /**
     * The workspace a personal API token operates on: the token owner's
     * current team (matching what the MCP server and the apps show).
     *
     * @return array{0: User, 1: Team}
     */
    protected function workspace(Request $request): array
    {
        /** @var User $user */
        $user = $request->user();
        $team = $user->currentTeam ?? $user->personalTeam();

        abort_if($team === null, 403, 'The token owner has no workspace.');

        return [$user, $team];
    }

    /**
     * The JSON shape third-party clients consume for a note, including the
     * links they need to open it later.
     *
     * @return array<string, mixed>
     */
    protected function notePayload(Note $note): array
    {
        return [
            'id' => $note->id,
            'title' => $note->title,
            'folder' => $note->folder,
            'deeplink' => "donote://note/{$note->id}",
            'web_url' => url("/n/{$note->id}"),
            'updated_at' => $note->updated_at?->toISOString(),
        ];
    }
}
