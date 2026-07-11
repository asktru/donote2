<?php

use App\Mcp\Servers\DonoteServer;
use App\Mcp\Tools\AppendToDailyNoteTool;
use App\Mcp\Tools\AppendToNoteTool;
use App\Mcp\Tools\CreateNoteTool;
use App\Mcp\Tools\DeleteNoteTool;
use App\Mcp\Tools\GetNoteTool;
use App\Mcp\Tools\ListNotesTool;
use App\Mcp\Tools\SearchNotesTool;
use App\Mcp\Tools\UpdateNoteTool;
use App\Models\Note;
use App\Models\User;

function mcpUser(): User
{
    $user = User::factory()->create();
    config(['donote.mcp_user_email' => $user->email]);

    return $user;
}

test('list-notes returns workspace notes with ids', function () {
    $user = mcpUser();
    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'Architecture Doc',
        'folder' => 'Projects',
        'server_seq' => 1,
    ]);

    DonoteServer::tool(ListNotesTool::class, [])
        ->assertOk()
        ->assertSee('Architecture Doc')
        ->assertSee($note->id);
});

test('list-notes filters by folder including subfolders', function () {
    $user = mcpUser();
    Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'In Projects',
        'folder' => 'Projects/Alpha',
        'server_seq' => 1,
    ]);
    Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'Elsewhere',
        'folder' => 'Areas',
        'server_seq' => 2,
    ]);

    DonoteServer::tool(ListNotesTool::class, ['folder' => 'Projects'])
        ->assertOk()
        ->assertSee('In Projects')
        ->assertDontSee('Elsewhere');
});

test('list-notes does not leak other workspaces', function () {
    $user = mcpUser();
    $other = User::factory()->create();
    Note::factory()->create([
        'team_id' => $other->currentTeam->id,
        'user_id' => $other->id,
        'title' => 'Secret note',
        'server_seq' => 1,
    ]);

    DonoteServer::tool(ListNotesTool::class, [])
        ->assertOk()
        ->assertDontSee('Secret note');
});

test('search-notes finds notes by content', function () {
    $user = mcpUser();
    Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'Event bus ADR',
        'content' => "# ADR\n\n- [ ] Compare Kafka vs NATS",
        'server_seq' => 1,
    ]);

    DonoteServer::tool(SearchNotesTool::class, ['query' => 'kafka'])
        ->assertOk()
        ->assertSee('Event bus ADR');
});

test('get-note locates by title and by daily date key', function () {
    $user = mcpUser();
    Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'Team OKRs',
        'content' => '# Team OKRs body',
        'server_seq' => 1,
    ]);
    Note::factory()->daily('2026-07-15')->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'content' => 'Daily agenda here',
        'server_seq' => 2,
    ]);

    DonoteServer::tool(GetNoteTool::class, ['title' => 'team okrs'])
        ->assertOk()
        ->assertSee('# Team OKRs body');

    DonoteServer::tool(GetNoteTool::class, ['date' => '2026-07-15'])
        ->assertOk()
        ->assertSee('Daily agenda here');
});

test('create-note creates a typed note in a folder', function () {
    $user = mcpUser();

    DonoteServer::tool(CreateNoteTool::class, [
        'title' => 'Website Relaunch',
        'folder' => 'Projects',
        'note_type' => 'project',
        'content' => '- [ ] Kickoff >2026-08-01',
    ])->assertOk()->assertSee('Created note');

    $note = Note::query()->where('title', 'Website Relaunch')->firstOrFail();

    expect($note->folder)->toBe('Projects')
        ->and($note->content)->toContain('type: project')
        ->and($note->content)->toContain('- [ ] Kickoff >2026-08-01')
        ->and($note->team_id)->toBe($user->currentTeam->id);
});

test('create-note refuses duplicate titles', function () {
    $user = mcpUser();
    Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'Existing',
        'server_seq' => 1,
    ]);

    DonoteServer::tool(CreateNoteTool::class, ['title' => 'existing'])
        ->assertHasErrors();
});

test('update-note replaces content and bumps the sync version', function () {
    $user = mcpUser();
    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'Doc',
        'content' => 'old',
        'server_seq' => 1,
    ]);

    DonoteServer::tool(UpdateNoteTool::class, [
        'id' => $note->id,
        'content' => "# Doc\n\nnew content",
    ])->assertOk()->assertSee('version 2');

    expect($note->refresh()->content)->toBe("# Doc\n\nnew content")
        ->and($note->version)->toBe(2)
        ->and($note->server_seq)->toBeGreaterThan(1);
});

test('update-note propagates synced lines to other notes', function () {
    $user = mcpUser();
    $team = $user->currentTeam;

    $source = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $user->id,
        'title' => 'Source',
        'content' => '- [ ] Shared task ^abc123',
        'server_seq' => 1,
    ]);
    $copy = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $user->id,
        'title' => 'Copy',
        'content' => "# Copy\n- [ ] Shared task ^abc123",
        'server_seq' => 2,
    ]);

    DonoteServer::tool(UpdateNoteTool::class, [
        'id' => $source->id,
        'content' => '- [x] Shared task updated ^abc123',
    ])->assertOk();

    expect($copy->refresh()->content)->toBe("# Copy\n- [x] Shared task updated ^abc123");
});

test('append-to-note keeps existing content intact', function () {
    $user = mcpUser();
    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'Inbox',
        'content' => "# Inbox\n\n- [ ] First",
        'server_seq' => 1,
    ]);

    DonoteServer::tool(AppendToNoteTool::class, [
        'title' => 'Inbox',
        'text' => '- [ ] Second >2026-08-01',
    ])->assertOk();

    expect($note->refresh()->content)->toBe("# Inbox\n\n- [ ] First\n- [ ] Second >2026-08-01\n");
});

test('append-to-daily-note creates the daily note when missing', function () {
    $user = mcpUser();

    DonoteServer::tool(AppendToDailyNoteTool::class, [
        'text' => '- [ ] Call the vendor @2pm',
        'date' => '2026-07-20',
    ])->assertOk()->assertSee('2026-07-20');

    $daily = Note::query()
        ->where('type', 'daily')
        ->where('date_key', '2026-07-20')
        ->firstOrFail();

    expect($daily->content)->toBe("- [ ] Call the vendor @2pm\n")
        ->and($daily->user_id)->toBe($user->id);
});

test('append-to-daily-note appends to an existing daily note', function () {
    $user = mcpUser();
    Note::factory()->daily('2026-07-20')->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'content' => '## Plan',
        'server_seq' => 1,
    ]);

    DonoteServer::tool(AppendToDailyNoteTool::class, [
        'text' => '- [ ] Captured',
        'date' => '2026-07-20',
    ])->assertOk();

    $daily = Note::query()->where('date_key', '2026-07-20')->firstOrFail();

    expect($daily->content)->toBe("## Plan\n- [ ] Captured\n");
});

test('delete-note soft deletes and refuses foreign notes', function () {
    $user = mcpUser();
    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'Old note',
        'server_seq' => 1,
    ]);

    DonoteServer::tool(DeleteNoteTool::class, ['id' => $note->id])
        ->assertOk()
        ->assertSee('trash');

    expect(Note::withTrashed()->find($note->id)->trashed())->toBeTrue();

    $other = User::factory()->create();
    $foreign = Note::factory()->create([
        'team_id' => $other->currentTeam->id,
        'user_id' => $other->id,
        'server_seq' => 2,
    ]);

    DonoteServer::tool(DeleteNoteTool::class, ['id' => $foreign->id])
        ->assertHasErrors();

    expect(Note::withTrashed()->find($foreign->id)->trashed())->toBeFalse();
});
