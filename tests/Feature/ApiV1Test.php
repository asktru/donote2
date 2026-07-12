<?php

use App\Models\Note;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

function apiV1User(): array
{
    $user = User::factory()->create();
    $token = $user->createToken('knowtabs')->plainTextToken;

    return [$user, $user->currentTeam, ['Authorization' => "Bearer {$token}"]];
}

test('the v1 api rejects unauthenticated requests', function () {
    $this->postJson('/v1/notes', ['title' => 'Clip'])->assertUnauthorized();
    $this->getJson('/v1/notes?title=Clip')->assertUnauthorized();
    $this->postJson('/v1/daily-notes/2026-07-12/append', ['text' => '- hi'])->assertUnauthorized();
    $this->postJson('/v1/attachments')->assertUnauthorized();
});

test('creating a note returns its id, final title, and links', function () {
    [, $team, $headers] = apiV1User();

    $response = $this->withHeaders($headers)->postJson('/v1/notes', [
        'title' => 'Interesting Article',
        'content' => "- URL: https://example.com\n    - A description",
        'folder' => 'Web Clips',
        'tags' => ['web', '#reading'],
    ]);

    $response->assertCreated()
        ->assertJsonPath('title', 'Interesting Article')
        ->assertJsonPath('folder', 'Web Clips')
        ->assertJsonPath('created', true);

    $id = $response->json('id');
    expect($response->json('deeplink'))->toBe("donote://note/{$id}")
        ->and($response->json('web_url'))->toEndWith("/n/{$id}");

    $note = Note::query()->whereKey($id)->firstOrFail();
    expect($note->team_id)->toBe($team->id)
        ->and($note->folder)->toBe('Web Clips')
        ->and($note->content)->toContain('- URL: https://example.com')
        ->and($note->content)->toContain('#web #reading');
});

test('the server owns dedup and returns the renamed title', function () {
    [$user, $team, $headers] = apiV1User();

    $this->withHeaders($headers)->postJson('/v1/notes', ['title' => 'My Clip'])->assertCreated();
    $second = $this->withHeaders($headers)->postJson('/v1/notes', ['title' => 'my clip']);
    $third = $this->withHeaders($headers)->postJson('/v1/notes', ['title' => 'My Clip']);

    expect($second->json('title'))->toBe('my clip 2')
        ->and($third->json('title'))->toBe('My Clip 3');
});

test('if_exists switches between returning the existing note and a conflict', function () {
    [, , $headers] = apiV1User();

    $created = $this->withHeaders($headers)->postJson('/v1/notes', ['title' => 'Once']);

    $this->withHeaders($headers)
        ->postJson('/v1/notes', ['title' => 'Once', 'if_exists' => 'return-existing'])
        ->assertSuccessful()
        ->assertJsonPath('id', $created->json('id'))
        ->assertJsonPath('created', false);

    $this->withHeaders($headers)
        ->postJson('/v1/notes', ['title' => 'Once', 'if_exists' => 'error'])
        ->assertConflict()
        ->assertJsonPath('id', $created->json('id'));
});

test('wiki-breaking characters are stripped from titles', function () {
    [, , $headers] = apiV1User();

    $this->withHeaders($headers)
        ->postJson('/v1/notes', ['title' => 'A [[weird]] | #title ^here'])
        ->assertCreated()
        ->assertJsonPath('title', 'A weird title here');
});

test('appending to a missing daily note creates it with the heading', function () {
    [$user, $team, $headers] = apiV1User();

    $this->withHeaders($headers)
        ->postJson('/v1/daily-notes/2026-07-12/append', [
            'text' => '- [[Interesting Article]]',
            'heading' => 'Links',
        ])
        ->assertSuccessful()
        ->assertJsonPath('date_key', '2026-07-12');

    $note = Note::query()->forWorkspace($team, $user)
        ->where('type', 'daily')->where('date_key', '2026-07-12')->firstOrFail();

    expect($note->content)->toBe("## Links\n- [[Interesting Article]]\n");
});

test('appending inserts under an existing heading before the next section', function () {
    [$user, $team, $headers] = apiV1User();

    $this->withHeaders($headers)->postJson('/v1/daily-notes/2026-07-12/append', [
        'text' => "## Links\n- [[First]]\n\n## Journal\nA fine day.",
    ])->assertSuccessful();

    $this->withHeaders($headers)->postJson('/v1/daily-notes/2026-07-12/append', [
        'text' => '- [[Second]]',
        'heading' => 'Links',
    ])->assertSuccessful();

    $note = Note::query()->forWorkspace($team, $user)
        ->where('type', 'daily')->where('date_key', '2026-07-12')->firstOrFail();

    expect($note->content)
        ->toBe("## Links\n- [[First]]\n- [[Second]]\n\n## Journal\nA fine day.\n");
});

test('a malformed date key is rejected', function () {
    [, , $headers] = apiV1User();

    $this->withHeaders($headers)
        ->postJson('/v1/daily-notes/2026-W29/append', ['text' => '- hi'])
        ->assertNotFound();
});

test('uploading an attachment returns the embed markdown', function () {
    Storage::fake();
    [, , $headers] = apiV1User();

    $response = $this->withHeaders($headers)->postJson('/v1/attachments', [
        'file' => UploadedFile::fake()->image('recording-cover.png'),
    ]);

    $response->assertCreated();
    expect($response->json('url'))->toStartWith('/api/')
        ->and($response->json('embed'))->toBe("![recording-cover.png]({$response->json('url')})");

    $audio = $this->withHeaders($headers)->postJson('/v1/attachments', [
        'file' => UploadedFile::fake()->create('memo.m4a', 128, 'audio/mp4'),
    ]);

    expect($audio->json('embed'))->toBe("[memo.m4a]({$audio->json('url')})");
});

test('notes can be found by exact title for already-sent detection', function () {
    [, , $headers] = apiV1User();

    $created = $this->withHeaders($headers)
        ->postJson('/v1/notes', ['title' => 'Sent Before', 'folder' => 'Web Clips']);

    $this->withHeaders($headers)
        ->getJson('/v1/notes?title=sent%20before')
        ->assertSuccessful()
        ->assertJsonCount(1, 'notes')
        ->assertJsonPath('notes.0.id', $created->json('id'));

    $this->withHeaders($headers)
        ->getJson('/v1/notes?title=sent%20before&folder=Elsewhere')
        ->assertSuccessful()
        ->assertJsonCount(0, 'notes');
});

test('the deep-link route redirects into the owning team notes app', function () {
    [$user, $team, $headers] = apiV1User();

    $created = $this->withHeaders($headers)->postJson('/v1/notes', ['title' => 'Openable']);
    $daily = $this->withHeaders($headers)->postJson('/v1/daily-notes/2026-07-12/append', ['text' => '- hi']);

    $this->actingAs($user)
        ->get("/n/{$created->json('id')}")
        ->assertRedirect(route('notes', ['current_team' => $team->slug, 'v' => "note:{$created->json('id')}"]));

    $this->actingAs($user)
        ->get("/n/{$daily->json('id')}")
        ->assertRedirect(route('notes', ['current_team' => $team->slug, 'v' => 'daily:2026-07-12']));

    $this->actingAs($user)->get('/n/missing-id')->assertNotFound();
});

test('deep links to another user\'s note are not found', function () {
    [, , $headers] = apiV1User();
    $created = $this->withHeaders($headers)->postJson('/v1/notes', ['title' => 'Private']);

    $stranger = User::factory()->create();

    $this->actingAs($stranger)->get("/n/{$created->json('id')}")->assertNotFound();
});
