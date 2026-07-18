<?php

namespace App\Http\Controllers;

use Illuminate\Http\Client\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class AiCompletionController extends Controller
{
    private const SYSTEM_PROMPT = 'You transform text inside a markdown note-taking app. '
        .'Apply the user instruction to the provided text and return ONLY the result — '
        .'no preamble, no explanations, no code fences. Preserve the language(s) of the '
        .'text unless the instruction says otherwise. Markdown is allowed.';

    /**
     * Apply a free-form instruction to a piece of note/transcript text
     * and return only the transformed text, using the engine the user
     * picked in Settings → Integrations (OpenAI or Claude).
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'prompt' => ['required', 'string', 'max:4000'],
            'text' => ['required', 'string', 'max:400000'],
        ]);

        $message = "Instruction:\n{$validated['prompt']}\n\nText:\n{$validated['text']}";

        return $request->user()?->ai_engine === 'claude'
            ? $this->completeWithClaude($message)
            : $this->completeWithOpenAi($message);
    }

    private function completeWithOpenAi(string $message): JsonResponse
    {
        $key = config('services.openai.key');

        if (! is_string($key) || $key === '') {
            return response()->json([
                'message' => 'AI prompts are not configured — set OPENAI_API_KEY in .env.',
            ], 503);
        }

        $model = config('services.openai.ai_model');

        $response = Http::withToken($key)
            ->timeout(120)
            ->post('https://api.openai.com/v1/chat/completions', [
                'model' => is_string($model) ? $model : 'gpt-4o-mini',
                'messages' => [
                    ['role' => 'system', 'content' => self::SYSTEM_PROMPT],
                    ['role' => 'user', 'content' => $message],
                ],
            ]);

        if ($response->failed()) {
            return $this->providerError($response, 'error.message');
        }

        $text = $response->json('choices.0.message.content');

        return response()->json([
            'text' => is_string($text) ? trim($text) : '',
        ]);
    }

    private function completeWithClaude(string $message): JsonResponse
    {
        $key = config('services.anthropic.key');

        if (! is_string($key) || $key === '') {
            return response()->json([
                'message' => 'Claude is not configured — set ANTHROPIC_API_KEY in .env or switch back to OpenAI in Settings → Integrations.',
            ], 503);
        }

        $model = config('services.anthropic.ai_model');

        $response = Http::withHeaders([
            'x-api-key' => $key,
            'anthropic-version' => '2023-06-01',
        ])
            ->timeout(120)
            ->post('https://api.anthropic.com/v1/messages', [
                'model' => is_string($model) ? $model : 'claude-haiku-4-5',
                'max_tokens' => 16000,
                'system' => self::SYSTEM_PROMPT,
                'messages' => [
                    ['role' => 'user', 'content' => $message],
                ],
            ]);

        if ($response->failed()) {
            return $this->providerError($response, 'error.message');
        }

        $text = $response->json('content.0.text');

        return response()->json([
            'text' => is_string($text) ? trim($text) : '',
        ]);
    }

    private function providerError(Response $response, string $messagePath): JsonResponse
    {
        return response()->json([
            'message' => 'AI request failed: '.($response->json($messagePath) ?? 'provider error'),
        ], 502);
    }
}
