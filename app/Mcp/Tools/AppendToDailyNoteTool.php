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

#[Description('Quick capture: append markdown to a daily note (today by default), creating the note if needed. Ideal for adding tasks, meeting notes, or reminders to the user\'s day.')]
class AppendToDailyNoteTool extends Tool
{
    use InteractsWithWorkspace;

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response
    {
        $validated = $request->validate([
            'text' => ['required', 'string', 'max:100000'],
            'date' => ['nullable', 'date_format:Y-m-d'],
        ], [
            'text.required' => 'Provide the markdown to capture, e.g. "- [ ] Call the vendor @2pm".',
            'date.date_format' => 'The date must be formatted as yyyy-mm-dd, e.g. 2026-07-15.',
        ]);

        $user = $this->resolveUser($request);
        $team = $user !== null ? $this->resolveTeam($user) : null;

        if ($user === null || $team === null) {
            return Response::error('No workspace available. Set DONOTE_MCP_USER_EMAIL to an existing account.');
        }

        $dateKey = $validated['date'] ?? now()->toDateString();

        $note = Note::query()
            ->forWorkspace($team, $user)
            ->where('type', 'daily')
            ->where('date_key', $dateKey)
            ->first();

        $content = rtrim($note !== null ? $note->content : '', "\n");
        $content = ($content === '' ? '' : $content."\n").rtrim($validated['text'], "\n")."\n";

        $updated = $this->writeNote($team, $user, $note, [
            'type' => 'daily',
            'date_key' => $dateKey,
            'title' => '',
            'content' => $content,
        ]);

        return Response::text("Captured into the daily note for {$dateKey} (id: {$updated->id}).");
    }

    /**
     * Get the tool's input schema.
     *
     * @return array<string, Type>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'text' => $schema->string()->description('Markdown to append to the daily note.')->required(),
            'date' => $schema->string()->description('Target day as yyyy-mm-dd. Defaults to today.'),
        ];
    }
}
