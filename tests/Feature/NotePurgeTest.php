<?php

use App\Models\Note;
use App\Models\User;

test('trashed notes can be purged permanently', function () {
    $user = User::factory()->create();
    $team = $user->currentTeam;

    $trashed = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $user->id,
        'deleted_at' => now(),
    ]);
    $keeper = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $user->id,
        'deleted_at' => now(),
    ]);

    $this->actingAs($user)
        ->postJson(route('notes.purge', $team), ['ids' => [$trashed->id]])
        ->assertSuccessful()
        ->assertJsonPath('purged', 1);

    expect(Note::withTrashed()->find($trashed->id))->toBeNull();
    expect(Note::withTrashed()->find($keeper->id))->not->toBeNull();
});

test('live notes are not purged', function () {
    $user = User::factory()->create();

    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
    ]);

    $this->actingAs($user)
        ->postJson(route('notes.purge', $user->currentTeam), [
            'ids' => [$note->id],
        ])
        ->assertSuccessful()
        ->assertJsonPath('purged', 0);

    expect(Note::find($note->id))->not->toBeNull();
});

test('other users trashed notes are not purged', function () {
    $owner = User::factory()->create();
    $intruder = User::factory()->create();
    $team = $owner->currentTeam;
    $team->members()->attach($intruder, ['role' => 'member']);

    $note = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $owner->id,
        'deleted_at' => now(),
    ]);

    $this->actingAs($intruder)
        ->postJson(route('notes.purge', $team), ['ids' => [$note->id]])
        ->assertSuccessful()
        ->assertJsonPath('purged', 0);

    expect(Note::withTrashed()->find($note->id))->not->toBeNull();
});

test('purge validates its input', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->postJson(route('notes.purge', $user->currentTeam), ['ids' => []])
        ->assertUnprocessable();

    $this->actingAs($user)
        ->postJson(route('notes.purge', $user->currentTeam), [
            'ids' => ['not-a-uuid'],
        ])
        ->assertUnprocessable();
});
