<?php

use App\Models\Team;
use App\Models\User;
use Laravel\Sanctum\PersonalAccessToken;

test('generating a webhook mints a team-bound token and reveals the url once', function () {
    $user = User::factory()->create();
    $team = $user->currentTeam;

    $response = $this->actingAs($user)
        ->from(route('integrations.edit'))
        ->post(route('integrations.bluedot.store'), ['team_id' => $team->id])
        ->assertRedirect(route('integrations.edit'))
        ->assertSessionHas('bluedotTeam', $team->name);

    $url = session('bluedotUrl');
    expect($url)->toContain('/webhooks/bluedot?token=');

    $token = PersonalAccessToken::query()->where('name', 'bluedot:'.$team->slug)->firstOrFail();
    expect($token->tokenable_id)->toBe($user->id)
        ->and($token->abilities)->toContain('team:'.$team->id);
});

test('you cannot generate a webhook for a team you do not belong to', function () {
    $user = User::factory()->create();
    $stranger = Team::factory()->create();

    $this->actingAs($user)
        ->post(route('integrations.bluedot.store'), ['team_id' => $stranger->id])
        ->assertSessionHasErrors('team_id');

    expect(PersonalAccessToken::query()->count())->toBe(0);
});

test('revoking a webhook deletes the token', function () {
    $user = User::factory()->create();
    $team = $user->currentTeam;

    $token = $user->createToken('bluedot:'.$team->slug, ['bluedot', 'team:'.$team->id])
        ->accessToken;

    $this->actingAs($user)
        ->delete(route('integrations.bluedot.destroy', $token->id))
        ->assertRedirect();

    expect(PersonalAccessToken::query()->whereKey($token->id)->exists())->toBeFalse();
});

test('you cannot revoke another user\'s webhook token', function () {
    $owner = User::factory()->create();
    $team = $owner->currentTeam;
    $token = $owner->createToken('bluedot:'.$team->slug, ['bluedot', 'team:'.$team->id])
        ->accessToken;

    $attacker = User::factory()->create();

    $this->actingAs($attacker)
        ->delete(route('integrations.bluedot.destroy', $token->id))
        ->assertRedirect();

    // The token is untouched — the query is scoped to the caller's own tokens.
    expect(PersonalAccessToken::query()->whereKey($token->id)->exists())->toBeTrue();
});

test('the integrations page lists the user\'s webhooks with their team', function () {
    $user = User::factory()->create();
    $team = $user->currentTeam;
    $user->createToken('bluedot:'.$team->slug, ['bluedot', 'team:'.$team->id]);

    $this->actingAs($user)
        ->get(route('integrations.edit'))
        ->assertInertia(fn ($page) => $page
            ->component('settings/Integrations')
            ->where('bluedotWebhooks.0.team', $team->name)
        );
});
