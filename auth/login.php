<?php
// Start Google sign-in. ?return=/path/on/this/site brings you back there afterwards.
require __DIR__ . '/../server/lib.php';

start_session();
$state = bin2hex(random_bytes(16));
$_SESSION['oauth_state'] = $state;
$_SESSION['oauth_return'] = safe_return($_GET['return'] ?? '/');

redirect('https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
    'client_id' => env('GOOGLE_CLIENT_ID'),
    'redirect_uri' => base_url() . '/auth/google/callback',
    'response_type' => 'code',
    'scope' => 'openid email profile',
    'state' => $state,
    'prompt' => 'select_account',
]));
