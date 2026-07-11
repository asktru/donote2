<?php

use App\Actions\Notes\PropagateSyncedLines;
use App\Models\Note;
use App\Models\User;

it('rewrites synced-line copies in other notes, preserving indentation', function () {
    $user = User::factory()->create();
    $team = $user->currentTeam;

    $other = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $user->id,
        'content' => "# Other\n    - [ ] Ship it ^abc123\ntext",
        'server_seq' => 1,
    ]);

    $updated = app(PropagateSyncedLines::class)->execute(
        $team,
        $user,
        '- [ ] Ship it ^abc123',
        '- [x] Ship it done ^abc123',
        'some-other-note-id',
    );

    expect($updated)->toBe(1)
        ->and($other->refresh()->content)
        ->toBe("# Other\n    - [x] Ship it done ^abc123\ntext")
        ->and($other->version)->toBe(2);
});

it('does nothing when no synced lines changed', function () {
    $user = User::factory()->create();
    $team = $user->currentTeam;

    $other = Note::factory()->create([
        'team_id' => $team->id,
        'user_id' => $user->id,
        'content' => '- [ ] Same ^abc123',
        'server_seq' => 1,
    ]);

    $updated = app(PropagateSyncedLines::class)->execute(
        $team,
        $user,
        '- [ ] Unrelated edit',
        '- [ ] Unrelated edit v2',
        'excluded',
    );

    expect($updated)->toBe(0)
        ->and($other->refresh()->version)->toBe(1);
});

it('picks the edited copy when the source note holds duplicates', function () {
    $action = app(PropagateSyncedLines::class);

    $changed = $action->changedSyncedLines(
        "- [ ] Same ^aaa111\n- [ ] Same ^aaa111",
        "- [ ] Same ^aaa111\n- [x] Edited ^aaa111",
    );

    expect($changed)->toBe(['aaa111' => '- [x] Edited ^aaa111']);
});

it('ignores carets that are not trailing sync ids', function () {
    $action = app(PropagateSyncedLines::class);

    expect($action->collectSyncedLines("math 2^10 stuff\nmid ^abc123 not at end"))
        ->toBe([]);
});
