<?php

namespace App\Console\Commands;

use App\Models\Team;
use App\Models\User;
use Illuminate\Console\Command;

class MintBluedotUrl extends Command
{
    protected $signature = 'bluedot:url
        {email : Email of the account the meetings land in}
        {--team= : Slug of the team to file summaries into (defaults to the current team)}';

    protected $description = 'Mint the Bluedot webhook URL for a user (summaries land in the chosen team\'s Meetings folder)';

    public function handle(): int
    {
        $email = strtolower((string) $this->argument('email'));
        $user = User::query()->whereRaw('LOWER(email) = ?', [$email])->first();

        if ($user === null) {
            $this->error("No user with email {$email}.");

            return self::FAILURE;
        }

        $slug = $this->option('team');
        $team = is_string($slug) && $slug !== ''
            ? $user->teams()->where('teams.slug', $slug)->first()
            : $user->currentTeam;

        if (! $team instanceof Team) {
            $this->error(is_string($slug) && $slug !== ''
                ? "{$user->email} does not belong to a team with slug {$slug}."
                : "{$user->email} has no current team — pass --team=<slug>.");

            return self::FAILURE;
        }

        $token = $user->createToken(
            'bluedot:'.$team->slug,
            ['bluedot', 'team:'.$team->id],
        )->plainTextToken;
        $url = rtrim((string) config('app.url'), '/').'/webhooks/bluedot?token='.$token;

        $this->info("Bluedot webhook URL for {$user->email} → team “{$team->name}” (shown once):");
        $this->line($url);
        $this->newLine();
        $this->line('Paste this as the webhook URL in Bluedot. Summaries will be');
        $this->line("stored in the {$team->name} Meetings folder and linked from the daily note.");

        return self::SUCCESS;
    }
}
