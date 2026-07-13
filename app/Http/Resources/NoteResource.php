<?php

namespace App\Http\Resources;

use App\Models\Note;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Note
 */
class NoteResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $user = $request->user();

        $data = [
            'id' => $this->id,
            'type' => $this->type->value,
            'date_key' => $this->date_key,
            'title' => $this->title,
            'content' => $this->content,
            'folder' => $this->folder,
            'pinned' => $this->pinned,
            'version' => $this->version,
            'server_seq' => $this->server_seq,
            'updated_at' => $this->updated_at?->toISOString(),
            'deleted' => $this->trashed(),
            'author_id' => $this->user_id,
            'access' => $user !== null ? $this->accessFor($user)->value : 'none',
        ];

        // Only the author receives the recipient list (for the share UI).
        if ($user !== null && $this->user_id === $user->id) {
            $data['sharing'] = [
                'team_readable' => $this->team_readable,
                'shares' => $this->shares
                    ->map(fn ($share): array => [
                        'user_id' => $share->user_id,
                        'access' => $share->access,
                    ])
                    ->values(),
            ];
        }

        return $data;
    }
}
