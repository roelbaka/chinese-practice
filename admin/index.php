<?php
// /admin: everyone who ever signed in with Google, with a summary of their progress.
require __DIR__ . '/../server/admin.php';

$me = require_admin();

// Grant or revoke admin access for a registered user (Post/Redirect/Get).
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_ok()) { http_response_code(400); page('Expired', '<p>The form expired. <a href="/admin">Reload</a> and try again.</p>'); exit; }
    $st = db()->prepare('SELECT email FROM users WHERE id = ?');
    $st->execute([(string)($_POST['user'] ?? '')]);
    $email = $st->fetchColumn();
    $msg = 'unknown';
    if ($email !== false) {
        $h = email_hash($email);
        if (($_POST['action'] ?? '') === 'grant') {
            db()->prepare('INSERT OR IGNORE INTO admins (email_hash) VALUES (?)')->execute([$h]);
            $msg = 'granted';
        } elseif (($_POST['action'] ?? '') === 'revoke') {
            // Never lock yourself out: revoke your own access on the server if you really mean it.
            if (strcasecmp($email, $me['email']) === 0) $msg = 'self';
            else { db()->prepare('DELETE FROM admins WHERE email_hash = ?')->execute([$h]); $msg = 'revoked'; }
        }
    }
    redirect('/admin/?done=' . $msg);
}

$flash = [
    'granted' => 'Admin access granted.',
    'revoked' => 'Admin access revoked.',
    'self' => "You can't remove your own admin access here.",
    'unknown' => 'That user does not exist.',
][$_GET['done'] ?? ''] ?? '';

$admins = admin_hashes();
$users = db()->query('SELECT id, email, name, created_at, last_login FROM users ORDER BY COALESCE(last_login, created_at) DESC')->fetchAll();

$rows = '';
$totals = ['users' => count($users), 'active' => 0, 'answers' => 0];
foreach ($users as $u) {
    $s = summarize(user_progress($u['id']));
    $totals['answers'] += $s['answers'];
    if ($s['last'] > (time() - 7 * 86400) * 1000) $totals['active']++;
    $acc = $s['accuracy'] === null ? '<span class="muted">—</span>' : "{$s['accuracy']}%";
    $mis = $s['mistakes'] ? "<span class=\"bad\">{$s['mistakes']}</span>" : '0';
    $href = '/admin/user?id=' . rawurlencode($u['id']);
    $isAdmin = isset($admins[email_hash($u['email'])]);
    $self = strcasecmp($u['email'], $me['email']) === 0;
    $adminCell = ($isAdmin ? '<span class="pill admin">admin</span> ' : '')
        . ($self ? '' : '<form class="inline" method="post">' . csrf_field()
            . '<input type="hidden" name="user" value="' . h($u['id']) . '">'
            . '<button class="btn" name="action" value="' . ($isAdmin ? 'revoke' : 'grant') . '">'
            . ($isAdmin ? 'Remove admin' : 'Make admin') . '</button></form>');
    $rows .= '<tr>'
        . '<td><a class="row" href="' . h($href) . '"><strong>' . h($u['name'] ?: '—') . '</strong></a><br><span class="muted">' . h($u['email']) . '</span></td>'
        . '<td class="num">' . $s['words'] . '</td>'
        . '<td class="num"><span class="good">' . $s['known'] . '</span></td>'
        . '<td class="num">' . $mis . '</td>'
        . '<td class="num">' . $s['answers'] . '</td>'
        . '<td class="num">' . $acc . '</td>'
        . '<td class="num">' . $s['quizzed'] . '</td>'
        . '<td>' . ms_date($s['last']) . '</td>'
        . '<td>' . db_date($u['last_login']) . '</td>'
        . '<td>' . db_date($u['created_at']) . '</td>'
        . '<td>' . $adminCell . '</td>'
        . '</tr>';
}

$body = ($flash ? '<div class="flash">' . h($flash) . '</div>' : '')
    . '<div class="cards">'
    . '<div class="card"><div class="v">' . $totals['users'] . '</div><div class="l">Registered users</div></div>'
    . '<div class="card"><div class="v">' . $totals['active'] . '</div><div class="l">Practised in the last 7 days</div></div>'
    . '<div class="card"><div class="v">' . $totals['answers'] . '</div><div class="l">Answers in total</div></div>'
    . '<a class="card row" href="/admin/admins"><div class="v">' . count($admins) . '</div><div class="l">Admins · manage →</div></a>'
    . '</div>'
    . '<h2>Users</h2>';

$body .= $users
    ? '<div class="wrap"><table><thead><tr><th>User</th><th>Words</th><th>Known</th><th>Mistakes</th><th>Answers</th><th>Right</th><th>Quizzed</th><th>Last practice</th><th>Last sign-in</th><th>First sign-in</th><th>Access</th></tr></thead><tbody>' . $rows . '</tbody></table></div>'
    : '<div class="wrap"><div class="empty">Nobody has signed in yet.</div></div>';

page('Users', $body);
