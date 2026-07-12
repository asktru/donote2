<?php

use App\Http\Controllers\Webhooks\BluedotController;
use Illuminate\Support\Facades\Route;

/*
 * Inbound webhooks. Each carries its own personal token (?token= or a
 * Bearer header) identifying the recipient account; there is no session.
 * Throttled to absorb retries without hammering the queue.
 */
Route::middleware('throttle:60,1')->group(function () {
    Route::post('bluedot', BluedotController::class)->name('webhooks.bluedot');
});
