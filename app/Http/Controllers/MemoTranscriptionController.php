<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;

class MemoTranscriptionController extends Controller
{
    /**
     * Transcribe an uploaded audio memo. Language is auto-detected so
     * mixed-language recordings (EN/FR/UK/RU) pass through unpinned.
     */
    public function __invoke(Request $request): JsonResponse
    {
        $request->validate([
            'audio' => ['required', 'file', 'max:25600', 'mimetypes:audio/webm,video/webm,audio/ogg,audio/mpeg,audio/mp4,audio/x-m4a,video/mp4,audio/aac,audio/wav,audio/x-wav,audio/flac'],
        ]);

        $key = config('services.openai.key');

        if (! is_string($key) || $key === '') {
            return response()->json([
                'message' => 'Transcription is not configured — set OPENAI_API_KEY in .env.',
            ], 503);
        }

        $audio = $request->file('audio');

        if (! $audio instanceof UploadedFile) {
            abort(422);
        }

        $model = config('services.openai.transcription_model');
        $contents = $audio->get();

        if ($contents === false) {
            abort(422, 'Could not read the uploaded audio.');
        }

        $response = Http::withToken($key)
            ->timeout(120)
            ->attach('file', $contents, $audio->getClientOriginalName() ?: 'memo.webm')
            ->post('https://api.openai.com/v1/audio/transcriptions', [
                'model' => is_string($model) ? $model : 'gpt-4o-transcribe',
            ]);

        if ($response->failed()) {
            return response()->json([
                'message' => 'Transcription failed: '.($response->json('error.message') ?? 'provider error'),
            ], 502);
        }

        $text = $response->json('text');

        return response()->json([
            'text' => is_string($text) ? trim($text) : '',
        ]);
    }
}
