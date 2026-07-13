<?php

use App\Models\Note;
use App\Models\NoteShare;
use App\Models\Team;
use App\Models\User;

/**
 * @return array{author: User, writer: User, reader: User, team: Team, note: Note}
 */
function pushSharingFixture(): array
{
    $author = User::factory()->create();
    $team = $author->currentTeam;
    $writer = User::factory()->create();
    $reader = User::factory()->create();
    $team->members()->attach($writer, ['role' => 'member']);
    $team->members()->attach($reader, ['role' => 'member']);

    $note = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $author->id,
        'content' => 'original',
        'server_seq' => 1,
        'version' => 1,
    ]);
    NoteShare::factory()->create(['note_id' => $note->id, 'user_id' => $writer->id, 'access' => 'write']);
    NoteShare::factory()->create(['note_id' => $note->id, 'user_id' => $reader->id, 'access' => 'read']);

    return compact('author', 'writer', 'reader', 'team', 'note');
}

function editChange(Note $note, string $content, bool $deleted = false): array
{
    return [
        'id' => $note->id,
        'type' => 'note',
        'date_key' => null,
        'title' => $note->title,
        'content' => $content,
        'folder' => $note->folder,
        'pinned' => false,
        'base_version' => $note->version,
        'deleted' => $deleted,
        'client_updated_at' => now()->addSecond()->toISOString(),
    ];
}

test('a write collaborator can edit a shared note', function () {
    ['writer' => $writer, 'team' => $team, 'note' => $note] = pushSharingFixture();

    $this->actingAs($writer)
        ->postJson(route('notes.sync.push', $team), ['changes' => [editChange($note, 'edited by writer')]])
        ->assertSuccessful()
        ->assertJsonPath('results.0.status', 'applied');

    expect($note->fresh()->content)->toBe('edited by writer')
        ->and($note->fresh()->version)->toBe(2);
});

test('a read recipient cannot edit a shared note', function () {
    ['reader' => $reader, 'team' => $team, 'note' => $note] = pushSharingFixture();

    $this->actingAs($reader)
        ->postJson(route('notes.sync.push', $team), ['changes' => [editChange($note, 'sneaky edit')]])
        ->assertForbidden();

    expect($note->fresh()->content)->toBe('original');
});

test('a non-author cannot delete a shared note', function () {
    ['writer' => $writer, 'team' => $team, 'note' => $note] = pushSharingFixture();

    $this->actingAs($writer)
        ->postJson(route('notes.sync.push', $team), ['changes' => [editChange($note, 'original', deleted: true)]])
        ->assertForbidden();

    expect($note->fresh()->trashed())->toBeFalse();
});

test('the author can delete their own shared note', function () {
    ['author' => $author, 'team' => $team, 'note' => $note] = pushSharingFixture();

    $this->actingAs($author)
        ->postJson(route('notes.sync.push', $team), ['changes' => [editChange($note, 'original', deleted: true)]])
        ->assertSuccessful()
        ->assertJsonPath('results.0.status', 'applied');

    expect($note->fresh()->trashed())->toBeTrue();
});
