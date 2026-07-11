<?php

namespace App\Actions\Google;

use App\Models\GoogleAccount;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;

class ConnectGoogleAccount
{
    /**
     * Exchange an OAuth authorization code and persist the Google account.
     */
    public function execute(User $user, string $code): GoogleAccount
    {
        $tokens = Http::asForm()
            ->post('https://oauth2.googleapis.com/token', [
                'code' => $code,
                'client_id' => config('services.google.client_id'),
                'client_secret' => config('services.google.client_secret'),
                'redirect_uri' => route('google.callback'),
                'grant_type' => 'authorization_code',
            ])
            ->throw()
            ->json();

        $profile = Http::withToken($tokens['access_token'])
            ->get('https://www.googleapis.com/oauth2/v2/userinfo')
            ->throw()
            ->json();

        if (empty($profile['email'])) {
            throw ValidationException::withMessages([
                'google' => 'Google did not return an email address for this account.',
            ]);
        }

        $account = GoogleAccount::query()->updateOrCreate(
            ['user_id' => $user->id, 'email' => $profile['email']],
            [
                'access_token' => $tokens['access_token'],
                'refresh_token' => $tokens['refresh_token'] ?? null,
                'token_expires_at' => now()->addSeconds((int) ($tokens['expires_in'] ?? 3600)),
            ],
        );

        $account->update(['calendars' => $this->fetchCalendarList($account)]);

        return $account;
    }

    /**
     * Fetch the account's calendar list, marking every calendar selected by default.
     *
     * @return array<int, array<string, mixed>>
     */
    protected function fetchCalendarList(GoogleAccount $account): array
    {
        $previous = collect($account->calendars ?? [])->keyBy('id');

        $items = Http::withToken($account->access_token)
            ->get('https://www.googleapis.com/calendar/v3/users/me/calendarList')
            ->throw()
            ->json('items', []);

        $calendars = [];

        foreach (is_array($items) ? $items : [] as $item) {
            if (! is_array($item) || ! isset($item['id'])) {
                continue;
            }

            $calendars[] = [
                'id' => $item['id'],
                'summary' => $item['summary'] ?? $item['id'],
                'color' => $item['backgroundColor'] ?? null,
                'primary' => (bool) ($item['primary'] ?? false),
                'selected' => (bool) ($previous[$item['id']]['selected'] ?? true),
            ];
        }

        return $calendars;
    }
}
