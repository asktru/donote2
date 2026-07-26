<?php

use App\Actions\Notes\RetargetWikiLinks;
use App\Actions\Notes\WriteNote;
use App\Mcp\Servers\DonoteServer;
use App\Mcp\Tools\UpdateNoteTool;
use App\Models\Note;
use App\Models\User;

// Wiki links resolve by title, so a rename made server-side (MCP tools, the
// v1 API) has to carry the notes pointing at the old title with it — the same
// way the client does when the title is edited in the app.

/** An account the MCP tools act as. */
function renamingUser(): User
{
    $user = User::factory()->create();
    config(['donote.mcp_user_email' => $user->email]);

    return $user;
}

function linkingNote(User $user, string $content, string $title = 'Linker'): Note
{
    return Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => $title,
        'content' => $content,
        'server_seq' => 1,
    ]);
}

function retarget(string $content, string $from, string $to): string
{
    return app(RetargetWikiLinks::class)->apply($content, $from, $to);
}

describe('rewriting one note’s content', function () {
    it('repoints a plain link at the new title', function () {
        expect(retarget('See [[Booster]] for context.', 'Booster', 'Rocket'))
            ->toBe('See [[Rocket]] for context.');
    });

    it('keeps a named link’s label, and its spacing', function () {
        expect(retarget('[[Booster|the plan]]', 'Booster', 'Rocket'))
            ->toBe('[[Rocket|the plan]]')
            ->and(retarget('[[Booster | the plan]]', 'Booster', 'Rocket'))
            ->toBe('[[Rocket | the plan]]');
    });

    it('matches titles the way links resolve — trimmed, any case', function () {
        expect(retarget('[[ booster ]]', 'Booster', 'Rocket'))->toBe('[[Rocket]]')
            ->and(retarget('[[BOOSTER|x]]', 'booster', 'Rocket'))->toBe('[[Rocket|x]]');
    });

    it('leaves near-miss titles and plain text alone', function () {
        $content = 'Booster [[Boosters]] [[Booster room]] [Booster](https://x.test)';

        expect(retarget($content, 'Booster', 'Rocket'))->toBe($content);
    });

    it('does nothing when either title is blank, or nothing changed', function () {
        expect(retarget('[[Booster]]', 'Booster', '  '))->toBe('[[Booster]]')
            ->and(retarget('[[Booster]]', '', 'Rocket'))->toBe('[[Booster]]')
            ->and(retarget('[[Booster]]', 'Booster', 'Booster'))->toBe('[[Booster]]');
    });
});

it('repoints links across the workspace when a note is renamed', function () {
    $user = renamingUser();
    $team = $user->currentTeam;

    $note = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $user->id,
        'title' => 'Booster',
        'content' => '# Booster',
        'server_seq' => 1,
    ]);
    $linker = linkingNote($user, "- [ ] Ask about [[Booster]]\n- [ ] And [[Booster | the plan]]");

    DonoteServer::tool(UpdateNoteTool::class, [
        'id' => $note->id,
        'content' => '# Booster',
        'new_title' => 'Rocket Booster',
    ])->assertOk();

    expect($note->refresh()->title)->toBe('Rocket Booster')
        ->and($linker->refresh()->content)
        ->toBe("- [ ] Ask about [[Rocket Booster]]\n- [ ] And [[Rocket Booster | the plan]]")
        ->and($linker->version)->toBe(2)
        ->and($linker->server_seq)->toBeGreaterThan(1);
});

it('rewrites the renamed note’s own links in the same write', function () {
    $user = renamingUser();

    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'Booster',
        'content' => 'Self [[Booster]]',
        'server_seq' => 1,
    ]);

    DonoteServer::tool(UpdateNoteTool::class, [
        'id' => $note->id,
        'content' => 'Self [[Booster]]',
        'new_title' => 'Rocket',
    ])->assertOk();

    // One write, not two: the rewrite rides along with the content the tool
    // is already saving.
    expect($note->refresh()->content)->toBe('Self [[Rocket]]')
        ->and($note->version)->toBe(2);
});

it('leaves other notes untouched when the title did not change', function () {
    $user = renamingUser();

    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'Booster',
        'content' => '# Booster',
        'server_seq' => 1,
    ]);
    $linker = linkingNote($user, 'Ask about [[Booster]]');

    DonoteServer::tool(UpdateNoteTool::class, [
        'id' => $note->id,
        'content' => "# Booster\n\nmore",
    ])->assertOk();

    expect($linker->refresh()->content)->toBe('Ask about [[Booster]]')
        ->and($linker->version)->toBe(1);
});

it('never reaches into another user’s notes', function () {
    $user = renamingUser();
    $stranger = User::factory()->create();

    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'Booster',
        'content' => '# Booster',
        'server_seq' => 1,
    ]);
    $theirs = linkingNote($stranger, 'Ask about [[Booster]]');

    DonoteServer::tool(UpdateNoteTool::class, [
        'id' => $note->id,
        'content' => '# Booster',
        'new_title' => 'Rocket',
    ])->assertOk();

    expect($theirs->refresh()->content)->toBe('Ask about [[Booster]]')
        ->and($theirs->version)->toBe(1);
});

it('leaves trashed notes in the trash', function () {
    // A write carries `deleted: false`, so rewriting a trashed note would
    // resurrect it. Soft-deleted notes stay out of the sweep entirely — the
    // client skips them the same way.
    $user = renamingUser();

    $note = Note::factory()->create([
        'team_id' => $user->currentTeam->id,
        'user_id' => $user->id,
        'title' => 'Booster',
        'content' => '# Booster',
        'server_seq' => 1,
    ]);
    $trashed = linkingNote($user, 'Ask about [[Booster]]');
    $trashed->delete();

    DonoteServer::tool(UpdateNoteTool::class, [
        'id' => $note->id,
        'content' => '# Booster',
        'new_title' => 'Rocket',
    ])->assertOk();

    $trashed = Note::withTrashed()->find($trashed->id);

    expect($trashed->trashed())->toBeTrue()
        ->and($trashed->content)->toBe('Ask about [[Booster]]');
});

it('does not rewrite anything when creating a note', function () {
    $user = renamingUser();
    $linker = linkingNote($user, 'Ask about [[Booster]]');

    app(WriteNote::class)->execute($user->currentTeam, $user, null, [
        'title' => 'Booster',
        'content' => 'brand new',
    ]);

    expect($linker->refresh()->content)->toBe('Ask about [[Booster]]')
        ->and($linker->version)->toBe(1);
});
