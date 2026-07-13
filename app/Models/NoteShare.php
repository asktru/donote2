<?php

namespace App\Models;

use Database\Factories\NoteShareFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property string $note_id
 * @property int $user_id
 * @property string $access 'read' | 'write'
 * @property-read Note $note
 * @property-read User $user
 */
class NoteShare extends Model
{
    /** @use HasFactory<NoteShareFactory> */
    use HasFactory;

    /**
     * @var list<string>
     */
    protected $fillable = ['note_id', 'user_id', 'access'];

    /**
     * The note being shared.
     *
     * @return BelongsTo<Note, $this>
     */
    public function note(): BelongsTo
    {
        return $this->belongsTo(Note::class);
    }

    /**
     * The recipient the note is shared with.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
