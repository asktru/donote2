<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

class MintBluedotUrl extends Command
{
    protected $signature = 'bluedot:url {email : Email of the account the meetings land in}';

    protected $description = 'Mint the Bluedot webhook URL for a user (summaries land in their Meetings folder)';

    public function handle(): int
    {
        $email = strtolower((string) $this->argument('email'));
        $user = User::query()->whereRaw('LOWER(email) = ?', [$email])->first();

        if ($user === null) {
            $this->error("No user with email {$email}.");

            return self::FAILURE;
        }

        $token = $user->createToken('bluedot-webhook')->plainTextToken;
        $url = rtrim((string) config('app.url'), '/').'/webhooks/bluedot?token='.$token;

        $this->info("Bluedot webhook URL for {$user->email} (shown once):");
        $this->line($url);
        $this->newLine();
        $this->line('Paste this as the webhook URL in Bluedot. Summaries will be');
        $this->line('stored in the Meetings folder and linked from the daily note.');

        return self::SUCCESS;
    }
}
