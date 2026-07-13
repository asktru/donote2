<?php

namespace App\Models;

use App\Enums\NoteAccess;
use App\Enums\NoteType;
use Carbon\CarbonImmutable;
use Database\Factories\NoteFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Laravel\Scout\Searchable;

/**
 * @property string $id
 * @property int $team_id
 * @property int $user_id
 * @property NoteType $type
 * @property string|null $date_key
 * @property string $title
 * @property string $content
 * @property string $folder
 * @property bool $team_readable
 * @property bool $pinned
 * @property int $version
 * @property int $server_seq
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property CarbonImmutable|null $deleted_at
 * @property-read Team $team
 * @property-read User $user
 */
#[Fillable(['id', 'team_id', 'user_id', 'type', 'date_key', 'title', 'content', 'folder', 'team_readable', 'pinned', 'version', 'server_seq'])]
class Note extends Model
{
    /** @use HasFactory<NoteFactory> */
    use HasFactory, HasUuids, Searchable, SoftDeletes;

    /**
     * The model's default attribute values.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'type' => 'note',
        'title' => '',
        'content' => '',
        'folder' => '',
        'team_readable' => false,
        'pinned' => false,
        'version' => 1,
        'server_seq' => 0,
    ];

    /**
     * Get the team this note belongs to.
     *
     * @return BelongsTo<Team, $this>
     */
    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    /**
     * Get the author of this note.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The explicit per-teammate shares on this note.
     *
     * @return HasMany<NoteShare, $this>
     */
    public function shares(): HasMany
    {
        return $this->hasMany(NoteShare::class);
    }

    /**
     * Scope the query to a single user's workspace within a team.
     *
     * @param  Builder<$this>  $query
     * @return Builder<$this>
     */
    public function scopeForWorkspace(Builder $query, Team $team, User $user): Builder
    {
        return $query->whereBelongsTo($team)->whereBelongsTo($user);
    }

    /**
     * Scope to notes a user may see within a team: their own, any note the
     * team may read, or a note explicitly shared with them.
     *
     * @param  Builder<$this>  $query
     * @return Builder<$this>
     */
    public function scopeVisibleTo(Builder $query, Team $team, User $user): Builder
    {
        return $query->whereBelongsTo($team)->where(function (Builder $q) use ($user) {
            $q->where('user_id', $user->id)
                ->orWhere('team_readable', true)
                ->orWhereHas('shares', fn (Builder $s) => $s->where('user_id', $user->id));
        });
    }

    /**
     * Resolve a viewer's effective access to this note. Eager-load `shares`
     * before calling in a loop to avoid N+1 queries.
     */
    public function accessFor(User $user): NoteAccess
    {
        if ($this->user_id === $user->id) {
            return NoteAccess::Owner;
        }

        $share = $this->shares->firstWhere('user_id', $user->id);

        if ($share !== null) {
            return $share->access === 'write' ? NoteAccess::Write : NoteAccess::Read;
        }

        return $this->team_readable ? NoteAccess::Read : NoteAccess::None;
    }

    /**
     * Advance the global change sequence for this note without touching its
     * content timestamps — used when only sharing changes, so recipients
     * re-pull the note on their next sync cycle.
     */
    public function touchServerSeq(): void
    {
        $this->server_seq = self::nextServerSeq();
        $this->timestamps = false;
        $this->save();
        $this->timestamps = true;
    }

    /**
     * Get the indexable data array for the model.
     *
     * @return array<string, mixed>
     */
    public function toSearchableArray(): array
    {
        return [
            'id' => $this->id,
            'team_id' => (int) $this->team_id,
            'user_id' => (int) $this->user_id,
            'type' => $this->type->value,
            'date_key' => $this->date_key,
            'title' => $this->title,
            'content' => $this->content,
            'folder' => $this->folder,
            'updated_at' => $this->updated_at?->getTimestamp() ?? 0,
        ];
    }

    /**
     * Get the name of the index associated with the model.
     */
    public function searchableAs(): string
    {
        return 'notes';
    }

    /**
     * Claim the next value of the global change sequence.
     */
    public static function nextServerSeq(): int
    {
        return (int) static::withTrashed()->max('server_seq') + 1;
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => NoteType::class,
            'team_readable' => 'boolean',
            'pinned' => 'boolean',
            'version' => 'integer',
            'server_seq' => 'integer',
            // Explicit cast so dates stay Carbon instances even while the
            // sync layer saves with $timestamps temporarily disabled.
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
