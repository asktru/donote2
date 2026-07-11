<?php

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Models\GoogleAccount;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class IntegrationsController extends Controller
{
    /**
     * Show the integrations settings page.
     */
    public function edit(Request $request): Response
    {
        return Inertia::render('settings/Integrations', [
            'googleAccounts' => $request->user()->googleAccounts()->get()
                ->map(fn (GoogleAccount $account): array => [
                    'id' => $account->id,
                    'email' => $account->email,
                    'calendars' => $account->calendars ?? [],
                ]),
            'googleConfigured' => (bool) config('services.google.client_id'),
        ]);
    }
}
