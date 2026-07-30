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

test('directory search maps Workspace people to name + email', function () {
    $user = User::factory()->create();
    googleAccount($user);

    Http::fake([
        'people.googleapis.com/*' => Http::response([
            'people' => [
                [
                    'names' => [['displayName' => 'Casey Jones']],
                    'emailAddresses' => [['value' => 'casey@example.com']],
                ],
                [
                    'emailAddresses' => [['value' => 'no-name@example.com']],
                ],
            ],
        ]),
    ]);

    $response = $this->actingAs($user)
        ->getJson(route('google.directory', ['q' => 'ca']))
        ->assertSuccessful();

    expect($response->json('people'))->toBe([
        ['name' => 'Casey Jones', 'email' => 'casey@example.com'],
        ['name' => 'no-name@example.com', 'email' => 'no-name@example.com'],
    ]);
});

test('directory search surfaces the Google error instead of hiding it', function () {
    $user = User::factory()->create();
    googleAccount($user);

    Http::fake([
        'people.googleapis.com/*' => Http::response([
            'error' => ['message' => 'People API has not been used in project 123 before or it is disabled.'],
        ], 403),
    ]);

    $this->actingAs($user)
        ->getJson(route('google.directory', ['q' => 'ca']))
        ->assertSuccessful()
        ->assertJsonPath('people', [])
        ->assertJsonPath('error', 'People API has not been used in project 123 before or it is disabled.');
});

test('directory search requires a query', function () {
    $user = User::factory()->create();
    googleAccount($user);

    $this->actingAs($user)
        ->getJson(route('google.directory'))
        ->assertUnprocessable();
});

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

/**
 * A Google event payload with the current user on the guest list.
 *
 * @param  array<string, mixed>  $extra
 * @return array<string, mixed>
 */
function invitedEvent(string $id, string $selfStatus = 'needsAction', array $extra = []): array
{
    return array_merge([
        'id' => $id,
        'summary' => 'Sync',
        'start' => ['dateTime' => '2026-07-20T09:00:00-07:00'],
        'end' => ['dateTime' => '2026-07-20T09:30:00-07:00'],
        'attendees' => [
            ['email' => 'boss@example.com', 'responseStatus' => 'accepted', 'organizer' => true],
            ['email' => 'me@example.com', 'responseStatus' => $selfStatus, 'self' => true],
        ],
    ], $extra);
}

test('answering an invitation patches only the user own attendee entry', function () {
    $user = User::factory()->create();
    googleAccount($user);

    Http::fake([
        '*/calendars/*/events/evt-1*' => Http::sequence()
            ->push(invitedEvent('evt-1'))
            ->push(invitedEvent('evt-1', 'accepted')),
    ]);

    $this->actingAs($user)
        ->postJson(route('google.events.rsvp'), [
            'calendar_id' => 'cal-1',
            'event_id' => 'evt-1',
            'response' => 'accepted',
            'scope' => 'one',
        ])
        ->assertSuccessful()
        ->assertJsonPath('event.id', 'evt-1');

    Http::assertSent(fn ($request) => $request->method() === 'PATCH'
        && str_contains($request->url(), '/events/evt-1')
        && $request['attendees'][1]['responseStatus'] === 'accepted'
        && $request['attendees'][0]['responseStatus'] === 'accepted'
        && $request['attendees'][0]['email'] === 'boss@example.com');
});

test('answering a whole series patches the recurring master', function () {
    $user = User::factory()->create();
    googleAccount($user);

    Http::fake([
        '*/calendars/*/events/evt-1*' => Http::response(
            invitedEvent('evt-1', 'needsAction', ['recurringEventId' => 'series-1']),
        ),
        '*/calendars/*/events/series-1*' => Http::response(invitedEvent('series-1')),
    ]);

    $this->actingAs($user)
        ->postJson(route('google.events.rsvp'), [
            'calendar_id' => 'cal-1',
            'event_id' => 'evt-1',
            'response' => 'declined',
            'scope' => 'series',
        ])
        ->assertSuccessful();

    Http::assertSent(fn ($request) => $request->method() === 'PATCH'
        && str_contains($request->url(), '/events/series-1')
        && $request['attendees'][1]['responseStatus'] === 'declined');
});

