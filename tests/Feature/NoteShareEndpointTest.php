<?php

use App\Models\Note;
use App\Models\User;

test('the author can set team_readable and per-member shares', function () {
    $author = User::factory()->create();
    $team = $author->currentTeam;
    $reader = User::factory()->create();
    $writer = User::factory()->create();
    $team->members()->attach($reader, ['role' => 'member']);
    $team->members()->attach($writer, ['role' => 'member']);

    $note = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $author->id,
        'server_seq' => 1,
    ]);

    $this->actingAs($author)
        ->putJson(route('notes.share.update', [$team, $note]), [
            'team_readable' => true,
            'shares' => [
                ['user_id' => $reader->id, 'access' => 'read'],
                ['user_id' => $writer->id, 'access' => 'write'],
            ],
        ])
        ->assertSuccessful()
        ->assertJsonPath('team_readable', true)
        ->assertJsonCount(2, 'shares');

    $note->refresh();
    expect($note->team_readable)->toBeTrue()
        ->and($note->server_seq)->toBeGreaterThan(1)
        ->and($note->shares)->toHaveCount(2);
});

test('an empty shares array clears existing shares', function () {
    $author = User::factory()->create();
    $team = $author->currentTeam;
    $reader = User::factory()->create();
    $team->members()->attach($reader, ['role' => 'member']);
    $note = Note::factory()->create(['team_id' => $team->id, 'user_id' => $author->id]);
    $note->shares()->create(['user_id' => $reader->id, 'access' => 'read']);

    $this->actingAs($author)
        ->putJson(route('notes.share.update', [$team, $note]), [
            'team_readable' => false,
            'shares' => [],
        ])
        ->assertSuccessful()
        ->assertJsonCount(0, 'shares');

    expect($note->fresh()->shares)->toHaveCount(0);
});

test('a non-author cannot change sharing', function () {
    $author = User::factory()->create();
    $team = $author->currentTeam;
    $other = User::factory()->create();
    $team->members()->attach($other, ['role' => 'member']);
    $note = Note::factory()->create(['team_id' => $team->id, 'user_id' => $author->id]);

    $this->actingAs($other)
        ->putJson(route('notes.share.update', [$team, $note]), [
            'team_readable' => true,
            'shares' => [],
        ])
        ->assertForbidden();
});

test('sharing with a non-member is rejected', function () {
    $author = User::factory()->create();
    $team = $author->currentTeam;
    $outsider = User::factory()->create();
    $note = Note::factory()->create(['team_id' => $team->id, 'user_id' => $author->id]);

    $this->actingAs($author)
        ->putJson(route('notes.share.update', [$team, $note]), [
            'team_readable' => false,
            'shares' => [['user_id' => $outsider->id, 'access' => 'read']],
        ])
        ->assertStatus(422);
});

test('a calendar note cannot be shared', function () {
    $author = User::factory()->create();
    $team = $author->currentTeam;
    $note = Note::factory()->daily()->create(['team_id' => $team->id, 'user_id' => $author->id]);

    $this->actingAs($author)
        ->putJson(route('notes.share.update', [$team, $note]), [
            'team_readable' => true,
            'shares' => [],
        ])
        ->assertStatus(422);
});

test('visible-ids returns own, team-readable, and shared notes', function () {
    $author = User::factory()->create();
    $team = $author->currentTeam;
    $viewer = User::factory()->create();
    $team->members()->attach($viewer, ['role' => 'member']);

    $mine = Note::factory()->create(['team_id' => $team->id, 'user_id' => $viewer->id]);
    $shared = Note::factory()->create(['team_id' => $team->id, 'user_id' => $author->id]);
    $shared->shares()->create(['user_id' => $viewer->id, 'access' => 'read']);
    $public = Note::factory()->create(['team_id' => $team->id, 'user_id' => $author->id, 'team_readable' => true]);
    $private = Note::factory()->create(['team_id' => $team->id, 'user_id' => $author->id]);

    $ids = $this->actingAs($viewer)
        ->getJson(route('notes.visible-ids', $team))
        ->assertSuccessful()
        ->json('ids');

    expect($ids)->toContain($mine->id, $shared->id, $public->id)
        ->and($ids)->not->toContain($private->id);
});
