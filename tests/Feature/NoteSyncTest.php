<?php

use App\Models\Note;
use App\Models\User;
use Illuminate\Support\Str;

function syncChange(array $overrides = []): array
{
    return array_merge([
        'id' => (string) Str::uuid(),
        'type' => 'note',
        'date_key' => null,
        'title' => 'Meeting notes',
        'content' => "# Meeting notes\n\n- [ ] Follow up >2026-07-20",
        'folder' => 'Meetings',
        'pinned' => false,
        'base_version' => 0,
        'deleted' => false,
        'client_updated_at' => now()->toISOString(),
    ], $overrides);
}

test('guests cannot use the sync api', function () {
    $user = User::factory()->create();

    $this->getJson(route('notes.sync.pull', $user->currentTeam))
        ->assertUnauthorized();
});

test('pull returns an empty changeset for a fresh workspace', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->getJson(route('notes.sync.pull', $user->currentTeam))
        ->assertSuccessful()
        ->assertJson(['cursor' => 0, 'has_more' => false, 'notes' => []]);
});

test('pushing a new note creates it and pull returns it', function () {
    $user = User::factory()->create();
    $team = $user->currentTeam;
    $change = syncChange();

    $this->actingAs($user)
        ->postJson(route('notes.sync.push', $team), ['changes' => [$change]])
        ->assertSuccessful()
        ->assertJsonPath('results.0.status', 'applied')
        ->assertJsonPath('results.0.note.version', 1);

    $this->assertDatabaseHas('notes', [
        'id' => $change['id'],
        'team_id' => $team->id,
        'user_id' => $user->id,
        'title' => 'Meeting notes',
    ]);

    $this->actingAs($user)
        ->getJson(route('notes.sync.pull', $team))
        ->assertSuccessful()
        ->assertJsonPath('notes.0.id', $change['id'])
        ->assertJsonPath('cursor', 1);
});

test('pushing an update with a matching base version bumps the version', function () {
    $user = User::factory()->create();
    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'server_seq' => 1,
    ]);

    $this->actingAs($user)
        ->postJson(route('notes.sync.push', $user->currentTeam), [
            'changes' => [syncChange([
                'id' => $note->id,
                'title' => 'Updated title',
                'base_version' => 1,
            ])],
        ])
        ->assertSuccessful()
        ->assertJsonPath('results.0.status', 'applied')
        ->assertJsonPath('results.0.note.version', 2)
        ->assertJsonPath('results.0.note.title', 'Updated title');
});

test('a stale change with a newer timestamp wins via last-write-wins', function () {
    $user = User::factory()->create();
    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'version' => 5,
        'server_seq' => 1,
        'updated_at' => now()->subHour(),
    ]);

    $this->actingAs($user)
        ->postJson(route('notes.sync.push', $user->currentTeam), [
            'changes' => [syncChange([
                'id' => $note->id,
                'title' => 'Newer edit',
                'base_version' => 3,
                'client_updated_at' => now()->toISOString(),
            ])],
        ])
        ->assertSuccessful()
        ->assertJsonPath('results.0.status', 'applied')
        ->assertJsonPath('results.0.note.title', 'Newer edit')
        ->assertJsonPath('results.0.note.version', 6);
});

test('a stale change with an older timestamp reports a conflict with the server copy', function () {
    $user = User::factory()->create();
    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'Server truth',
        'version' => 5,
        'server_seq' => 1,
        'updated_at' => now(),
    ]);

    $this->actingAs($user)
        ->postJson(route('notes.sync.push', $user->currentTeam), [
            'changes' => [syncChange([
                'id' => $note->id,
                'title' => 'Old offline edit',
                'base_version' => 3,
                'client_updated_at' => now()->subHour()->toISOString(),
            ])],
        ])
        ->assertSuccessful()
        ->assertJsonPath('results.0.status', 'conflict')
        ->assertJsonPath('results.0.note.title', 'Server truth')
        ->assertJsonPath('results.0.note.version', 5);

    expect($note->refresh()->title)->toBe('Server truth');
});

test('pushing a delete soft deletes the note and pull reports it', function () {
    $user = User::factory()->create();
    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'server_seq' => 1,
    ]);

    $this->actingAs($user)
        ->postJson(route('notes.sync.push', $user->currentTeam), [
            'changes' => [syncChange([
                'id' => $note->id,
                'base_version' => 1,
                'deleted' => true,
            ])],
        ])
        ->assertSuccessful()
        ->assertJsonPath('results.0.status', 'applied')
        ->assertJsonPath('results.0.note.deleted', true);

    $this->assertSoftDeleted('notes', ['id' => $note->id]);

    $this->actingAs($user)
        ->getJson(route('notes.sync.pull', $user->currentTeam))
        ->assertSuccessful()
        ->assertJsonPath('notes.0.deleted', true);
});

test('creating a duplicate calendar note is remapped onto the existing one', function () {
    $user = User::factory()->create();
    $existing = Note::factory()->daily('2026-07-11')->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'server_seq' => 1,
    ]);

    $this->actingAs($user)
        ->postJson(route('notes.sync.push', $user->currentTeam), [
            'changes' => [syncChange([
                'type' => 'daily',
                'date_key' => '2026-07-11',
                'title' => '',
                'content' => 'New content from second device',
            ])],
        ])
        ->assertSuccessful()
        ->assertJsonPath('results.0.status', 'remapped')
        ->assertJsonPath('results.0.note.id', $existing->id)
        ->assertJsonPath('results.0.note.content', 'New content from second device');

    expect(Note::query()->where('type', 'daily')->where('date_key', '2026-07-11')->count())->toBe(1);
});

test('a note id belonging to another workspace cannot be hijacked', function () {
    $victim = User::factory()->create();
    $attacker = User::factory()->create();
    $note = Note::factory()->create([
        'team_id' => $victim->currentTeam->id,
        'user_id' => $victim->id,
        'server_seq' => 1,
    ]);

    $this->actingAs($attacker)
        ->postJson(route('notes.sync.push', $attacker->currentTeam), [
            'changes' => [syncChange(['id' => $note->id, 'title' => 'Hijacked'])],
        ])
        ->assertForbidden();

    expect($note->refresh()->title)->not->toBe('Hijacked');
});

test('users cannot sync against a team they do not belong to', function () {
    $user = User::factory()->create();
    $stranger = User::factory()->create();

    $this->actingAs($stranger)
        ->getJson(route('notes.sync.pull', $user->currentTeam))
        ->assertForbidden();
});

test('pull does not leak notes of other members in the same team', function () {
    $owner = User::factory()->create();
    $team = $owner->currentTeam;
    $member = User::factory()->create();
    $team->members()->attach($member, ['role' => 'member']);

    Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $owner->id,
        'server_seq' => 1,
    ]);

    $this->actingAs($member)
        ->getJson(route('notes.sync.pull', $team))
        ->assertSuccessful()
        ->assertJsonCount(0, 'notes');
});
