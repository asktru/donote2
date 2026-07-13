<?php

use App\Enums\NoteAccess;
use App\Models\Note;
use App\Models\NoteShare;
use App\Models\Team;
use App\Models\User;

/**
 * Build an author, their team, and two fellow members.
 *
 * @return array{author: User, reader: User, writer: User, stranger: User, team: Team}
 */
function sharingFixture(): array
{
    $author = User::factory()->create();
    $team = $author->currentTeam;

    $reader = User::factory()->create();
    $writer = User::factory()->create();
    $stranger = User::factory()->create();

    foreach ([$reader, $writer, $stranger] as $member) {
        $team->members()->attach($member, ['role' => 'member']);
    }

    return compact('author', 'reader', 'writer', 'stranger', 'team');
}

test('note_shares relation and team_readable cast work', function () {
    $author = User::factory()->create();
    $note = Note::factory()->create([
        'team_id' => $author->currentTeam->id,
        'user_id' => $author->id,
        'team_readable' => 1,
    ]);
    NoteShare::factory()->create(['note_id' => $note->id, 'access' => 'write']);

    expect($note->team_readable)->toBeTrue()
        ->and($note->shares)->toHaveCount(1)
        ->and($note->shares->first()->access)->toBe('write');
});

test('accessFor resolves the five cases', function () {
    ['author' => $author, 'reader' => $reader, 'writer' => $writer, 'stranger' => $stranger, 'team' => $team] = sharingFixture();

    $note = Note::factory()->create(['team_id' => $team->id, 'user_id' => $author->id]);
    NoteShare::factory()->create(['note_id' => $note->id, 'user_id' => $reader->id, 'access' => 'read']);
    NoteShare::factory()->create(['note_id' => $note->id, 'user_id' => $writer->id, 'access' => 'write']);
    $note->load('shares');

    expect($note->accessFor($author))->toBe(NoteAccess::Owner)
        ->and($note->accessFor($reader))->toBe(NoteAccess::Read)
        ->and($note->accessFor($writer))->toBe(NoteAccess::Write)
        ->and($note->accessFor($stranger))->toBe(NoteAccess::None);
});

test('team_readable grants read to any member', function () {
    ['author' => $author, 'stranger' => $stranger, 'team' => $team] = sharingFixture();

    $note = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $author->id,
        'team_readable' => true,
    ]);
    $note->load('shares');

    expect($note->accessFor($stranger))->toBe(NoteAccess::Read);
});

test('scopeVisibleTo returns own, team-readable, and shared notes only', function () {
    ['author' => $author, 'reader' => $reader, 'team' => $team] = sharingFixture();

    $mine = Note::factory()->create(['team_id' => $team->id, 'user_id' => $reader->id]);
    $shared = Note::factory()->create(['team_id' => $team->id, 'user_id' => $author->id]);
    NoteShare::factory()->create(['note_id' => $shared->id, 'user_id' => $reader->id, 'access' => 'read']);
    $public = Note::factory()->create(['team_id' => $team->id, 'user_id' => $author->id, 'team_readable' => true]);
    $private = Note::factory()->create(['team_id' => $team->id, 'user_id' => $author->id]);

    $visible = Note::query()->visibleTo($team, $reader)->pluck('id');

    expect($visible)->toContain($mine->id, $shared->id, $public->id)
        ->and($visible)->not->toContain($private->id);
});

test('note policy enforces access levels', function () {
    ['author' => $author, 'reader' => $reader, 'writer' => $writer, 'stranger' => $stranger, 'team' => $team] = sharingFixture();

    $note = Note::factory()->create(['team_id' => $team->id, 'user_id' => $author->id]);
    NoteShare::factory()->create(['note_id' => $note->id, 'user_id' => $reader->id, 'access' => 'read']);
    NoteShare::factory()->create(['note_id' => $note->id, 'user_id' => $writer->id, 'access' => 'write']);

    expect($author->can('update', $note))->toBeTrue()
        ->and($writer->can('update', $note))->toBeTrue()
        ->and($reader->can('update', $note))->toBeFalse()
        ->and($reader->can('view', $note))->toBeTrue()
        ->and($stranger->can('view', $note))->toBeFalse()
        ->and($writer->can('delete', $note))->toBeFalse()
        ->and($author->can('delete', $note))->toBeTrue()
        ->and($writer->can('share', $note))->toBeFalse()
        ->and($author->can('share', $note))->toBeTrue();
});

test('touchServerSeq advances server_seq without changing updated_at', function () {
    $author = User::factory()->create();
    $note = Note::factory()->create([
        'team_id' => $author->currentTeam->id,
        'user_id' => $author->id,
        'server_seq' => 5,
    ]);
    $originalUpdatedAt = $note->updated_at;

    $note->touchServerSeq();

    expect($note->server_seq)->toBeGreaterThan(5)
        ->and($note->fresh()->updated_at->equalTo($originalUpdatedAt))->toBeTrue();
});
