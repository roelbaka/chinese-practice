<?php
// /admin/admins: who has admin access; add someone by email (also before they ever signed in) or remove.
require __DIR__ . '/../server/admin.php';

$me = require_admin();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_ok()) { http_response_code(400); page('Expired', '<p>The form expired. <a href="/admin/admins">Reload</a> and try again.</p>'); exit; }
    $action = (string)($_POST['action'] ?? '');
    $msg = 'invalid';
    if ($action === 'add') {
        $email = trim((string)($_POST['email'] ?? ''));
        if (filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $st = db()->prepare('INSERT OR IGNORE INTO admins (email_hash) VALUES (?)');
            $st->execute([email_hash($email)]);
            $msg = $st->rowCount() ? 'added' : 'already';
        }
    } elseif ($action === 'remove') {
        $hash = (string)($_POST['hash'] ?? '');
        if ($hash === email_hash($me['email'])) $msg = 'self';
        elseif (preg_match('/^[0-9a-f]{64}$/', $hash)) {
            db()->prepare('DELETE FROM admins WHERE email_hash = ?')->execute([$hash]);
            $msg = 'removed';
        }
    }
    redirect('/admin/admins?done=' . $msg);
}

$flash = [
    'added' => 'Admin added. They get access the next time they sign in with that Google account.',
    'already' => 'That account is already an admin.',
    'removed' => 'Admin removed.',
    'self' => "You can't remove your own admin access here.",
    'invalid' => 'That is not a valid email address.',
][$_GET['done'] ?? ''] ?? '';

// Only hashes are stored: put a name to the ones that belong to someone who signed in.
$known = [];
foreach (db()->query('SELECT id, email, name, last_login FROM users') as $u) $known[email_hash($u['email'])] = $u;
$rows = '';
$admins = db()->query('SELECT email_hash, added_at FROM admins ORDER BY added_at')->fetchAll();
$mine = email_hash($me['email']);
foreach ($admins as $a) {
    $u = $known[$a['email_hash']] ?? null;
    $who = $u
        ? '<a class="row" href="/admin/user?id=' . h(rawurlencode($u['id'])) . '"><strong>' . h($u['name'] ?: '—') . '</strong></a><br><span class="muted">' . h($u['email']) . '</span>'
        : '<span class="muted">Not signed in yet</span><br><span class="muted num" title="SHA-256 of the email">' . h(substr($a['email_hash'], 0, 12)) . '…</span>';
    $action = $a['email_hash'] === $mine
        ? '<span class="pill admin">you</span>'
        : '<form class="inline" method="post" onsubmit="return confirm(\'Remove this admin?\')">' . csrf_field()
            . '<input type="hidden" name="hash" value="' . h($a['email_hash']) . '">'
            . '<button class="btn" name="action" value="remove">Remove</button></form>';
    $rows .= '<tr><td>' . $who . '</td><td>' . db_date($a['added_at']) . '</td><td>' . ($u ? db_date($u['last_login']) : '<span class="muted">—</span>') . '</td><td>' . $action . '</td></tr>';
}

$body = ($flash ? '<div class="flash">' . h($flash) . '</div>' : '')
    . '<p><a href="/admin">← All users</a></p>'
    . '<h2 style="margin-top:.5rem">Add an admin</h2>'
    . '<form method="post" class="addform">' . csrf_field()
    . '<input type="email" name="email" required placeholder="someone@gmail.com" autocomplete="off">'
    . '<button class="btn" name="action" value="add">Add admin</button></form>'
    . '<p class="muted" style="font-size:.85rem">Use the Google account they sign in with. Only a hash of the address is stored, so it is shown here once they have signed in.</p>'
    . '<h2>Admins (' . count($admins) . ')</h2>'
    . '<div class="wrap"><table><thead><tr><th>Admin</th><th>Added</th><th>Last sign-in</th><th></th></tr></thead><tbody>' . $rows . '</tbody></table></div>';

page('Admins', $body);
