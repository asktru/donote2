<?php

use App\Mcp\Servers\DonoteServer;
use Laravel\Mcp\Facades\Mcp;

// Local (stdio) server for Claude Desktop / Claude Code on this machine.
// The acting workspace is chosen via DONOTE_MCP_USER_EMAIL (config/donote.php).
Mcp::local('donote', DonoteServer::class);

// Remote access for AI clients over HTTP can be enabled later by installing
// Laravel Sanctum (or Passport for OAuth) and uncommenting:
//
// Mcp::web('/mcp/donote', DonoteServer::class)->middleware('auth:sanctum');
