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

#[Description('List notes in the workspace, optionally filtered by folder or note type. Returns ids you can pass to other tools.')]
class ListNotesTool extends Tool
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

        $query = Note::query()->forWorkspace($team, $user)->orderByDesc('updated_at');

        $folder = $request->get('folder');

        if (is_string($folder) && $folder !== '') {
            $folder = trim($folder, '/');
            $query->where(fn ($q) => $q
                ->where('folder', $folder)
                ->orWhere('folder', 'like', $folder.'/%'));
        }

        $type = $request->get('type');

        if (is_string($type) && $type !== '') {
            $query->where('type', $type);
        }

        $limit = min(max((int) ($request->get('limit') ?? 50), 1), 200);
        $notes = $query->limit($limit)->get();

        if ($notes->isEmpty()) {
            return Response::text('No notes found.');
        }

        return Response::text(
            $notes->map(fn (Note $note): string => $this->summarize($note))->implode("\n"),
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
            'folder' => $schema->string()
                ->description('Only notes in this folder (and its subfolders), e.g. "Projects".'),
            'type' => $schema->string()
                ->enum(['note', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'])
                ->description('Only notes of this storage type. "note" is a regular note; the rest are calendar notes.'),
            'limit' => $schema->integer()
                ->description('Maximum notes to return (default 50, max 200).'),
        ];
    }
}
