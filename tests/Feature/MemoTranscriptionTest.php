<?php

use App\Models\User;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;

// Provider/transport failures must return NON-gateway statuses with a JSON
// message: a real 502/504 from the app can be replaced by a proxy's own
// error page, hiding the reason (the opaque "502 Upload failed" bug).

test('guests cannot transcribe memos', function () {
    $user = User::factory()->create();

    $this->post(route('memos.transcribe', $user->currentTeam), [
        'audio' => UploadedFile::fake()->create('memo.webm', 100, 'audio/webm'),
    ])->assertUnauthorized();
});

test('transcription returns provider text', function () {
    config(['services.openai.key' => 'sk-test']);

    Http::fake([
        'api.openai.com/v1/audio/transcriptions' => Http::response([
            'text' => '  Bonjour, this is a mixed memo. Дякую!  ',
        ]),
    ]);

    $user = User::factory()->create();

    $this->actingAs($user)
        ->post(route('memos.transcribe', $user->currentTeam), [
            'audio' => UploadedFile::fake()->create('memo.webm', 100, 'audio/webm'),
        ])
        ->assertSuccessful()
        ->assertJsonPath('text', 'Bonjour, this is a mixed memo. Дякую!');

    Http::assertSent(function ($request) {
        return str_contains($request->url(), 'audio/transcriptions')
            && $request->hasHeader('Authorization', 'Bearer sk-test');
    });
});

test('transcription reports missing configuration', function () {
    config(['services.openai.key' => null]);

    $user = User::factory()->create();

    $this->actingAs($user)
        ->post(route('memos.transcribe', $user->currentTeam), [
            'audio' => UploadedFile::fake()->create('memo.webm', 100, 'audio/webm'),
        ])
        ->assertServiceUnavailable();
});

test('transcription surfaces provider failures', function () {
    config(['services.openai.key' => 'sk-test']);

    Http::fake([
        'api.openai.com/*' => Http::response(['error' => ['message' => 'rate limited']], 429),
    ]);

    $user = User::factory()->create();

    $this->actingAs($user)
        ->post(route('memos.transcribe', $user->currentTeam), [
            'audio' => UploadedFile::fake()->create('memo.webm', 100, 'audio/webm'),
        ])
        ->assertStatus(422)
        ->assertJsonPath('message', 'Transcription failed: rate limited');
});

test('a provider timeout returns a retryable message, not a 500', function () {
    config(['services.openai.key' => 'sk-test']);

    Http::fake(function () {
        throw new ConnectionException('cURL error 28: Operation timed out');
    });

    $user = User::factory()->create();

    $this->actingAs($user)
        ->postJson(route('memos.transcribe', $user->currentTeam), [
            'audio' => UploadedFile::fake()->create('memo.webm', 100, 'audio/webm'),
        ])
        ->assertStatus(503)
        ->assertJsonPath(
            'message',
            'Transcription could not reach the provider — it will retry.',
        );
});

test('non-audio uploads are rejected', function () {
    config(['services.openai.key' => 'sk-test']);

    $user = User::factory()->create();

    $this->actingAs($user)
        ->postJson(route('memos.transcribe', $user->currentTeam), [
            'audio' => UploadedFile::fake()->create('memo.pdf', 100, 'application/pdf'),
        ])
        ->assertUnprocessable();
});
