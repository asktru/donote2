<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Notes\WriteNote;
use App\Http\Controllers\Api\V1\Concerns\ResolvesApiWorkspace;
use App\Http\Controllers\Controller;
use App\Models\Note;
use App\Models\Team;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NoteController extends Controller
{
    use ResolvesApiWorkspace;

    public function __construct(public WriteNote $writeNote) {}

    /**
     * Create a note for a third-party client (KnowTabs and friends).
     *
     * The server owns title deduplication: when the requested title is
     * taken, the note is created as "Title 2", "Title 3", … and the final
     * title is returned so the client's wiki-link matches. `if_exists`
     * switches that to returning the existing note or a 409.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:512'],
            'content' => ['nullable', 'string', 'max:2000000'],
            'folder' => ['nullable', 'string', 'max:512'],
            'tags' => ['nullable', 'array', 'max:20'],
            'tags.*' => ['string', 'max:100'],
            'if_exists' => ['nullable', 'in:rename,return-existing,error'],
        ]);

        [$user, $team] = $this->workspace($request);

        $title = $this->sanitizedTitle($validated['title']);

        if ($title === '') {
            return response()->json(['message' => 'The title contains no usable characters.'], 422);
        }

        $ifExists = $validated['if_exists'] ?? 'rename';
        $existing = $this->findByTitle($team, $user, $title)->first();

        if ($existing !== null && $ifExists === 'return-existing') {
            return response()->json([...$this->notePayload($existing), 'created' => false]);
        }

        if ($existing !== null && $ifExists === 'error') {
            return response()->json([
                'message' => "A note titled \"{$title}\" already exists.",
                'id' => $existing->id,
            ], 409);
        }

        if ($existing !== null) {
            $title = $this->dedupedTitle($team, $user, $title);
        }

        $note = $this->writeNote->execute($team, $user, null, [
            'title' => $title,
            'content' => $this->composedContent($validated['content'] ?? '', $validated['tags'] ?? []),
            'folder' => trim($validated['folder'] ?? '', '/'),
        ]);

        return response()->json([...$this->notePayload($note), 'created' => true], 201);
    }

    /**
     * Find notes by exact title (case-insensitive), optionally within a
     * folder — cross-device "already sent?" detection for clients.
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:512'],
            'folder' => ['nullable', 'string', 'max:512'],
        ]);

        [$user, $team] = $this->workspace($request);

        $query = $this->findByTitle($team, $user, trim($validated['title']));

        if (! empty($validated['folder'])) {
            $query->where('folder', trim($validated['folder'], '/'));
        }

        return response()->json([
            'notes' => $query->orderByDesc('updated_at')
                ->get()
                ->map(fn (Note $note): array => $this->notePayload($note))
                ->all(),
        ]);
    }

    /**
     * Strip characters that would break a [[wiki-link]] to this note.
     */
    private function sanitizedTitle(string $title): string
    {
        $title = preg_replace('/[\[\]|#^\r\n]+/', ' ', $title) ?? $title;

        return trim(preg_replace('/\s+/', ' ', $title) ?? $title);
    }

    /**
     * @return Builder<Note>
     */
    private function findByTitle(Team $team, User $user, string $title)
    {
        return Note::query()
            ->forWorkspace($team, $user)
            ->where('type', 'note')
            ->whereRaw('LOWER(title) = ?', [strtolower($title)]);
    }

    /**
     * First free "Title 2", "Title 3", … within the workspace. Wiki links
     * resolve by title workspace-wide, so dedup ignores folders.
     */
    private function dedupedTitle(Team $team, User $user, string $title): string
    {
        for ($suffix = 2; ; $suffix++) {
            $candidate = "{$title} {$suffix}";

            if (! $this->findByTitle($team, $user, $candidate)->exists()) {
                return $candidate;
            }
        }
    }

    /**
     * @param  list<string>  $tags
     */
    private function composedContent(string $content, array $tags): string
    {
        $content = rtrim($content, "\n");

        $tagLine = collect($tags)
            ->map(fn (string $tag): string => '#'.ltrim(trim($tag), '#'))
            ->filter(fn (string $tag): bool => $tag !== '#')
            ->implode(' ');

        if ($tagLine !== '') {
            $content = ($content === '' ? '' : $content."\n\n").$tagLine;
        }

        return $content === '' ? '' : $content."\n";
    }
}
