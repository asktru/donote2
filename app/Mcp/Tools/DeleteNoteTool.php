<?php

namespace App\Mcp\Tools;

use App\Actions\Notes\ApplyNoteChange;
use App\Mcp\Tools\Concerns\InteractsWithWorkspace;
use App\Models\Note;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\JsonSchema\Types\Type;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tool;

#[Description('Move a note to the trash (soft delete). Requires the note id — use list-notes or search-notes to find it. Only delete when the user explicitly asks.')]
class DeleteNoteTool extends Tool
{
    use InteractsWithWorkspace;

    /**
     * Handle the tool request.
     */
    public function handle(Request $request, ApplyNoteChange $applyNoteChange): Response
    {
        $validated = $request->validate([
            'id' => ['required', 'uuid'],
        ], [
            'id.required' => 'Provide the id of the note to delete (from list-notes or search-notes).',
        ]);

        $user = $this->resolveUser($request);
        $team = $user !== null ? $this->resolveTeam($user) : null;

        if ($user === null || $team === null) {
            return Response::error('No workspace available. Set DONOTE_MCP_USER_EMAIL to an existing account.');
        }

        $note = Note::query()->forWorkspace($team, $user)->find((string) $validated['id']);

        if ($note === null) {
            return Response::error('Note not found in this workspace.');
        }

        $label = $note->type->value === 'note'
            ? ($note->title !== '' ? $note->title : 'Untitled')
            : "{$note->type->value} {$note->date_key}";

        $applyNoteChange->execute($team, $user, [
            'id' => $note->id,
            'type' => $note->type->value,
            'date_key' => $note->date_key,
            'title' => $note->title,
            'content' => $note->content,
            'folder' => $note->folder,
            'pinned' => $note->pinned,
            'base_version' => $note->version,
            'deleted' => true,
            'client_updated_at' => now()->toISOString(),
        ]);

        return Response::text("Moved \"{$label}\" to the trash.");
    }

    /**
     * Get the tool's input schema.
     *
     * @return array<string, Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'id' => $schema->string()->description('The id of the note to delete.')->required(),
        ];
    }
}
