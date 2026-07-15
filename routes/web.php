<?php

use App\Http\Controllers\AiCompletionController;
use App\Http\Controllers\AttachmentController;
use App\Http\Controllers\CalendarController;
use App\Http\Controllers\CalendarEventController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\GoogleCalendarController;
use App\Http\Controllers\MemoTranscriptionController;
use App\Http\Controllers\NotesAppController;
use App\Http\Controllers\NoteSearchController;
use App\Http\Controllers\NoteShareController;
use App\Http\Controllers\NoteSyncController;
use App\Http\Controllers\OpenNoteController;
use App\Http\Controllers\Teams\TeamInvitationController;
use App\Http\Middleware\EnsureTeamMembership;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', function (Request $request) {
    $user = $request->user();

    if ($user !== null) {
        $team = $user->currentTeam ?? $user->personalTeam();

        if ($team !== null) {
            return redirect()->route('notes', ['current_team' => $team->slug]);
        }
    }

    return Inertia::render('Welcome');
})->name('home');

// Stable per-note deep link: donote://note/<id> and shared web URLs both
// resolve through here into the owning team's notes app. Registered before
// the {current_team} wildcard so "n" is never taken for a team slug.
Route::get('n/{note}', OpenNoteController::class)
    ->middleware(['auth', 'verified'])
    ->name('notes.open');

Route::prefix('{current_team}')
    ->middleware(['auth', 'verified', EnsureTeamMembership::class])
    ->group(function () {
        Route::get('dashboard', DashboardController::class)->name('dashboard');
        Route::get('notes', NotesAppController::class)->name('notes');
        Route::get('calendar', CalendarController::class)->name('calendar');
    });

Route::prefix('api/{current_team}')
    ->middleware(['auth', 'verified', EnsureTeamMembership::class])
    ->group(function () {
        Route::get('notes/sync', [NoteSyncController::class, 'index'])->name('notes.sync.pull');
        Route::post('notes/sync', [NoteSyncController::class, 'store'])->name('notes.sync.push');
        Route::get('notes/visible-ids', [NoteSyncController::class, 'visibleIds'])->name('notes.visible-ids');
        Route::get('notes/sync-stats', [NoteSyncController::class, 'stats'])->name('notes.sync.stats');
        Route::get('notes/{note}/share', [NoteShareController::class, 'show'])->name('notes.share.show');
        Route::put('notes/{note}/share', [NoteShareController::class, 'update'])->name('notes.share.update');
        Route::get('search', NoteSearchController::class)->name('notes.search');
        Route::post('attachments', [AttachmentController::class, 'store'])->name('attachments.store');
        Route::post('memos/transcriptions', MemoTranscriptionController::class)->name('memos.transcribe');
        Route::post('ai/completions', AiCompletionController::class)->name('ai.complete');
        Route::get('attachments/{attachment}', [AttachmentController::class, 'show'])->name('attachments.show');
    });

Route::middleware(['auth'])->group(function () {
    Route::get('invitations/{invitation}/accept', [TeamInvitationController::class, 'accept'])->name('invitations.accept');
    Route::delete('invitations/{invitation}', [TeamInvitationController::class, 'decline'])->name('invitations.decline');
});

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('google/redirect', [GoogleCalendarController::class, 'redirect'])->name('google.redirect');
    Route::get('google/callback', [GoogleCalendarController::class, 'callback'])->name('google.callback');
    Route::get('api/google/accounts', [GoogleCalendarController::class, 'index'])->name('google.accounts');
    Route::patch('api/google/accounts/{googleAccount}', [GoogleCalendarController::class, 'update'])->name('google.accounts.update');
    Route::delete('api/google/accounts/{googleAccount}', [GoogleCalendarController::class, 'destroy'])->name('google.accounts.destroy');
    Route::get('api/google/events', [GoogleCalendarController::class, 'events'])->name('google.events');

    // Calendar event write + collaboration (Google full-access scope).
    Route::post('api/google/events', [CalendarEventController::class, 'store'])->name('google.events.store');
    Route::patch('api/google/events', [CalendarEventController::class, 'update'])->name('google.events.update');
    Route::delete('api/google/events', [CalendarEventController::class, 'destroy'])->name('google.events.destroy');
    Route::post('api/google/freebusy', [CalendarEventController::class, 'freeBusy'])->name('google.freebusy');
    Route::get('api/google/overlay', [CalendarEventController::class, 'overlay'])->name('google.overlay');
    Route::get('api/google/directory', [CalendarEventController::class, 'directory'])->name('google.directory');
});

require __DIR__.'/settings.php';
