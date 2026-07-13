<?php

use App\Actions\Meetings\FormatBluedotSummary;
use App\Actions\Notes\AppendUnderHeading;
use App\Actions\Notes\WriteNote;
use App\Jobs\ProcessBluedotSummary;
use App\Models\Note;
use App\Models\Team;
use App\Models\User;
use Illuminate\Support\Facades\Queue;

function bluedotPayload(array $overrides = []): array
{
    return array_merge([
        'type' => 'video.summary.created',
        'title' => 'Ivan <> Anton',
        'createdAt' => 1741087081, // 2025-03-04
        'attendees' => ['test@example.com'],
        'meetingId' => 'meet.google.com/vtf-wvmj-utp',
        'videoId' => '67c6e169960cdc0b315d42ec',
        'summaryV2' => "## Overview\nA chat.\n\n## Action Items\n\n### Ivan\n- Ship the thing\n\n## Topics\n\n<u>**Growth**</u>\n\nWe grew.",
    ], $overrides);
}

test('the webhook rejects a missing or bad token', function () {
    Queue::fake();

    $this->postJson('/webhooks/bluedot', bluedotPayload())->assertUnauthorized();
    $this->postJson('/webhooks/bluedot?token=nope', bluedotPayload())->assertUnauthorized();

    Queue::assertNothingPushed();
});

test('a valid token queues the summary for its owner', function () {
    Queue::fake();
    $user = User::factory()->create();
    $token = $user->createToken('bluedot-webhook')->plainTextToken;

    $this->postJson("/webhooks/bluedot?token={$token}", bluedotPayload())
        ->assertStatus(202)
        ->assertJsonPath('status', 'queued');

    Queue::assertPushed(
        ProcessBluedotSummary::class,
        fn (ProcessBluedotSummary $job) => $job->userId === $user->id
            && $job->teamId === $user->currentTeam->id,
    );
});

test('the webhook files into the team encoded in the token', function () {
    Queue::fake();
    $user = User::factory()->create();
    $other = Team::factory()->create();
    $user->teams()->attach($other, ['role' => 'member']);

    $token = $user->createToken('bluedot:'.$other->slug, ['bluedot', 'team:'.$other->id])
        ->plainTextToken;

    $this->postJson("/webhooks/bluedot?token={$token}", bluedotPayload())
        ->assertStatus(202);

    Queue::assertPushed(
        ProcessBluedotSummary::class,
        fn (ProcessBluedotSummary $job) => $job->teamId === $other->id,
    );
});

test('the webhook rejects a token whose team the user has left', function () {
    Queue::fake();
    $user = User::factory()->create();
    $stranger = Team::factory()->create();

    // Token references a team the user does not belong to.
    $token = $user->createToken('bluedot:'.$stranger->slug, ['bluedot', 'team:'.$stranger->id])
        ->plainTextToken;

    $this->postJson("/webhooks/bluedot?token={$token}", bluedotPayload())
        ->assertUnauthorized();

    Queue::assertNothingPushed();
});

test('the job drops the summary when the user no longer belongs to the team', function () {
    $user = User::factory()->create();
    $team = Team::factory()->create(); // user is NOT a member

    (new ProcessBluedotSummary($user->id, $team->id, bluedotPayload()))->handle(
        app(WriteNote::class),
        app(AppendUnderHeading::class),
        app(FormatBluedotSummary::class),
    );

    expect(Note::query()->where('team_id', $team->id)->count())->toBe(0);
});

test('non-summary events are ignored', function () {
    Queue::fake();
    $user = User::factory()->create();
    $token = $user->createToken('bluedot-webhook')->plainTextToken;

    $this->postJson("/webhooks/bluedot?token={$token}", bluedotPayload(['type' => 'video.created']))
        ->assertStatus(202)
        ->assertJsonPath('status', 'ignored');

    Queue::assertNothingPushed();
});

test('the job stores a meeting note and links it from the daily note', function () {
    $user = User::factory()->create();
    $team = $user->currentTeam;

    (new ProcessBluedotSummary($user->id, $team->id, bluedotPayload()))->handle(
        app(WriteNote::class),
        app(AppendUnderHeading::class),
        app(FormatBluedotSummary::class),
    );

    $note = Note::query()->forWorkspace($team, $user)
        ->where('folder', 'Meetings')->firstOrFail();

    expect($note->title)->toBe('Ivan <> Anton')
        ->and($note->content)->toContain('meeting-date: 2025-03-04')
        ->and($note->content)->toContain('video-id: 67c6e169960cdc0b315d42ec')
        // Action-item bullet became a checklist item; topics stayed bullets.
        ->and($note->content)->toContain('+ [ ] Ship the thing')
        ->and($note->content)->toContain('### Growth')
        ->and($note->content)->not->toContain('<u>');

    $daily = Note::query()->forWorkspace($team, $user)
        ->where('type', 'daily')->where('date_key', '2025-03-04')->firstOrFail();

    expect($daily->content)->toContain('## Meetings')
        ->and($daily->content)->toContain('- [[Ivan <> Anton]]');
});

test('a re-sent summary updates the same note without duplicating', function () {
    $user = User::factory()->create();
    $team = $user->currentTeam;

    $run = fn (array $payload) => (new ProcessBluedotSummary($user->id, $team->id, $payload))->handle(
        app(WriteNote::class),
        app(AppendUnderHeading::class),
        app(FormatBluedotSummary::class),
    );

    $run(bluedotPayload());
    $run(bluedotPayload(['summaryV2' => "## Overview\nUpdated recap.\n\n## Action Items\n\n### Ivan\n- Revised"]));

    $notes = Note::query()->forWorkspace($team, $user)->where('folder', 'Meetings')->get();
    expect($notes)->toHaveCount(1)
        ->and($notes->first()->content)->toContain('Updated recap');

    $daily = Note::query()->forWorkspace($team, $user)
        ->where('type', 'daily')->where('date_key', '2025-03-04')->firstOrFail();
    // The daily link appears exactly once despite the resend.
    expect(substr_count($daily->content, '- [[Ivan <> Anton]]'))->toBe(1);
});

test('an opaque id title falls back to a dated title', function () {
    $user = User::factory()->create();
    $team = $user->currentTeam;

    (new ProcessBluedotSummary($user->id, $team->id, bluedotPayload(['title' => '67b607ef046d4245108ea83f'])))->handle(
        app(WriteNote::class),
        app(AppendUnderHeading::class),
        app(FormatBluedotSummary::class),
    );

    $note = Note::query()->forWorkspace($team, $user)->where('folder', 'Meetings')->firstOrFail();
    expect($note->title)->toBe('Meeting — 2025-03-04');
});

test('the bluedot url command mints a working webhook url', function () {
    Queue::fake();
    User::factory()->create(['email' => 'meet@example.com']);

    $this->artisan('bluedot:url meet@example.com')->assertSuccessful();
});
