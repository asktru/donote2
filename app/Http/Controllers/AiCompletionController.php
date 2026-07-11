<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class AiCompletionController extends Controller
{
    /**
     * Apply a free-form instruction to a piece of note/transcript text
     * and return only the transformed text.
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'prompt' => ['required', 'string', 'max:4000'],
            'text' => ['required', 'string', 'max:400000'],
        ]);

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
                    [
                        'role' => 'system',
                        'content' => 'You transform text inside a markdown note-taking app. '
                            .'Apply the user instruction to the provided text and return ONLY the result — '
                            .'no preamble, no explanations, no code fences. Preserve the language(s) of the '
                            .'text unless the instruction says otherwise. Markdown is allowed.',
                    ],
                    [
                        'role' => 'user',
                        'content' => "Instruction:\n{$validated['prompt']}\n\nText:\n{$validated['text']}",
                    ],
                ],
            ]);

        if ($response->failed()) {
            return response()->json([
                'message' => 'AI request failed: '.($response->json('error.message') ?? 'provider error'),
            ], 502);
        }

        $text = $response->json('choices.0.message.content');

        return response()->json([
            'text' => is_string($text) ? trim($text) : '',
        ]);
    }
}
