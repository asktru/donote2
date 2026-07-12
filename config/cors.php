<?php

/*
 * The v1 API is called by third-party clients that may run in a browser
 * context (the KnowTabs browser). Auth is a bearer token — never a
 * cookie — so any origin is safe to allow and credentials stay off.
 */
return [

    'paths' => ['v1/*'],

    'allowed_methods' => ['*'],

    'allowed_origins' => ['*'],

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 3600,

    'supports_credentials' => false,

];
