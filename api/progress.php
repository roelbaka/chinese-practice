<?php
/*
 * The signed-in user's progress, stored per localStorage key.
 *   GET  → {"chinesePractice.mistakes.v1": "<json string>", …}
 *   POST {"key": "value", "other": null} → saves the values; null deletes the key.
 */
require __DIR__ . '/../server/lib.php';

resume_session();
$user = current_user();
if (!$user) json_out(['error' => 'not signed in'], 401);
session_write_close(); // don't hold the session lock while talking to SQLite

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $st = db()->prepare('SELECT key, value FROM progress WHERE user_id = ?');
    $st->execute([$user['id']]);
    $out = new stdClass();
    foreach ($st as $row) $out->{$row['key']} = $row['value'];
    json_out($out);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(['error' => 'method not allowed'], 405);

// Same-site only: the cookie is SameSite=Lax, and a browser always sends Origin on a POST.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== base_url()) json_out(['error' => 'bad origin'], 403);

$raw = file_get_contents('php://input', false, null, 0, 4 * MAX_VALUE_BYTES + 1);
$body = json_decode((string)$raw, true);
if (!is_array($body) || array_is_list($body) && $body !== []) json_out(['error' => 'expected a JSON object'], 400);

$pdo = db();
$put = $pdo->prepare('INSERT INTO progress (user_id, key, value, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
$del = $pdo->prepare('DELETE FROM progress WHERE user_id = ? AND key = ?');

$pdo->beginTransaction();
foreach ($body as $key => $value) {
    if (!in_array($key, SYNC_KEYS, true)) continue;
    if ($value === null) {
        $del->execute([$user['id'], $key]);
    } elseif (is_string($value) && strlen($value) <= MAX_VALUE_BYTES) {
        $put->execute([$user['id'], $key, $value]);
    }
}
$pdo->commit();
json_out(['ok' => true]);
