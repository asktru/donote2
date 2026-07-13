<?php

use App\Models\Note;
use App\Models\User;

test('guests cannot read sync stats', function () {
    $user = User::factory()->create();

    $this->getJson(route('notes.sync.stats', $user->currentTeam))
        ->assertUnauthorized();
});

test('stats report visible note count and the cursor ceiling', function () {
    $user = User::factory()->create();
    $team = $user->currentTeam;

    Note::factory()->create(['team_id' => $team->id, 'user_id' => $user->id, 'server_seq' => 3]);
    Note::factory()->create(['team_id' => $team->id, 'user_id' => $user->id, 'server_seq' => 7]);
    Note::factory()->create(['team_id' => $team->id, 'user_id' => $user->id, 'server_seq' => 5]);

    $response = $this->actingAs($user)
        ->getJson(route('notes.sync.stats', $team))
        ->assertSuccessful();

    expect($response->json('visible_count'))->toBe(3);
    expect($response->json('max_seq'))->toBe(7);
});

test('trashed notes count toward the cursor ceiling but not the visible count', function () {
    $user = User::factory()->create();
    $team = $user->currentTeam;

    Note::factory()->create(['team_id' => $team->id, 'user_id' => $user->id, 'server_seq' => 4]);

    $trashed = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $user->id,
        'server_seq' => 9,
    ]);
    $trashed->delete();

    $response = $this->actingAs($user)
        ->getJson(route('notes.sync.stats', $team))
        ->assertSuccessful();

    // Only the live note is "visible", but the trashed note holds the highest
    // server_seq — a stale local cursor is measured against that ceiling.
    expect($response->json('visible_count'))->toBe(1);
    expect($response->json('max_seq'))->toBe(9);
});

test('a fresh workspace reports zero notes and a zero cursor', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->getJson(route('notes.sync.stats', $user->currentTeam))
        ->assertSuccessful()
        ->assertJson(['visible_count' => 0, 'max_seq' => 0]);
});
