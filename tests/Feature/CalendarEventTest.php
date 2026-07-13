<?php

use App\Models\GoogleAccount;
use App\Models\User;
use Illuminate\Support\Facades\Http;

function googleAccount(User $user): GoogleAccount
{
    return GoogleAccount::factory()->create([
        'user_id' => $user->id,
        'email' => 'me@example.com',
        'access_token' => 'fresh-token',
        'token_expires_at' => now()->addHour(),
        'calendars' => [
            ['id' => 'cal-1', 'summary' => 'Work', 'color' => '#22aa22', 'primary' => true, 'selected' => true],
        ],
    ]);
}

test('creating an event with a Meet link sends conferenceData', function () {
    $user = User::factory()->create();
    googleAccount($user);

    Http::fake([
        '*/calendars/*/events*' => Http::response([
            'id' => 'evt-1',
            'summary' => 'Sync',
            'htmlLink' => 'https://cal/evt-1',
            'hangoutLink' => 'https://meet.google.com/abc',
            'start' => ['dateTime' => '2026-07-20T09:00:00-07:00'],
            'end' => ['dateTime' => '2026-07-20T09:30:00-07:00'],
        ]),
    ]);

    $this->actingAs($user)
        ->postJson(route('google.events.store'), [
            'calendar_id' => 'cal-1',
            'summary' => 'Sync',
            'all_day' => false,
            'start' => '2026-07-20T09:00:00-07:00',
            'end' => '2026-07-20T09:30:00-07:00',
            'attendees' => ['casey@example.com'],
            'add_meet' => true,
        ])
        ->assertSuccessful()
        ->assertJsonPath('event.id', 'evt-1')
        ->assertJsonPath('event.hangout_link', 'https://meet.google.com/abc');

    Http::assertSent(function ($request) {
        return str_contains($request->url(), 'conferenceDataVersion=1')
            && $request['conferenceData']['createRequest']['conferenceSolutionKey']['type'] === 'hangoutsMeet'
            && $request['attendees'][0]['email'] === 'casey@example.com';
    });
});

test('creating an event on an unconnected calendar is rejected', function () {
    $user = User::factory()->create();
    googleAccount($user);

    $this->actingAs($user)
        ->postJson(route('google.events.store'), [
            'calendar_id' => 'not-mine',
            'summary' => 'Sync',
            'all_day' => false,
            'start' => '2026-07-20T09:00:00-07:00',
            'end' => '2026-07-20T09:30:00-07:00',
        ])
        ->assertStatus(422);
});

test('deleting an event calls the Google delete endpoint', function () {
    $user = User::factory()->create();
    googleAccount($user);
    Http::fake(['*/events/*' => Http::response('', 204)]);

    $this->actingAs($user)
        ->deleteJson(route('google.events.destroy'), [
            'calendar_id' => 'cal-1',
            'event_id' => 'evt-1',
        ])
        ->assertSuccessful()
        ->assertJsonPath('deleted', true);

    Http::assertSent(fn ($request) => $request->method() === 'DELETE'
        && str_contains($request->url(), '/events/evt-1'));
});

test('freebusy returns busy intervals per person', function () {
    $user = User::factory()->create();
    googleAccount($user);

    Http::fake([
        '*/freeBusy' => Http::response([
            'calendars' => [
                'casey@example.com' => ['busy' => [['start' => '2026-07-20T10:00:00Z', 'end' => '2026-07-20T11:00:00Z']]],
            ],
        ]),
    ]);

    $busy = $this->actingAs($user)
        ->postJson(route('google.freebusy'), [
            'emails' => ['casey@example.com'],
            'start' => '2026-07-20T00:00:00Z',
            'end' => '2026-07-21T00:00:00Z',
        ])
        ->assertSuccessful()
        ->json('busy');

    expect($busy['casey@example.com'][0]['start'])->toBe('2026-07-20T10:00:00Z');
});

test('overlay returns full events when the colleague calendar is readable', function () {
    $user = User::factory()->create();
    googleAccount($user);

    Http::fake([
        '*/calendars/*/events*' => Http::response([
            'items' => [
                ['id' => 'x', 'summary' => 'Their meeting', 'description' => 'notes', 'start' => ['dateTime' => '2026-07-20T13:00:00Z'], 'end' => ['dateTime' => '2026-07-20T14:00:00Z']],
            ],
        ]),
    ]);

    $this->actingAs($user)
        ->getJson(route('google.overlay', ['email' => 'casey@example.com', 'start' => '2026-07-20T00:00:00Z', 'end' => '2026-07-21T00:00:00Z']))
        ->assertSuccessful()
        ->assertJsonPath('shared', true)
        ->assertJsonPath('events.0.summary', 'Their meeting')
        ->assertJsonPath('events.0.description', 'notes');
});

test('overlay falls back to free/busy when the calendar is not shared', function () {
    $user = User::factory()->create();
    googleAccount($user);

    Http::fake([
        '*/calendars/*/events*' => Http::response(['error' => 'forbidden'], 403),
        '*/freeBusy' => Http::response([
            'calendars' => [
                'casey@example.com' => ['busy' => [['start' => '2026-07-20T13:00:00Z', 'end' => '2026-07-20T14:00:00Z']]],
            ],
        ]),
    ]);

    $this->actingAs($user)
        ->getJson(route('google.overlay', ['email' => 'casey@example.com', 'start' => '2026-07-20T00:00:00Z', 'end' => '2026-07-21T00:00:00Z']))
        ->assertSuccessful()
        ->assertJsonPath('shared', false)
        ->assertJsonPath('busy.0.start', '2026-07-20T13:00:00Z');
});

test('the OAuth redirect requests full calendar scope', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->get(route('google.redirect'));
    $location = $response->headers->get('Location');

    expect($location)->toContain('auth%2Fcalendar')
        ->and($location)->not->toContain('calendar.readonly');
});
