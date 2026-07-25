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

        try {
            $response = Http::withToken($key)
                ->connectTimeout(10)
                // Stay comfortably under the web server's gateway timeout
                // (Forge nginx defaults to 60s) so a slow provider produces a
                // clean JSON error the client can show and retry — rather than
                // php-fpm being killed and nginx returning an opaque 502.
                ->timeout(45)
                ->attach('file', $contents, $audio->getClientOriginalName() ?: 'memo.webm')
                ->post('https://api.openai.com/v1/audio/transcriptions', [
                    'model' => is_string($model) ? $model : 'gpt-4o-transcribe',
                ]);
        } catch (\Throwable $exception) {
            // Any failure reaching or using the provider (timeout, dropped
            // connection, transport error). The memo stays queued locally, so
            // return a clear, retryable message with a NON-gateway status —
            // 502/504 can be swallowed by a proxy's own error page, which is
            // exactly what turned a real reason into an opaque "502 Upload
            // failed" for the user.
            report($exception);

            return response()->json([
                'message' => 'Transcription could not reach the provider — it will retry.',
            ], 503);
        }

        if ($response->failed()) {
            // A provider-side error (rate limit, bad request, 5xx). Use 422 so
            // the JSON message reaches the client instead of being hidden
            // behind a gateway error page; the client shows it and retries.
            return response()->json([
                'message' => 'Transcription failed: '.($response->json('error.message') ?? 'provider error'),
            ], 422);
        }

        $text = $response->json('text');

        return response()->json([
            'text' => is_string($text) ? trim($text) : '',
        ]);
    }
}
