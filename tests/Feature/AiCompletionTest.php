<?php

use App\Models\User;
use Illuminate\Support\Facades\Http;

test('ai completion returns the transformed text', function () {
    config(['services.openai.key' => 'sk-test']);

    Http::fake([
        'api.openai.com/v1/chat/completions' => Http::response([
            'choices' => [
                ['message' => ['content' => "  - Action: send the deck\n- Action: book the room  "]],
            ],
        ]),
    ]);

    $user = User::factory()->create();

    $this->actingAs($user)
        ->postJson(route('ai.complete', $user->currentTeam), [
            'prompt' => 'Extract action items',
            'text' => 'We agreed to send the deck and book the room.',
        ])
        ->assertSuccessful()
        ->assertJsonPath('text', "- Action: send the deck\n- Action: book the room");

    Http::assertSent(function ($request) {
        return str_contains($request->url(), 'chat/completions')
            && str_contains($request->body(), 'Extract action items');
    });
});

test('ai completion reports missing configuration', function () {
    config(['services.openai.key' => null]);

    $user = User::factory()->create();

    $this->actingAs($user)
        ->postJson(route('ai.complete', $user->currentTeam), [
            'prompt' => 'Summarize',
            'text' => 'Some text',
        ])
        ->assertServiceUnavailable();
});

test('ai completion surfaces provider failures', function () {
    config(['services.openai.key' => 'sk-test']);

    Http::fake([
        'api.openai.com/*' => Http::response(['error' => ['message' => 'overloaded']], 500),
    ]);

    $user = User::factory()->create();

    $this->actingAs($user)
        ->postJson(route('ai.complete', $user->currentTeam), [
            'prompt' => 'Summarize',
            'text' => 'Some text',
        ])
        ->assertStatus(502)
        ->assertJsonPath('message', 'AI request failed: overloaded');
});

test('ai completion validates input', function () {
    config(['services.openai.key' => 'sk-test']);

    $user = User::factory()->create();

    $this->actingAs($user)
        ->postJson(route('ai.complete', $user->currentTeam), [
            'prompt' => '',
            'text' => 'Some text',
        ])
        ->assertUnprocessable();
});
