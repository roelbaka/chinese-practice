<?php
// /admin/user?id=…: one user's progress per lesson, their mistakes list, and what they practised last.
require __DIR__ . '/../server/admin.php';

require_admin();

$st = db()->prepare('SELECT id, email, name, created_at, last_login FROM users WHERE id = ?');
$st->execute([(string)($_GET['id'] ?? '')]);
$u = $st->fetch();
if (!$u) {
    http_response_code(404);
    page('Unknown user', '<p>No such user.</p><p><a href="/admin">All users</a></p>');
    exit;
}

$p = user_progress($u['id']);
$s = summarize($p);

// ---- Per lesson: records grouped by dir/id, plus lessons that only have a quiz result ----
$lessons = [];
foreach ($p['recs'] as $r) {
    if ($r['dir'] === '' || $r['id'] === '') continue;
    $k = $r['dir'] . '/' . $r['id'];
    $lessons[$k] ??= ['dir' => $r['dir'], 'id' => $r['id'], 'title' => $r['lesson'], 'recs' => []];
    $lessons[$k]['recs'][$r['zh']] = $r;
}
foreach ($p['chapters'] as $k => $c) {
    if (!is_array($c) || !str_contains((string)$k, '/')) continue;
    [$dir, $id] = explode('/', (string)$k, 2);
    $lessons[$k] ??= ['dir' => $dir, 'id' => $id, 'title' => '', 'recs' => []];
}
$order = array_flip(array_keys(CLASS_NAMES));
uasort($lessons, fn($a, $b) => [($order[$a['dir']] ?? 99), $a['id']] <=> [($order[$b['dir']] ?? 99), $b['id']]);

$lessonRows = '';
foreach ($lessons as $k => $l) {
    $info = lesson_info($l['dir'], $l['id']);
    $title = $info['title'] ?? ($l['title'] ?: ($l['id'] === 'words' ? '全书生词 · All words' : $l['id']));
    $practised = count($l['recs']);
    $mistakes = count(array_filter($l['recs'], 'is_mistake'));
    // Mastery as on the lesson cards: items of the lesson you know, out of all its items.
    $mastery = null;
    $of = '';
    if ($info && $info['zh']) {
        $known = 0;
        foreach ($info['zh'] as $zh) if (isset($p['recs'][$zh]) && is_known($p['recs'][$zh])) $known++;
        $mastery = pct($known, count($info['zh']));
        $of = ' <span class="muted">/ ' . count($info['zh']) . '</span>';
    }
    $ch = $p['chapters'][$k] ?? null;
    $lq = is_array($ch) && is_array($ch['lastQuiz'] ?? null) ? $ch['lastQuiz'] : null;
    $last = $lq ? (int)($lq['score'] ?? 0) . '/' . (int)($lq['total'] ?? 0) . ' <span class="muted">' . ms_date($lq['date'] ?? 0) . '</span>' : '<span class="muted">—</span>';
    $best = is_array($ch) && isset($ch['bestQuiz']) ? (int)$ch['bestQuiz'] . '%' : '<span class="muted">—</span>';
    $link = lesson_info($l['dir'], $l['id']) ? '/' . $l['dir'] . '/lesson.html?id=' . rawurlencode($l['id']) : null;
    $titleHtml = $link ? '<a class="row" href="' . h($link) . '">' . h($title) . '</a>' : h($title);
    $lessonRows .= '<tr>'
        . '<td><span class="pill">' . h(class_name($l['dir'])) . '</span></td>'
        . '<td class="wrapok">' . $titleHtml . '</td>'
        . '<td class="num">' . $practised . $of . '</td>'
        . '<td>' . bar($mastery) . '</td>'
        . '<td class="num">' . ($mistakes ? "<span class=\"bad\">$mistakes</span>" : '0') . '</td>'
        . '<td class="num">' . $last . '</td>'
        . '<td class="num">' . $best . '</td>'
        . '</tr>';
}

