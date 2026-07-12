<?php

use App\Mcp\Servers\DonoteServer;
use Laravel\Mcp\Facades\Mcp;

// Local (stdio) server for Claude Desktop / Claude Code on this machine.
// The acting workspace is chosen via DONOTE_MCP_USER_EMAIL (config/donote.php).
Mcp::local('donote', DonoteServer::class);

// Remote (HTTP) server for production — authenticate with a Sanctum
// personal access token minted via `php artisan mcp:token {email}`:
//   Authorization: Bearer <token>
// This is a plain Laravel route: no daemon, nothing to restart on deploy.
Mcp::web('/mcp/donote', DonoteServer::class)->middleware('auth:sanctum');
