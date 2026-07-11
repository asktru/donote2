<?php

use App\Models\Note;
use App\Models\User;

test('search returns matching notes from the user workspace only', function () {
    $user = User::factory()->create();
    $team = $user->currentTeam;

    $match = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $user->id,
        'title' => 'Quarterly OKR planning',
        'content' => "# Quarterly OKR planning\n\n- [ ] Draft objectives",
    ]);

    Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $user->id,
        'title' => 'Grocery list',
        'content' => 'Milk and eggs',
    ]);

    $other = User::factory()->create();
    Note::factory()->create([
        'team_id' => $other->currentTeam->id,
        'user_id' => $other->id,
        'title' => 'Their OKR notes',
        'content' => 'OKR content elsewhere',
    ]);

    $response = $this->actingAs($user)
        ->getJson(route('notes.search', ['current_team' => $team, 'q' => 'OKR']))
        ->assertSuccessful();

    $ids = collect($response->json('results'))->pluck('id');

    expect($ids)->toContain($match->id)
        ->and($ids)->not->toContain('Grocery list')
        ->and($response->json('results'))->toHaveCount(1);
});

test('search returns an empty result set for a blank query', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->getJson(route('notes.search', ['current_team' => $user->currentTeam, 'q' => '  ']))
        ->assertSuccessful()
        ->assertJson(['results' => []]);
});

test('search requires team membership', function () {
    $user = User::factory()->create();
    $stranger = User::factory()->create();

    $this->actingAs($stranger)
        ->getJson(route('notes.search', ['current_team' => $user->currentTeam, 'q' => 'OKR']))
        ->assertForbidden();
});
