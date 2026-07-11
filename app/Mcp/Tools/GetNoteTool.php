<?php

namespace App\Mcp\Tools;

use App\Mcp\Tools\Concerns\InteractsWithWorkspace;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\JsonSchema\Types\Type;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tool;

#[Description('Read a note\'s full markdown content, located by id, exact title, or calendar date key (2026-07-15 daily, 2026-W29 weekly, 2026-07 monthly, 2026-Q3 quarterly, 2026 yearly).')]
class GetNoteTool extends Tool
{
    use InteractsWithWorkspace;

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response
    {
        $user = $this->resolveUser($request);
        $team = $user !== null ? $this->resolveTeam($user) : null;

        if ($user === null || $team === null) {
            return Response::error('No workspace available. Set DONOTE_MCP_USER_EMAIL to an existing account.');
        }

        $note = $this->locateNote($team, $user, $request);

        if ($note === null) {
            return Response::error('Note not found. Pass an id from list-notes/search-notes, an exact title, or a calendar date key. Calendar notes only exist once something has been written to them.');
        }

        return Response::text($this->summarize($note)."\n\n".$note->content);
    }

    /**
     * Get the tool's input schema.
     *
     * @return array<string, Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'id' => $schema->string()->description('The note id (preferred when known).'),
            'title' => $schema->string()->description('Exact note title (case-insensitive), for regular notes.'),
            'date' => $schema->string()->description('Calendar date key: 2026-07-15 (daily), 2026-W29 (weekly), 2026-07 (monthly), 2026-Q3 (quarterly), 2026 (yearly).'),
        ];
    }
}
