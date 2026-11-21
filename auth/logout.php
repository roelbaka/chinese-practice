<?php
// Sign out and go back to ?return=/path (the page clears its synced progress before coming here).
require __DIR__ . '/../server/lib.php';

resume_session();
if (session_status() === PHP_SESSION_ACTIVE) {
    $_SESSION = [];
    $p = session_get_cookie_params();
    setcookie(session_name(), '', [
        'expires' => time() - 3600, 'path' => $p['path'], 'secure' => $p['secure'],
        'httponly' => true, 'samesite' => 'Lax',
    ]);
    session_destroy();
}
redirect(safe_return($_GET['return'] ?? '/'));
