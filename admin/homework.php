<?php
// /admin/homework: set, edit and delete homework. Shown to everyone on /homework/.
require __DIR__ . '/../server/admin.php';
require __DIR__ . '/../server/homework.php';

$me = require_admin();
$pdo = homework_table();

$form = ['id' => 0, 'due' => date('Y-m-d', strtotime('+7 days')), 'track' => '', 'title' => '', 'body' => '', 'links' => ''];
$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrf_ok()) { http_response_code(400); page('Expired', '<p>The form expired. <a href="/admin/homework">Reload</a> and try again.</p>'); exit; }
    $action = (string)($_POST['action'] ?? '');
    $id = (int)($_POST['id'] ?? 0);

    if ($action === 'delete' && $id) {
        $pdo->prepare('DELETE FROM homework WHERE id = ?')->execute([$id]);
        redirect('/admin/homework?done=deleted');
    }

    if ($action === 'save') {
        $form = [
            'id' => $id,
            'due' => trim((string)($_POST['due'] ?? '')),
            'track' => (string)($_POST['track'] ?? ''),
            'title' => trim((string)($_POST['title'] ?? '')),
            'body' => trim(str_replace("\r\n", "\n", (string)($_POST['body'] ?? ''))),
            'links' => (string)($_POST['links'] ?? ''),
        ];
        [$links, $bad] = homework_parse_links($form['links']);
        if (!homework_valid_date($form['due'])) $errors[] = 'Pick a due date.';
        if (!array_key_exists($form['track'], HOMEWORK_TRACKS)) $errors[] = 'Pick a class.';
        if ($form['title'] === '' || mb_strlen($form['title']) > 200) $errors[] = 'Give it a title (at most 200 characters).';
        if (mb_strlen($form['body']) > 10000) $errors[] = 'The text is too long (at most 10,000 characters).';
        if ($bad) $errors[] = 'These links are not valid web addresses (use https://… or a path on this site like /hsk3/…): ' . implode(', ', $bad);

        if (!$errors) {
            $json = json_encode($links, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($id) {
                $pdo->prepare('UPDATE homework SET due_date = ?, track = ?, title = ?, body = ?, links = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                    ->execute([$form['due'], $form['track'], $form['title'], $form['body'], $json, $id]);
                redirect('/admin/homework?done=saved');
            }
            $pdo->prepare('INSERT INTO homework (due_date, track, title, body, links, created_by) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$form['due'], $form['track'], $form['title'], $form['body'], $json, $me['id']]);
            redirect('/admin/homework?done=added');
        }
    }
} elseif (isset($_GET['edit'])) {
    $st = $pdo->prepare('SELECT * FROM homework WHERE id = ?');
    $st->execute([(int)$_GET['edit']]);
    if ($r = $st->fetch()) {
        $hw = homework_row($r);
        $form = ['id' => $hw['id'], 'due' => $hw['due'], 'track' => $hw['track'], 'title' => $hw['title'], 'body' => $hw['body'], 'links' => homework_links_text($hw['links'])];
    }
}

$flash = ['added' => 'Homework added.', 'saved' => 'Homework saved.', 'deleted' => 'Homework deleted.'][$_GET['done'] ?? ''] ?? '';

// ---- The form ----
$opts = '';
foreach (HOMEWORK_TRACKS as $k => $name) {
    $opts .= '<option value="' . h($k) . '"' . ($k === $form['track'] ? ' selected' : '') . '>' . h($name) . '</option>';
}
$editing = $form['id'] > 0;
$formHtml = '<form method="post" class="hwform">' . csrf_field()
    . '<input type="hidden" name="id" value="' . (int)$form['id'] . '">'
    . '<div class="two"><label>Due date<input type="date" name="due" required value="' . h($form['due']) . '"></label>'
    . '<label>Class<select name="track">' . $opts . '</select></label></div>'
    . '<label>Title<input type="text" name="title" required maxlength="200" value="' . h($form['title']) . '" placeholder="e.g. Lesson 12 · new words"></label>'
    . '<label>Text<textarea name="body" rows="7" placeholder="What to do. Web addresses in the text become links.">' . h($form['body']) . '</textarea></label>'
    . '<label>Links <span class="muted">one per line: <code>Label | https://…</code>, or just the address; site pages like <code>/hsk3/lesson.html?id=…</code> work too</span>'
    . '<textarea name="links" rows="4" placeholder="Words lesson 12 | /hsk3/lesson.html?id=hsk3-lesson-12-put-it-here#words&#10;https://www.youtube.com/watch?v=…">' . h($form['links']) . '</textarea></label>'
    . '<div class="actions"><button class="btn primary" name="action" value="save">' . ($editing ? 'Save changes' : 'Add homework') . '</button>'
    . ($editing ? ' <a class="btn" href="/admin/homework">Cancel</a>' : '') . '</div>'
    . '</form>';

// ---- The list ----
$today = date('Y-m-d');
$rows = '';
foreach (homework_all() as $hw) {
    $linkList = '';
    foreach ($hw['links'] as $l) {
        $linkList .= '<a href="' . h($l['url']) . '" target="_blank" rel="noopener">' . h($l['label'] !== '' ? $l['label'] : $l['url']) . '</a><br>';
    }
    $past = $hw['due'] < $today;
    $rows .= '<tr' . ($past ? ' class="past"' : '') . '>'
        . '<td><strong>' . h(date('D j M Y', strtotime($hw['due']))) . '</strong>' . ($hw['due'] === $today ? ' <span class="pill admin">today</span>' : '') . '</td>'
        . '<td><span class="pill">' . h($hw['trackName']) . '</span></td>'
        . '<td class="wrapok"><strong>' . h($hw['title']) . '</strong><div class="muted pre">' . h(mb_strimwidth($hw['body'], 0, 220, '…')) . '</div></td>'
        . '<td class="wrapok">' . ($linkList ?: '<span class="muted">—</span>') . '</td>'
        . '<td><a class="btn" href="/admin/homework?edit=' . $hw['id'] . '">Edit</a> '
        . '<form class="inline" method="post" onsubmit="return confirm(\'Delete this homework?\')">' . csrf_field()
        . '<input type="hidden" name="id" value="' . $hw['id'] . '"><button class="btn" name="action" value="delete">Delete</button></form></td>'
        . '</tr>';
}

$body = ($flash ? '<div class="flash">' . h($flash) . '</div>' : '')
    . ($errors ? '<div class="flash bad">' . implode('<br>', array_map('h', $errors)) . '</div>' : '')
    . '<h2 style="margin-top:0">' . ($editing ? 'Edit homework' : 'Set homework') . '</h2>' . $formHtml
    . '<h2>All homework <span class="muted">· shown on <a href="/homework/">/homework</a></span></h2>'
    . ($rows
        ? '<div class="wrap"><table><thead><tr><th>Due</th><th>Class</th><th>Homework</th><th>Links</th><th></th></tr></thead><tbody>' . $rows . '</tbody></table></div>'
        : '<div class="wrap"><div class="empty">No homework yet.</div></div>');

page('Homework', $body);