// ---- Current mistakes, worst first ----
$mis = array_filter($p['recs'], 'is_mistake');
uasort($mis, function ($a, $b) {
    $sa = $a['right'] / max(1, $a['right'] + $a['wrong']);
    $sb = $b['right'] / max(1, $b['right'] + $b['wrong']);
    return [$sa, -$a['last']] <=> [$sb, -$b['last']];
});
$misRows = '';
foreach ($mis as $r) {
    $need = max(0, 3 * $r['wrong'] + 1 - $r['right']); // right answers still needed to leave the list
    $misRows .= '<tr>'
        . '<td class="zh wrapok">' . h($r['zh']) . '</td>'
        . '<td class="py wrapok">' . h($r['py']) . '</td>'
        . '<td class="en wrapok">' . h($r['en']) . '</td>'
        . '<td class="num"><span class="good">' . $r['right'] . '</span> / <span class="bad">' . $r['wrong'] . '</span></td>'
        . '<td class="num">' . $need . '</td>'
        . '<td class="wrapok"><span class="pill">' . h(class_name($r['dir'])) . '</span> ' . h($r['lesson']) . '</td>'
        . '<td>' . ms_date($r['last']) . '</td>'
        . '</tr>';
}

// ---- Most recent answers ----
$recent = $p['recs'];
uasort($recent, fn($a, $b) => $b['last'] <=> $a['last']);
$recentRows = '';
foreach (array_slice($recent, 0, 25, true) as $r) {
    $state = is_mistake($r) ? '<span class="bad">mistake</span>' : (is_known($r) ? '<span class="good">known</span>' : '<span class="muted">—</span>');
    $recentRows .= '<tr>'
        . '<td class="zh wrapok">' . h($r['zh']) . '</td>'
        . '<td class="en wrapok">' . h($r['en']) . '</td>'
        . '<td class="num"><span class="good">' . $r['right'] . '</span> / <span class="bad">' . $r['wrong'] . '</span></td>'
        . '<td>' . $state . '</td>'
        . '<td class="wrapok"><span class="pill">' . h(class_name($r['dir'])) . '</span> ' . h($r['lesson']) . '</td>'
        . '<td>' . ms_date($r['last']) . '</td>'
        . '</tr>';
}

$acc = $s['accuracy'] === null ? '—' : $s['accuracy'] . '%';
$body = '<h2 style="margin-top:0">' . h($u['name'] ?: $u['email']) . ' <span class="muted">· ' . h($u['email']) . '</span></h2>'
    . '<p class="muted" style="margin-top:-.3rem">First sign-in ' . db_date($u['created_at']) . ' · last sign-in ' . db_date($u['last_login'])
    . ' · last practice ' . ms_date($s['last']) . '</p>'
    . '<div class="cards">'
    . '<div class="card"><div class="v">' . $s['words'] . '</div><div class="l">Words / sentences practised</div></div>'
    . '<div class="card"><div class="v good">' . $s['known'] . '</div><div class="l">Known</div></div>'
    . '<div class="card"><div class="v bad">' . $s['mistakes'] . '</div><div class="l">On the mistakes list</div></div>'
    . '<div class="card"><div class="v">' . $s['answers'] . '</div><div class="l">Answers</div></div>'
    . '<div class="card"><div class="v">' . $acc . '</div><div class="l">Answered right</div></div>'
    . '<div class="card"><div class="v">' . $s['quizzed'] . '</div><div class="l">Lessons quizzed</div></div>'
    . '</div>'
    . '<h2>Per lesson</h2>'
    . ($lessonRows
        ? '<div class="wrap"><table><thead><tr><th>Class</th><th>Lesson</th><th>Practised</th><th>Mastery</th><th>Mistakes</th><th>Last quiz</th><th>Best</th></tr></thead><tbody>' . $lessonRows . '</tbody></table></div>'
        : '<div class="wrap"><div class="empty">No practice yet.</div></div>')
    . '<h2>Mistakes list (' . count($mis) . ')</h2>'
    . ($misRows
        ? '<div class="wrap"><table><thead><tr><th>汉字</th><th>Pinyin</th><th>English</th><th>Right / wrong</th><th>Still to go</th><th>Lesson</th><th>Last seen</th></tr></thead><tbody>' . $misRows . '</tbody></table></div>'
        : '<div class="wrap"><div class="empty">Nothing on the mistakes list.</div></div>')
    . '<h2>Recently practised</h2>'
    . ($recentRows
        ? '<div class="wrap"><table><thead><tr><th>汉字</th><th>English</th><th>Right / wrong</th><th>State</th><th>Lesson</th><th>Last answer</th></tr></thead><tbody>' . $recentRows . '</tbody></table></div>'
        : '<div class="wrap"><div class="empty">Nothing yet.</div></div>');

page($u['name'] ?: $u['email'], $body);
