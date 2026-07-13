<?php

use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

test('the notes page renders with the team member list for the share picker', function () {
    $owner = User::factory()->create();
    $team = $owner->currentTeam;
    $member = User::factory()->create(['name' => 'Casey Rivera']);
    $team->members()->attach($member, ['role' => 'member']);

    $this->actingAs($owner)
        ->get(route('notes', $team))
        ->assertSuccessful()
        ->assertInertia(fn (Assert $page) => $page
            ->component('notes/Index')
            ->where('workspace.teamSlug', $team->slug)
            ->has('members', 2)
            ->where('members.1.name', 'Casey Rivera')
            ->has('members.0', fn (Assert $m) => $m
                ->has('id')
                ->has('name')
                ->has('email')));
});
