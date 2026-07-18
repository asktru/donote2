<?php

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Models\GoogleAccount;
use App\Models\Team;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class IntegrationsController extends Controller
{
    /**
     * Show the integrations settings page.
     */
    public function edit(Request $request): Response
    {
        $user = $request->user();

        return Inertia::render('settings/Integrations', [
            'googleAccounts' => $user->googleAccounts()->get()
                ->map(fn (GoogleAccount $account): array => [
                    'id' => $account->id,
                    'email' => $account->email,
                    'calendars' => $account->calendars ?? [],
                ]),
            'googleConfigured' => (bool) config('services.google.client_id'),
            'teams' => $user->teams()->orderBy('name')->get()
                ->map(fn (Team $team): array => [
                    'id' => $team->id,
                    'name' => $team->name,
                ])->values(),
            'bluedotWebhooks' => $this->bluedotWebhooks($user),
            'aiEngine' => $user->ai_engine,
            'openaiConfigured' => (bool) config('services.openai.key'),
            'claudeConfigured' => (bool) config('services.anthropic.key'),
        ]);
    }

    /**
     * Switch the engine that powers AI prompts for this user.
     */
    public function updateAi(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'ai_engine' => ['required', Rule::in(['openai', 'claude'])],
        ]);

        $user = $request->user();
        $user->ai_engine = $validated['ai_engine'];
        $user->save();

        return back();
    }

    /**
     * Mint a Bluedot webhook URL bound to a specific team. The plaintext URL
     * is only available now, so it's flashed back for a one-time reveal.
     */
    public function storeBluedot(Request $request): RedirectResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'team_id' => [
                'required',
                'integer',
                Rule::exists('team_members', 'team_id')->where('user_id', $user->id),
            ],
        ]);

        /** @var Team $team */
        $team = Team::findOrFail($validated['team_id']);

        $token = $user->createToken(
            'bluedot:'.$team->slug,
            ['bluedot', 'team:'.$team->id],
        )->plainTextToken;

        $url = rtrim((string) config('app.url'), '/').'/webhooks/bluedot?token='.$token;

        return back()
            ->with('bluedotUrl', $url)
            ->with('bluedotTeam', $team->name);
    }

    /**
     * Revoke a Bluedot webhook token owned by the current user.
     */
    public function destroyBluedot(Request $request, int $token): RedirectResponse
    {
        $request->user()->tokens()
            ->where('id', $token)
            ->where('name', 'like', 'bluedot:%')
            ->delete();

        return back();
    }

    /**
     * The user's Bluedot webhook tokens, newest first, annotated with the
     * team each one files summaries into.
     *
     * @return list<array{id: int, team: string|null, createdAt: string|null, lastUsedAt: string|null}>
     */
    private function bluedotWebhooks(User $user): array
    {
        $teamNames = $user->teams()->pluck('name', 'teams.id');

        $tokens = $user->tokens()
            ->where('name', 'like', 'bluedot:%')
            ->latest()
            ->get();

        $webhooks = [];

        foreach ($tokens as $token) {
            $teamId = null;

            foreach ((array) ($token->abilities ?? []) as $ability) {
                if (is_string($ability) && str_starts_with($ability, 'team:')) {
                    $teamId = (int) substr($ability, 5);
                    break;
                }
            }

            $webhooks[] = [
                'id' => $token->id,
                'team' => $teamId !== null && isset($teamNames[$teamId])
                    ? (string) $teamNames[$teamId]
                    : null,
                'createdAt' => $token->created_at?->toIso8601String(),
                'lastUsedAt' => $token->last_used_at?->toIso8601String(),
            ];
        }

        return $webhooks;
    }
}
