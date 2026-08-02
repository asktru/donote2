<?php

use App\Enums\TeamRole;
use App\Models\Team;
use App\Models\User;

/**
 * current_team_id is the team the app reopens into, so only deliberate page
 * navigations may change it. Background API polling (sync every 30s from any
 * open client) must NOT: a desktop left on another team would otherwise keep
 * overwriting the mobile user's team choice between launches.
 */
function memberOfTwoTeams(): array
{
    $user = User::factory()->create();
    $other = Team::factory()->create(['name' => 'Other Team', 'slug' => 'other-team']);
    $other->members()->attach($user, ['role' => TeamRole::Member->value]);

    return [$user, $user->currentTeam, $other];
}

test('visiting a team page persists it as the current team', function () {
    [$user, , $other] = memberOfTwoTeams();

    $this->actingAs($user)
        ->get(route('notes', $other))
        ->assertOk();

    expect($user->fresh()->current_team_id)->toEqual($other->id);
});

test('api calls for another team do not change the current team', function () {
    [$user, $personal, $other] = memberOfTwoTeams();

    $this->actingAs($user)
        ->getJson(route('notes.sync.pull', $other))
        ->assertOk();

    expect($user->fresh()->current_team_id)->toEqual($personal->id);
});
