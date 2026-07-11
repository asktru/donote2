<?php

namespace App\Mcp\Tools;

use App\Mcp\Tools\Concerns\InteractsWithWorkspace;
use App\Models\Note;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\JsonSchema\Types\Type;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tool;

#[Description('Replace a note\'s entire markdown content. Read the note with get-note first and send the complete new content — partial content will erase the rest. Edits to synced lines (^id) propagate to their copies in other notes.')]
class UpdateNoteTool extends Tool
{
    use InteractsWithWorkspace;

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response
    {
        $validated = $request->validate([
            'content' => ['present', 'string', 'max:2000000'],
            'title' => ['nullable', 'string', 'max:512'],
        ], [
            'content.present' => 'Provide the complete new markdown content for the note.',
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

        $attributes = ['content' => $validated['content']];

        // A separate new_title argument renames regular notes.
        $newTitle = $request->get('new_title');

        if (is_string($newTitle) && trim($newTitle) !== '' && $note->type->value === 'note') {
            $attributes['title'] = trim($newTitle);
        }

        $updated = $this->writeNote($team, $user, $note, $attributes);

        return Response::text("Updated \"{$this->labelFor($updated)}\" (id: {$updated->id}, now version {$updated->version}).");
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
            'title' => $schema->string()->description('Exact title of the note to update (locator, not the new title).'),
            'date' => $schema->string()->description('Calendar date key locator (e.g. 2026-07-15).'),
            'content' => $schema->string()->description('The COMPLETE new markdown content, replacing everything.')->required(),
            'new_title' => $schema->string()->description('Optionally rename the note (regular notes only).'),
        ];
    }

    private function labelFor(Note $note): string
    {
        return $note->type->value === 'note'
            ? ($note->title !== '' ? $note->title : 'Untitled')
            : "{$note->type->value} {$note->date_key}";
    }
}