test('answering a series on a one-off event patches the event itself', function () {
    $user = User::factory()->create();
    googleAccount($user);

    Http::fake(['*/calendars/*/events/evt-1*' => Http::response(invitedEvent('evt-1'))]);

    $this->actingAs($user)
        ->postJson(route('google.events.rsvp'), [
            'calendar_id' => 'cal-1',
            'event_id' => 'evt-1',
            'response' => 'tentative',
            'scope' => 'series',
        ])
        ->assertSuccessful();

    Http::assertSent(fn ($request) => $request->method() === 'PATCH'
        && str_contains($request->url(), '/events/evt-1')
        && $request['attendees'][1]['responseStatus'] === 'tentative');
});

test('answering an event the user is not invited to is rejected', function () {
    $user = User::factory()->create();
    googleAccount($user);

    Http::fake([
        '*/calendars/*/events/evt-1*' => Http::response([
            'id' => 'evt-1',
            'summary' => 'Someone else meeting',
            'start' => ['dateTime' => '2026-07-20T09:00:00-07:00'],
            'end' => ['dateTime' => '2026-07-20T09:30:00-07:00'],
        ]),
    ]);

    $this->actingAs($user)
        ->postJson(route('google.events.rsvp'), [
            'calendar_id' => 'cal-1',
            'event_id' => 'evt-1',
            'response' => 'accepted',
            'scope' => 'one',
        ])
        ->assertStatus(422);

    Http::assertNotSent(fn ($request) => $request->method() === 'PATCH');
});

test('answering on an unconnected calendar is rejected', function () {
    $user = User::factory()->create();
    googleAccount($user);

    $this->actingAs($user)
        ->postJson(route('google.events.rsvp'), [
            'calendar_id' => 'not-mine',
            'event_id' => 'evt-1',
            'response' => 'accepted',
            'scope' => 'one',
        ])
        ->assertStatus(422);
});

test('an unknown response or scope is rejected', function () {
    $user = User::factory()->create();
    googleAccount($user);

    $this->actingAs($user)
        ->postJson(route('google.events.rsvp'), [
            'calendar_id' => 'cal-1',
            'event_id' => 'evt-1',
            'response' => 'maybe-later',
            'scope' => 'one',
        ])
        ->assertStatus(422);

    $this->actingAs($user)
        ->postJson(route('google.events.rsvp'), [
            'calendar_id' => 'cal-1',
            'event_id' => 'evt-1',
            'response' => 'accepted',
            'scope' => 'everything',
        ])
        ->assertStatus(422);
});

/**
 * Two windows of list results for the same range, so a second fetch shows
 * whether the five-minute read cache was consulted or bypassed.
 *
 * @return array<string, mixed>
 */
function eventListSequence(): array
{
    return [
        '*/calendars/*/events?*' => Http::sequence()
            ->push(['items' => [
                ['id' => 'evt-1', 'summary' => 'Before', 'start' => ['dateTime' => '2026-07-20T09:00:00Z'], 'end' => ['dateTime' => '2026-07-20T10:00:00Z']],
            ]])
            ->push(['items' => [
                ['id' => 'evt-2', 'summary' => 'After', 'start' => ['dateTime' => '2026-07-20T11:00:00Z'], 'end' => ['dateTime' => '2026-07-20T12:00:00Z']],
            ]]),
        '*/calendars/*/events/evt-1*' => Http::response(invitedEvent('evt-1')),
    ];
}

test('a repeat fetch of the same range is served from the cache', function () {
    $user = User::factory()->create();
    googleAccount($user);
    Http::fake(eventListSequence());

    $range = ['start' => '2026-07-20T00:00:00Z', 'end' => '2026-07-21T00:00:00Z'];

    $this->actingAs($user)->getJson(route('google.events', $range))->assertSuccessful();

    $this->actingAs($user)
        ->getJson(route('google.events', $range))
        ->assertSuccessful()
        ->assertJsonPath('events.0.summary', 'Before');
});

test('answering an invitation makes the next event fetch bypass the cache', function () {
    $user = User::factory()->create();
    googleAccount($user);
    Http::fake(eventListSequence());

    $range = ['start' => '2026-07-20T00:00:00Z', 'end' => '2026-07-21T00:00:00Z'];

    $this->actingAs($user)->getJson(route('google.events', $range))->assertSuccessful();

    $this->actingAs($user)
        ->postJson(route('google.events.rsvp'), [
            'calendar_id' => 'cal-1',
            'event_id' => 'evt-1',
            'response' => 'accepted',
            'scope' => 'one',
        ])
        ->assertSuccessful();

    $this->actingAs($user)
        ->getJson(route('google.events', $range))
        ->assertSuccessful()
        ->assertJsonPath('events.0.summary', 'After');
});
