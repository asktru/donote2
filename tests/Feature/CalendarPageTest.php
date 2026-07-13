<?php

use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

test('the calendar page renders for a team member with the member list', function () {
    $owner = User::factory()->create();
    $team = $owner->currentTeam;
    $member = User::factory()->create(['name' => 'Casey Rivera']);
    $team->members()->attach($member, ['role' => 'member']);

    $this->actingAs($owner)
        ->get(route('calendar', $team))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->component('calendar/Index')
            ->where('workspace.teamSlug', $team->slug)
            ->has('members', 2)
            ->where('googleConnected', false));
});

test('a non-member cannot open the calendar page', function () {
    $owner = User::factory()->create();
    $stranger = User::factory()->create();

    $this->actingAs($stranger)
        ->get(route('calendar', $owner->currentTeam))
        ->assertForbidden();
});
