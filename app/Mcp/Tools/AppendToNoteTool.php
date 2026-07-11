<?php

namespace App\Mcp\Tools;

use App\Mcp\Tools\Concerns\InteractsWithWorkspace;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\JsonSchema\Types\Type;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tool;

#[Description('Append markdown to the end of an existing note without touching the rest of its content. Safer than update-note for adding tasks or notes.')]
class AppendToNoteTool extends Tool
{
    use InteractsWithWorkspace;

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response
    {
        $validated = $request->validate([
            'text' => ['required', 'string', 'max:100000'],
        ], [
            'text.required' => 'Provide the markdown to append, e.g. "- [ ] Follow up with legal >2026-07-20".',
        ]);

        $user = $this->resolveUser($request);
        $team = $user !== null ? $this->resolveTeam($user) : null;

        if ($user === null || $team === null) {
            return Response::error('No workspace available. Set DONOTE_MCP_USER_EMAIL to an existing account.');
        }

        $note = $this->locateNote($team, $user, $request);

        if ($note === null) {
            return Response::error('Note not found. Pass an id, exact title, or calendar date key to locate it.');
        }

        $content = rtrim($note->content, "\n");
        $content = ($content === '' ? '' : $content."\n").rtrim($validated['text'], "\n")."\n";

        $updated = $this->writeNote($team, $user, $note, ['content' => $content]);

        return Response::text("Appended to note (id: {$updated->id}, now version {$updated->version}).");
    }

    /**
     * Get the tool's input schema.
     *
     * @return array<string, Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'id' => $schema->string()->description('The note id (preferred).'),
            'title' => $schema->string()->description('Exact title of the note (case-insensitive).'),
            'date' => $schema->string()->description('Calendar date key locator (e.g. 2026-07-15 or 2026-W29).'),
            'text' => $schema->string()->description('Markdown to append at the end of the note.')->required(),
        ];
    }
}
