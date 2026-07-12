<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Notes\AppendUnderHeading;
use App\Actions\Notes\WriteNote;
use App\Http\Controllers\Api\V1\Concerns\ResolvesApiWorkspace;
use App\Http\Controllers\Controller;
use App\Models\Note;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DailyNoteController extends Controller
{
    use ResolvesApiWorkspace;

    public function __construct(
        public WriteNote $writeNote,
        public AppendUnderHeading $appendUnderHeading,
    ) {}

    /**
     * Append markdown to a daily note, creating it when absent. With a
     * heading the text lands at the end of that heading's section (the
     * heading itself is created as an H2 when missing); without one it
     * lands at the end of the note. The date key is the client's local
     * date, used as-is — no timezone recompute.
     */
    public function append(Request $request, string $dateKey): JsonResponse
    {
        abort_unless(
            preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateKey) === 1 && strtotime($dateKey) !== false,
            404,
            'The date key must be a calendar day formatted as yyyy-mm-dd.',
        );

        $validated = $request->validate([
            'text' => ['required', 'string', 'max:100000'],
            'heading' => ['nullable', 'string', 'max:200'],
            'create_heading_if_missing' => ['nullable', 'boolean'],
        ]);

        [$user, $team] = $this->workspace($request);

        $note = Note::query()
            ->forWorkspace($team, $user)
            ->where('type', 'daily')
            ->where('date_key', $dateKey)
            ->first();

        $content = $this->appendUnderHeading->execute(
            $note !== null ? $note->content : '',
            $validated['heading'] ?? null,
            $validated['text'],
            $validated['create_heading_if_missing'] ?? true,
        );

        $updated = $this->writeNote->execute($team, $user, $note, [
            'type' => 'daily',
            'date_key' => $dateKey,
            'title' => '',
            'content' => $content,
        ]);

        return response()->json([
            'id' => $updated->id,
            'date_key' => $dateKey,
            'deeplink' => "donote://note/{$updated->id}",
            'web_url' => url("/n/{$updated->id}"),
        ]);
    }
}
