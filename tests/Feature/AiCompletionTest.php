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

test('ai completion uses claude when the user picked it', function () {
    config(['services.anthropic.key' => 'sk-ant-test']);

    Http::fake([
        'api.anthropic.com/v1/messages' => Http::response([
            'content' => [
                ['type' => 'text', 'text' => '  - Action: send the deck  '],
            ],
        ]),
    ]);

    $user = User::factory()->create(['ai_engine' => 'claude']);

    $this->actingAs($user)
        ->postJson(route('ai.complete', $user->currentTeam), [
            'prompt' => 'Extract action items',
            'text' => 'We agreed to send the deck.',
        ])
        ->assertSuccessful()
        ->assertJsonPath('text', '- Action: send the deck');

    Http::assertSent(function ($request) {
        return str_contains($request->url(), 'api.anthropic.com/v1/messages')
            && $request->hasHeader('x-api-key', 'sk-ant-test')
            && $request->hasHeader('anthropic-version', '2023-06-01')
            && str_contains($request->body(), 'Extract action items');
    });
});

test('ai completion reports missing claude configuration', function () {
    config(['services.anthropic.key' => null]);

    $user = User::factory()->create(['ai_engine' => 'claude']);

    $this->actingAs($user)
        ->postJson(route('ai.complete', $user->currentTeam), [
            'prompt' => 'Summarize',
            'text' => 'Some text',
        ])
        ->assertServiceUnavailable();
});

test('ai completion surfaces claude provider failures', function () {
    config(['services.anthropic.key' => 'sk-ant-test']);

    Http::fake([
        'api.anthropic.com/*' => Http::response([
            'error' => ['type' => 'overloaded_error', 'message' => 'Overloaded'],
        ], 529),
    ]);

    $user = User::factory()->create(['ai_engine' => 'claude']);

    $this->actingAs($user)
        ->postJson(route('ai.complete', $user->currentTeam), [
            'prompt' => 'Summarize',
            'text' => 'Some text',
        ])
        ->assertStatus(502)
        ->assertJsonPath('message', 'AI request failed: Overloaded');
});

test('the ai engine can be switched in settings', function () {
    $user = User::factory()->create();

    expect($user->ai_engine)->toBe('openai');

    $this->actingAs($user)
        ->patch(route('integrations.ai.update'), ['ai_engine' => 'claude'])
        ->assertRedirect();

    expect($user->refresh()->ai_engine)->toBe('claude');

    $this->actingAs($user)
        ->patch(route('integrations.ai.update'), ['ai_engine' => 'gemini'])
        ->assertSessionHasErrors('ai_engine');

    expect($user->refresh()->ai_engine)->toBe('claude');
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
