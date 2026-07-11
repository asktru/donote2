<?php

namespace App\Http\Controllers;

use App\Actions\Google\ConnectGoogleAccount;
use App\Actions\Google\FetchGoogleEvents;
use App\Models\GoogleAccount;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

class GoogleCalendarController extends Controller
{
    /**
     * Redirect the user to Google's OAuth consent screen.
     */
    public function redirect(Request $request): RedirectResponse
    {
        $state = Str::random(40);
        $request->session()->put('google_oauth_state', $state);

        $query = http_build_query([
            'client_id' => config('services.google.client_id'),
            'redirect_uri' => route('google.callback'),
            'response_type' => 'code',
            'scope' => implode(' ', [
                'https://www.googleapis.com/auth/calendar.readonly',
                'https://www.googleapis.com/auth/userinfo.email',
            ]),
            'access_type' => 'offline',
            'prompt' => 'consent',
            'state' => $state,
        ]);

        return redirect()->away('https://accounts.google.com/o/oauth2/v2/auth?'.$query);
    }

    /**
     * Handle the OAuth callback and store the connected account.
     */
    public function callback(Request $request, ConnectGoogleAccount $connectGoogleAccount): RedirectResponse
    {
        $expectedState = $request->session()->pull('google_oauth_state');

        if ($request->query('error') !== null
            || $expectedState === null
            || ! hash_equals($expectedState, (string) $request->query('state'))
            || $request->query('code') === null) {
            return redirect()->route('integrations.edit')
                ->with('error', 'Google Calendar connection was cancelled or failed.');
        }

        $account = $connectGoogleAccount->execute($request->user(), (string) $request->query('code'));

        return redirect()->route('integrations.edit')
            ->with('success', "Connected {$account->email}.");
    }

    /**
     * List the user's connected Google accounts and their calendars.
     */
    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'accounts' => $request->user()->googleAccounts()->get()
                ->map(fn (GoogleAccount $account): array => [
                    'id' => $account->id,
                    'email' => $account->email,
                    'calendars' => $account->calendars ?? [],
                ]),
        ]);
    }

    /**
     * Update which calendars of an account are displayed.
     */
    public function update(Request $request, GoogleAccount $googleAccount): JsonResponse
    {
        abort_unless($googleAccount->user_id === $request->user()->id, 404);

        $request->validate([
            'selected_calendar_ids' => ['present', 'array'],
            'selected_calendar_ids.*' => ['string'],
        ]);

        $selected = collect($request->array('selected_calendar_ids'));

        $googleAccount->update([
            'calendars' => collect($googleAccount->calendars ?? [])
                ->map(fn (array $calendar): array => [
                    ...$calendar,
                    'selected' => $selected->contains($calendar['id']),
                ])
                ->all(),
        ]);

        return response()->json(['calendars' => $googleAccount->calendars]);
    }

    /**
     * Disconnect a Google account.
     */
    public function destroy(Request $request, GoogleAccount $googleAccount): JsonResponse
    {
        abort_unless($googleAccount->user_id === $request->user()->id, 404);

        $googleAccount->delete();

        return response()->json(['status' => 'ok']);
    }

    /**
     * Fetch calendar events for a date range.
     */
    public function events(Request $request, FetchGoogleEvents $fetchGoogleEvents): JsonResponse
    {
        $validated = $request->validate([
            'start' => ['required', 'date'],
            'end' => ['required', 'date', 'after:start'],
        ]);

        return response()->json([
            'events' => $fetchGoogleEvents->execute(
                $request->user(),
                Carbon::parse($validated['start']),
                Carbon::parse($validated['end']),
            ),
        ]);
    }
}
