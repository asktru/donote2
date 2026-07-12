<?php

use App\Http\Controllers\Api\V1\AttachmentController;
use App\Http\Controllers\Api\V1\DailyNoteController;
use App\Http\Controllers\Api\V1\NoteController;
use Illuminate\Support\Facades\Route;

/*
 * Public v1 API for third-party clients (KnowTabs "send to Donote", …).
 * Stateless: personal Sanctum tokens (php artisan mcp:token), no CSRF,
 * CORS open for browser-context callers (config/cors.php).
 */
Route::middleware(['auth:sanctum', 'throttle:60,1'])->group(function () {
    Route::post('notes', [NoteController::class, 'store'])->name('api.v1.notes.store');
    Route::get('notes', [NoteController::class, 'index'])->name('api.v1.notes.index');
    Route::post('daily-notes/{dateKey}/append', [DailyNoteController::class, 'append'])->name('api.v1.daily-notes.append');
    Route::post('attachments', AttachmentController::class)->name('api.v1.attachments.store');
});
