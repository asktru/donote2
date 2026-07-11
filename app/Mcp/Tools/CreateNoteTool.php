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

#[Description('Create a new note. Folders are created implicitly by the folder path. Optionally make it a typed note (project/area/list) with front matter.')]
class CreateNoteTool extends Tool
{
    use InteractsWithWorkspace;

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:512'],
            'content' => ['nullable', 'string', 'max:2000000'],
            'folder' => ['nullable', 'string', 'max:512'],
            'note_type' => ['nullable', 'in:project,area,list'],
        ], [
            'title.required' => 'Provide a title for the new note.',
            'note_type.in' => 'note_type must be one of: project, area, list.',
        ]);

        $user = $this->resolveUser($request);
        $team = $user !== null ? $this->resolveTeam($user) : null;

        if ($user === null || $team === null) {
            return Response::error('No workspace available. Set DONOTE_MCP_USER_EMAIL to an existing account.');
        }

        $title = trim($validated['title']);

        $duplicate = Note::query()
            ->forWorkspace($team, $user)
            ->where('type', 'note')
            ->whereRaw('LOWER(title) = ?', [strtolower($title)])
            ->exists();

        if ($duplicate) {
            return Response::error("A note titled \"{$title}\" already exists. Use update-note or append-to-note instead, or pick a different title.");
        }

        $content = $validated['content'] ?? '';

        if (! empty($validated['note_type']) && ! str_starts_with($content, '---')) {
            $content = "---\ntype: {$validated['note_type']}\n---\n".$content;
        }

        $note = $this->writeNote($team, $user, null, [
            'title' => $title,
            'content' => $content,
            'folder' => trim($validated['folder'] ?? '', '/'),
        ]);

        return Response::text("Created note \"{$title}\" (id: {$note->id}). It will appear on all of the user's devices within seconds.");
    }

    /**
     * Get the tool's input schema.
     *
     * @return array<string, Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'title' => $schema->string()->description('Title of the new note.')->required(),
            'content' => $schema->string()->description('Initial markdown content (see the server instructions for the task syntax).'),
            'folder' => $schema->string()->description('Folder path like "Projects" or "Areas/Health". Created implicitly; omit for the top level.'),
            'note_type' => $schema->string()->enum(['project', 'area', 'list'])->description('Make this a typed note by adding front matter.'),
        ];
    }
}
