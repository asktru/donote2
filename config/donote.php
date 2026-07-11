<?php

return [

    /*
    |--------------------------------------------------------------------------
    | MCP Workspace Account
    |--------------------------------------------------------------------------
    |
    | The local (stdio) MCP transport runs without HTTP authentication, so
    | this email decides whose workspace the AI client operates on. Web MCP
    | transports authenticate normally and ignore this value. When empty,
    | the first user in the database is used (single-user dev convenience).
    |
    */

    'mcp_user_email' => env('DONOTE_MCP_USER_EMAIL'),

];
