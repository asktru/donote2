<?php

namespace App\Enums;

/**
 * A viewer's effective access to a note. Computed from authorship, explicit
 * shares, and the note's team-readable flag — never stored directly.
 */
enum NoteAccess: string
{
    case Owner = 'owner';
    case Write = 'write';
    case Read = 'read';
    case None = 'none';

    /** The author, with full control (edit, delete, share). */
    public function isOwner(): bool
    {
        return $this === self::Owner;
    }

    /** May change the note's content. */
    public function canWrite(): bool
    {
        return $this === self::Owner || $this === self::Write;
    }

    /** May see the note at all. */
    public function canRead(): bool
    {
        return $this !== self::None;
    }
}
