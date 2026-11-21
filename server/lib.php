<?php
/*
 * Shared code for the small PHP backend (served by php-fpm behind Caddy on xuexi.nl).
 *
 *   /auth/login     → Google sign-in        /api/me        → who is signed in
 *   /auth/google/callback → from Google     /api/progress  → GET / POST the practice progress
 *   /auth/logout
 *
 * Sessions live in Redis (see server/php/php.ini); users and progress in SQLite at DATABASE_PATH,
 * which Litestream streams to Object Storage. Signed-out visitors never reach this code: the site
 * then keeps everything in the browser's localStorage.
 */
declare(strict_types=1);

/** localStorage keys that follow the account (same list as nav.js). */
const SYNC_KEYS = [
    'chinesePractice.mistakes.v1',
    'chinesePractice.chapters.v1',
    'quizShowPinyin',
    'journalTrack',
];
const MAX_VALUE_BYTES = 2_000_000;
const SESSION_NAME = 'xuexi_sid';
const SESSION_DAYS = 90;

function env(string $key): string
{
    $v = getenv($key);
    if ($v === false || $v === '') {
        error_log("Missing environment variable $key");
        http_response_code(500);
        exit('Server is not configured.');
    }
    return $v;
}

/** Public address of the site, e.g. https://xuexi.nl (never taken from the Host header). */
function base_url(): string
{
    return rtrim(env('BASE_URL'), '/');
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name(SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => SESSION_DAYS * 86400,
        'path' => '/',
        'secure' => str_starts_with(base_url(), 'https://'),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.gc_maxlifetime', (string)(SESSION_DAYS * 86400));
    session_start();
}

/** Only touch Redis for visitors that already have a session cookie. */
function resume_session(): void
{
    if (isset($_COOKIE[SESSION_NAME])) start_session();
}

function current_user(): ?array
{
    return $_SESSION['user'] ?? null;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO('sqlite:' . env('DATABASE_PATH'));
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    // WAL is what Litestream replicates; busy_timeout lets concurrent requests wait instead of failing.
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec('PRAGMA synchronous = NORMAL');
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('CREATE TABLE IF NOT EXISTS users (
        id         TEXT PRIMARY KEY,           -- Google "sub"
        email      TEXT NOT NULL,
        name       TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login TEXT
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS progress (
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key        TEXT NOT NULL,              -- one of SYNC_KEYS
        value      TEXT NOT NULL,              -- the localStorage value, as is
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, key)
    )');
    return $pdo;
}

function json_out(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function redirect(string $url): never
{
    header('Cache-Control: no-store');
    header('Location: ' . $url, true, 302);
    exit;
}

/** A path on this site to go back to after signing in or out; anything else becomes "/". */
function safe_return(?string $r): string
{
    if (!is_string($r) || $r === '' || $r[0] !== '/' || str_starts_with($r, '//') || str_contains($r, '\\')
        || preg_match('/[\x00-\x1f]/', $r)) {
        return '/';
    }
    return $r;
}

function base64url_decode(string $s): string
{
    return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)) ?: '';
}

function error_page(string $message, string $back = '/'): never
{
    http_response_code(400);
    header('Content-Type: text/html; charset=utf-8');
    $m = htmlspecialchars($message);
    $b = htmlspecialchars($back);
    echo "<!DOCTYPE html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
        . "<title>Sign-in</title><body style='font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem'>"
        . "<p>$m</p><p><a href='$b'>Back to the site</a></p>";
    exit;
}
