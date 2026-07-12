<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

class MintMcpToken extends Command
{
    protected $signature = 'mcp:token {email : Email of the user the token acts as}';

    protected $description = 'Mint a Sanctum token for the web MCP endpoint (/mcp/donote)';

    public function handle(): int
    {
        $email = strtolower((string) $this->argument('email'));
        $user = User::query()->whereRaw('LOWER(email) = ?', [$email])->first();

        if ($user === null) {
            $this->error("No user with email {$email}.");

            return self::FAILURE;
        }

        $token = $user->createToken('claude-mcp')->plainTextToken;

        $this->info("MCP token for {$user->email} (shown once — store it now):");
        $this->line($token);
        $this->newLine();
        $this->line('Connect Claude Code with:');
        $this->line('  claude mcp add --transport http donote-prod '.config('app.url').'/mcp/donote --header "Authorization: Bearer '.$token.'"');

        return self::SUCCESS;
    }
}
