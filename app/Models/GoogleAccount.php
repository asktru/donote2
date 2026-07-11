<?php

namespace App\Models;

use Database\Factories\GoogleAccountFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $user_id
 * @property string $email
 * @property string $access_token
 * @property string|null $refresh_token
 * @property Carbon|null $token_expires_at
 * @property array<int, array<string, mixed>>|null $calendars
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User $user
 */
#[Fillable(['user_id', 'email', 'access_token', 'refresh_token', 'token_expires_at', 'calendars'])]
#[Hidden(['access_token', 'refresh_token'])]
class GoogleAccount extends Model
{
    /** @use HasFactory<GoogleAccountFactory> */
    use HasFactory;

    /**
     * Get the user this Google account belongs to.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Determine whether the access token needs refreshing.
     */
    public function tokenNeedsRefresh(): bool
    {
        return $this->token_expires_at === null
            || $this->token_expires_at->isBefore(now()->addMinutes(2));
    }

    /**
     * The calendar ids the user wants displayed.
     *
     * @return array<int, string>
     */
    public function selectedCalendarIds(): array
    {
        return collect($this->calendars ?? [])
            ->filter(fn (array $calendar): bool => $calendar['selected'] ?? false)
            ->pluck('id')
            ->values()
            ->all();
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'access_token' => 'encrypted',
            'refresh_token' => 'encrypted',
            'token_expires_at' => 'datetime',
            'calendars' => 'array',
        ];
    }
}
