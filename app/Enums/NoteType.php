<?php

namespace App\Enums;

enum NoteType: string
{
    case Note = 'note';
    case Daily = 'daily';
    case Weekly = 'weekly';
    case Monthly = 'monthly';
    case Quarterly = 'quarterly';
    case Yearly = 'yearly';

    /**
     * Determine whether this type represents a calendar-bound note.
     */
    public function isCalendar(): bool
    {
        return $this !== self::Note;
    }
}
