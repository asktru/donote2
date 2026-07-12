<?php

use App\Models\User;

test('the web mcp endpoint rejects unauthenticated requests', function () {
    $this->postJson('/mcp/donote', [
        'jsonrpc' => '2.0',
        'id' => 1,
        'method' => 'initialize',
        'params' => [
            'protocolVersion' => '2025-03-26',
            'capabilities' => [],
            'clientInfo' => ['name' => 'pest', 'version' => '1.0'],
        ],
    ])->assertUnauthorized();
});

test('a sanctum token completes the mcp handshake as its user', function () {
    $user = User::factory()->create();
    $token = $user->createToken('claude-mcp')->plainTextToken;

    $this->withHeader('Authorization', "Bearer {$token}")
        ->withHeader('Accept', 'application/json, text/event-stream')
        ->postJson('/mcp/donote', [
            'jsonrpc' => '2.0',
            'id' => 1,
            'method' => 'initialize',
            'params' => [
                'protocolVersion' => '2025-03-26',
                'capabilities' => [],
                'clientInfo' => ['name' => 'pest', 'version' => '1.0'],
            ],
        ])
        ->assertSuccessful()
        ->assertJsonPath('result.serverInfo.name', 'Donote');
});

test('mcp tokens can be minted from the console', function () {
    $user = User::factory()->create(['email' => 'mint@example.com']);

    $this->artisan('mcp:token', ['email' => 'mint@example.com'])
        ->assertSuccessful();

    expect($user->tokens()->count())->toBe(1);
});
