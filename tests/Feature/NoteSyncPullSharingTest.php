<?php

use App\Models\Note;
use App\Models\NoteShare;
use App\Models\User;

test('pull includes notes shared with the viewer, with the right access', function () {
    $author = User::factory()->create();
    $team = $author->currentTeam;
    $reader = User::factory()->create();
    $writer = User::factory()->create();
    $stranger = User::factory()->create();

    foreach ([$reader, $writer, $stranger] as $member) {
        $team->members()->attach($member, ['role' => 'member']);
    }

    $note = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $author->id,
        'server_seq' => 1,
    ]);
    NoteShare::factory()->create(['note_id' => $note->id, 'user_id' => $reader->id, 'access' => 'read']);
    NoteShare::factory()->create(['note_id' => $note->id, 'user_id' => $writer->id, 'access' => 'write']);

    // Reader sees it read-only, without the recipient list.
    $this->actingAs($reader)
        ->getJson(route('notes.sync.pull', $team))
        ->assertSuccessful()
        ->assertJsonPath('notes.0.id', $note->id)
        ->assertJsonPath('notes.0.access', 'read')
        ->assertJsonPath('notes.0.author_id', $author->id)
        ->assertJsonMissingPath('notes.0.sharing');

    // Writer sees it read-write.
    $this->actingAs($writer)
        ->getJson(route('notes.sync.pull', $team))
        ->assertJsonPath('notes.0.access', 'write');

    // Stranger (no share, not team-readable) does not see it.
    $this->actingAs($stranger)
        ->getJson(route('notes.sync.pull', $team))
        ->assertJsonCount(0, 'notes');
});

test('team-readable notes are pulled by every member as read-only', function () {
    $author = User::factory()->create();
    $team = $author->currentTeam;
    $member = User::factory()->create();
    $team->members()->attach($member, ['role' => 'member']);

    Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $author->id,
        'team_readable' => true,
        'server_seq' => 1,
    ]);

    $this->actingAs($member)
        ->getJson(route('notes.sync.pull', $team))
        ->assertJsonPath('notes.0.access', 'read');
});

test('the author pull carries the sharing state', function () {
    $author = User::factory()->create();
    $team = $author->currentTeam;
    $reader = User::factory()->create();
    $team->members()->attach($reader, ['role' => 'member']);

    $note = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $author->id,
        'team_readable' => true,
        'server_seq' => 1,
    ]);
    NoteShare::factory()->create(['note_id' => $note->id, 'user_id' => $reader->id, 'access' => 'read']);

    $this->actingAs($author)
        ->getJson(route('notes.sync.pull', $team))
        ->assertJsonPath('notes.0.access', 'owner')
        ->assertJsonPath('notes.0.sharing.team_readable', true)
        ->assertJsonPath('notes.0.sharing.shares.0.user_id', $reader->id)
        ->assertJsonPath('notes.0.sharing.shares.0.access', 'read');
});
