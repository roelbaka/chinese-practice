<?php
// Google sends the visitor back here with ?code=…&state=…
require __DIR__ . '/../../server/lib.php';

start_session();
$return = $_SESSION['oauth_return'] ?? '/';
$state = $_SESSION['oauth_state'] ?? null;
unset($_SESSION['oauth_state'], $_SESSION['oauth_return']);

if (!$state || !hash_equals($state, (string)($_GET['state'] ?? ''))) {
    error_page('That sign-in link has expired. Please try again.', $return);
}
if (isset($_GET['error']) || empty($_GET['code'])) {
    redirect($return); // cancelled on Google's side
}

// Exchange the code for tokens (server to server, so the ID token can be trusted as is).
$ctx = stream_context_create(['http' => [
    'method' => 'POST',
    'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
    'content' => http_build_query([
        'code' => (string)$_GET['code'],
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect_uri' => base_url() . '/auth/google/callback',
        'grant_type' => 'authorization_code',
    ]),
    'timeout' => 10,
    'ignore_errors' => true,
]]);
$tokens = json_decode((string)@file_get_contents('https://oauth2.googleapis.com/token', false, $ctx), true);
$idToken = is_array($tokens) ? ($tokens['id_token'] ?? null) : null;
if (!is_string($idToken) || substr_count($idToken, '.') !== 2) {
    error_log('Google token exchange failed: ' . json_encode($tokens['error'] ?? 'no response'));
    error_page('Signing in with Google did not work. Please try again.', $return);
}

$claims = json_decode(base64url_decode(explode('.', $idToken)[1]), true);
$ok = is_array($claims)
    && ($claims['aud'] ?? null) === env('GOOGLE_CLIENT_ID')
    && in_array($claims['iss'] ?? null, ['https://accounts.google.com', 'accounts.google.com'], true)
    && ($claims['exp'] ?? 0) > time()
    && !empty($claims['sub'])
    && !empty($claims['email'])
    && ($claims['email_verified'] ?? false) === true;
if (!$ok) {
    error_page('Google did not confirm this account. Please try again.', $return);
}

$user = [
    'id' => (string)$claims['sub'],
    'email' => (string)$claims['email'],
    'name' => (string)($claims['name'] ?? ''),
];
db()->prepare('INSERT INTO users (id, email, name, last_login) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, last_login = excluded.last_login')
    ->execute([$user['id'], $user['email'], $user['name']]);

session_regenerate_id(true);
$_SESSION['user'] = $user;
redirect($return);
