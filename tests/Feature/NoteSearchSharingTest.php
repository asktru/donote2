<?php

use App\Models\Note;
use App\Models\User;

test('search surfaces notes shared with the viewer but not private ones', function () {
    $author = User::factory()->create();
    $team = $author->currentTeam;
    $viewer = User::factory()->create();
    $team->members()->attach($viewer, ['role' => 'member']);

    $shared = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $author->id,
        'title' => 'Roadmap OKR review',
        'content' => 'Shared OKR content',
    ]);
    $shared->shares()->create(['user_id' => $viewer->id, 'access' => 'read']);

    $private = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $author->id,
        'title' => 'Private OKR draft',
        'content' => 'Secret OKR content',
    ]);

    $ids = collect(
        $this->actingAs($viewer)
            ->getJson(route('notes.search', ['current_team' => $team, 'q' => 'OKR']))
            ->assertSuccessful()
            ->json('results')
    )->pluck('id');

    expect($ids)->toContain($shared->id)
        ->and($ids)->not->toContain($private->id);
});
