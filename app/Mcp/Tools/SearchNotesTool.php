<?php

namespace App\Mcp\Tools;

use App\Mcp\Tools\Concerns\InteractsWithWorkspace;
use App\Models\Note;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\JsonSchema\Types\Type;
use Illuminate\Support\Str;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tool;

#[Description('Full-text search across all notes in the workspace (titles and content). Use this to find notes when you do not know their exact title.')]
class SearchNotesTool extends Tool
{
    use InteractsWithWorkspace;

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response
    {
        $validated = $request->validate([
            'query' => ['required', 'string', 'max:200'],
        ], [
            'query.required' => 'Provide a search query, e.g. "kafka" or "quarterly okrs".',
        ]);

        $user = $this->resolveUser($request);
        $team = $user !== null ? $this->resolveTeam($user) : null;

        if ($user === null || $team === null) {
            return Response::error('No workspace available. Set DONOTE_MCP_USER_EMAIL to an existing account.');
        }

        $notes = Note::search($validated['query'])
            ->where('team_id', $team->id)
            ->where('user_id', $user->id)
            ->take(20)
            ->get();

        if ($notes->isEmpty()) {
            return Response::text('No notes match that query.');
        }

        return Response::text(
            $notes->map(function (Note $note) use ($validated): string {
                $position = mb_stripos($note->content, $validated['query']);
                $snippet = $position === false
                    ? Str::limit(trim($note->content), 100)
                    : Str::limit(trim(mb_substr($note->content, max(0, $position - 30))), 100);

                return $this->summarize($note)."\n  ".str_replace("\n", ' ', $snippet);
            })->implode("\n"),
        );
    }

    /**
     * Get the tool's input schema.
     *
     * @return array<string, Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'query' => $schema->string()
                ->description('Search terms to match against note titles and content.')
                ->required(),
        ];
    }
}
