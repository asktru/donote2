<?php

use App\Models\GoogleAccount;
use App\Models\User;
use Illuminate\Support\Facades\Http;

test('the redirect endpoint sends users to the google consent screen', function () {
    config(['services.google.client_id' => 'client-id']);

    $user = User::factory()->create();

    $response = $this->actingAs($user)->get(route('google.redirect'));

    $response->assertRedirect();
    expect($response->headers->get('Location'))
        ->toStartWith('https://accounts.google.com/o/oauth2/v2/auth')
        ->toContain('client_id=client-id')
        ->toContain('access_type=offline');
});

test('the oauth callback stores the account with its calendars', function () {
    config([
        'services.google.client_id' => 'client-id',
        'services.google.client_secret' => 'client-secret',
    ]);

    Http::fake([
        'oauth2.googleapis.com/token' => Http::response([
            'access_token' => 'fresh-access-token',
            'refresh_token' => 'fresh-refresh-token',
            'expires_in' => 3600,
        ]),
        'www.googleapis.com/oauth2/v2/userinfo' => Http::response([
            'email' => 'user@gmail.com',
        ]),
        'www.googleapis.com/calendar/v3/users/me/calendarList' => Http::response([
            'items' => [
                ['id' => 'primary', 'summary' => 'Personal', 'backgroundColor' => '#9a9cff', 'primary' => true],
            ],
        ]),
    ]);

    $user = User::factory()->create();

    $this->actingAs($user)
        ->withSession(['google_oauth_state' => 'the-state'])
        ->get(route('google.callback', ['code' => 'auth-code', 'state' => 'the-state']))
        ->assertRedirect(route('integrations.edit', absolute: false));

    $account = GoogleAccount::query()->where('user_id', $user->id)->firstOrFail();

    expect($account->email)->toBe('user@gmail.com')
        ->and($account->access_token)->toBe('fresh-access-token')
        ->and($account->refresh_token)->toBe('fresh-refresh-token')
        ->and($account->calendars)->toHaveCount(1)
        ->and($account->calendars[0]['selected'])->toBeTrue();
});

test('the callback rejects a mismatched state', function () {
    Http::fake();

    $user = User::factory()->create();

    $this->actingAs($user)
        ->withSession(['google_oauth_state' => 'expected'])
        ->get(route('google.callback', ['code' => 'auth-code', 'state' => 'tampered']))
        ->assertRedirect(route('integrations.edit', absolute: false));

    expect(GoogleAccount::query()->count())->toBe(0);
    Http::assertNothingSent();
});

test('events are fetched from selected calendars only and normalized', function () {
    config([
        'services.google.client_id' => 'client-id',
        'services.google.client_secret' => 'client-secret',
    ]);

    Http::fake([
        'www.googleapis.com/calendar/v3/calendars/primary/events*' => Http::response([
            'items' => [
                [
                    'id' => 'evt-1',
                    'summary' => 'Preply lesson - Elamine M.',
                    'status' => 'confirmed',
                    'colorId' => '11',
                    'start' => ['dateTime' => '2026-07-11T07:00:00+02:00'],
                    'end' => ['dateTime' => '2026-07-11T08:00:00+02:00'],
                ],
                [
                    'id' => 'evt-2',
                    'summary' => 'Anniversary',
                    'status' => 'confirmed',
                    'start' => ['date' => '2026-07-11'],
                    'end' => ['date' => '2026-07-12'],
                ],
            ],
        ]),
    ]);

    $user = User::factory()->create();
    GoogleAccount::factory()->create(['user_id' => $user->id]);

    $response = $this->actingAs($user)
        ->getJson(route('google.events', ['start' => '2026-07-11', 'end' => '2026-07-12']))
        ->assertSuccessful();

    expect($response->json('events'))->toHaveCount(2)
        ->and($response->json('events.0.all_day'))->toBeTrue()
        ->and($response->json('events.1.summary'))->toBe('Preply lesson - Elamine M.')
        // A custom event color (colorId 11 = Tomato) rides along; events
        // without one fall back to the calendar color (event_color null).
        ->and($response->json('events.1.event_color'))->toBe('#D50000')
        ->and($response->json('events.0.event_color'))->toBeNull();

    Http::assertNotSent(fn ($request) => str_contains($request->url(), 'work%40group.calendar.google.com'));
});

test('an expiring token is refreshed before fetching events', function () {
    config([
        'services.google.client_id' => 'client-id',
        'services.google.client_secret' => 'client-secret',
    ]);

    Http::fake([
        'oauth2.googleapis.com/token' => Http::response([
            'access_token' => 'refreshed-token',
            'expires_in' => 3600,
        ]),
        'www.googleapis.com/calendar/v3/calendars/*' => Http::response(['items' => []]),
    ]);

    $user = User::factory()->create();
    $account = GoogleAccount::factory()->create([
        'user_id' => $user->id,
        'token_expires_at' => now()->subMinute(),
    ]);

    $this->actingAs($user)
        ->getJson(route('google.events', ['start' => '2026-07-11', 'end' => '2026-07-12']))
        ->assertSuccessful();

    expect($account->refresh()->access_token)->toBe('refreshed-token');
});

test('users can update calendar selection and disconnect accounts', function () {
    $user = User::factory()->create();
    $account = GoogleAccount::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)
        ->patchJson(route('google.accounts.update', $account), [
            'selected_calendar_ids' => ['work@group.calendar.google.com'],
        ])
        ->assertSuccessful();

    $account->refresh();
    expect(collect($account->calendars)->firstWhere('id', 'primary')['selected'])->toBeFalse()
        ->and($account->selectedCalendarIds())->toBe(['work@group.calendar.google.com']);

    $this->actingAs($user)
        ->deleteJson(route('google.accounts.destroy', $account))
        ->assertSuccessful();

    expect(GoogleAccount::query()->count())->toBe(0);
});

test('users cannot manage google accounts of others', function () {
    $owner = User::factory()->create();
    $account = GoogleAccount::factory()->create(['user_id' => $owner->id]);

    $this->actingAs(User::factory()->create())
        ->deleteJson(route('google.accounts.destroy', $account))
        ->assertNotFound();
});
