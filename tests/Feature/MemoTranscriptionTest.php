<?php

use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;

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
        ->assertStatus(502)
        ->assertJsonPath('message', 'Transcription failed: rate limited');
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
