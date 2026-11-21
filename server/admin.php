<?php
/*
 * Admin pages (/admin, /admin/user): who signed in, and their progress.
 * Admins are the Google accounts whose email hash is in the `admins` table (managed on /admin/admins,
 * or with server/add-admin.php on the server),
 * so no admin address is stored readable anywhere.
 *
 * Everything shown here comes from the users' own localStorage, so it is untrusted: cast numbers,
 * escape all text, and only open lesson files whose names match the expected pattern.
 */
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

date_default_timezone_set('Europe/Amsterdam');

const MISTAKE_THRESHOLD = 0.75; // same rule as progress.js
const CLASS_NAMES = [
    'beginners' => '初级 · Beginners',
    'improvers' => '中级 · Improvers',
    'hsk1' => 'HSK 1',
    'hsk2' => 'HSK 2',
    'hsk3' => 'HSK 3',
    'proverbs' => '成语 · Proverbs',
];

function is_admin(?array $user): bool
{
    if (!$user) return false;
    $st = db()->prepare('SELECT 1 FROM admins WHERE email_hash = ?');
    $st->execute([email_hash($user['email'])]);
    return (bool)$st->fetchColumn();
}

/** Signed-out visitors go to Google sign-in first; signed-in non-admins get a 403. */
function require_admin(): array
{
    resume_session();
    $user = current_user();
    if (!$user) redirect('/auth/login?return=' . rawurlencode(safe_return($_SERVER['REQUEST_URI'] ?? '/admin')));
    $_SESSION['csrf'] ??= bin2hex(random_bytes(16)); // for the forms on the admin pages
    session_write_close();
    if (!is_admin($user)) {
        http_response_code(403);
        page('Not allowed', '<p>This page is only for the site admin.</p><p><a href="/">Back to the site</a></p>');
        exit;
    }
    return $user;
}

function csrf_ok(): bool
{
    return is_string($_POST['csrf'] ?? null) && isset($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $_POST['csrf']);
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . h($_SESSION['csrf'] ?? '') . '">';
}

/** Hashes of every admin email, to mark admins in the user list. */
function admin_hashes(): array
{
    return array_flip(db()->query('SELECT email_hash FROM admins')->fetchAll(PDO::FETCH_COLUMN));
}

function h(mixed $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function ms_date(mixed $ms): string
{
    $ms = (int)$ms;
    return $ms > 0 ? date('j M Y H:i', intdiv($ms, 1000)) : '—';
}

function db_date(?string $utc): string
{
    if (!$utc) return '—';
    $t = strtotime($utc . ' UTC');
    return $t ? date('j M Y H:i', $t) : '—';
}

function pct(int $part, int $whole): ?int
{
    return $whole > 0 ? (int)round($part / $whole * 100) : null;
}

/** One answer record from the mistakes store, with numbers cast. */
function clean_rec(string $zh, mixed $r): ?array
{
    if (!is_array($r)) return null;
    return [
        'zh' => $zh,
        'py' => (string)($r['py'] ?? ''),
        'en' => (string)($r['en'] ?? ''),
        'right' => max(0, (int)($r['right'] ?? 0)),
        'wrong' => max(0, (int)($r['wrong'] ?? 0)),
        'dir' => (string)($r['dir'] ?? ''),
        'id' => (string)($r['id'] ?? ''),
        'lesson' => (string)($r['lesson'] ?? ''),
        'section' => (string)($r['section'] ?? ''),
        'last' => (int)($r['last'] ?? 0),
    ];
}

function is_mistake(array $r): bool
{
    $n = $r['right'] + $r['wrong'];
    return $r['wrong'] > 0 && ($n ? $r['right'] / $n : 1) <= MISTAKE_THRESHOLD;
}

function is_known(array $r): bool
{
    return $r['right'] > 0 && !is_mistake($r);
}

/** A user's stored progress, decoded: answer records, chapter quiz results, last change. */
function user_progress(string $userId): array
{
    $st = db()->prepare('SELECT key, value, updated_at FROM progress WHERE user_id = ?');
    $st->execute([$userId]);
    $out = ['recs' => [], 'chapters' => [], 'updated' => null, 'settings' => []];
    foreach ($st as $row) {
        if (!$out['updated'] || $row['updated_at'] > $out['updated']) $out['updated'] = $row['updated_at'];
        $val = json_decode($row['value'], true);
        if ($row['key'] === 'chinesePractice.mistakes.v1' && is_array($val)) {
            foreach ($val as $zh => $r) {
                $c = clean_rec((string)$zh, $r);
                if ($c) $out['recs'][(string)$zh] = $c;
            }
        } elseif ($row['key'] === 'chinesePractice.chapters.v1' && is_array($val)) {
            $out['chapters'] = $val;
        } else {
            $out['settings'][$row['key']] = $row['value'];
        }
    }
    return $out;
}

/** Totals for the overview table. */
function summarize(array $p): array
{
    $right = $wrong = $known = $mistakes = 0;
    $last = 0;
    foreach ($p['recs'] as $r) {
        $right += $r['right'];
        $wrong += $r['wrong'];
        if (is_mistake($r)) $mistakes++;
        elseif (is_known($r)) $known++;
        $last = max($last, $r['last']);
    }
    foreach ($p['chapters'] as $c) {
        if (is_array($c) && isset($c['lastQuiz']['date'])) $last = max($last, (int)$c['lastQuiz']['date']);
    }
    return [
        'words' => count($p['recs']), 'known' => $known, 'mistakes' => $mistakes,
        'answers' => $right + $wrong, 'accuracy' => pct($right, $right + $wrong),
        'quizzed' => count($p['chapters']), 'last' => $last,
    ];
}

/** Title and the practisable items (unique hanzi, browse-only sections skipped) of one lesson. */
function lesson_info(string $dir, string $id): ?array
{
    static $cache = [];
    if (!preg_match('/^[a-z0-9-]{1,40}$/', $dir) || !preg_match('/^[a-z0-9-]{1,80}$/', $id)) return null;
    $key = "$dir/$id";
    if (array_key_exists($key, $cache)) return $cache[$key];
    $file = "/srv/site/$dir/data/$id.json";
    $json = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
    if (!is_array($json)) return $cache[$key] = null;
    $zh = [];
    foreach (($json['data'] ?? []) as $section) {
        if (!empty($section['browseOnly'])) continue;
        foreach (($section['items'] ?? []) as $item) {
            if (!empty($item['zh'])) $zh[$item['zh']] = true;
        }
    }
    return $cache[$key] = ['title' => (string)($json['title'] ?? $id), 'zh' => array_keys($zh)];
}

function class_name(string $dir): string
{
    return CLASS_NAMES[$dir] ?? $dir;
}

function bar(?int $pct): string
{
    if ($pct === null) return '<span class="muted">—</span>';
    $cls = $pct >= 75 ? 'high' : ($pct >= 40 ? 'mid' : 'low');
    return "<span class=\"bar\"><span class=\"$cls\" style=\"width:{$pct}%\"></span></span> <span class=\"num\">{$pct}%</span>";
}

function page(string $title, string $body): void
{
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
    $t = h($title);
    echo <<<HTML
<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>$t · Admin · 练习中文</title>
<style>
  :root { --bg:#0f0f0f; --card:#1a1a2e; --card-hover:#222244; --border:#2a2a4a; --text:#eee; --text-muted:#999; --accent:#e94560; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif; }
  header { padding:1.2rem 1rem 1rem; text-align:center; background:linear-gradient(180deg,#1a1a2e,#0f0f0f); border-bottom:1px solid var(--border); }
  header h1 { margin:.2rem 0 0; font-weight:300; letter-spacing:1px; } header h1 b { color:var(--accent); font-weight:600; }
  header .crumbs { font-size:.85rem; color:var(--text-muted); } header a { color:var(--text-muted); }
  main { max-width:1100px; margin:0 auto; padding:1.25rem 1rem 3rem; }
  h2 { font-weight:500; font-size:1.05rem; margin:2rem 0 .6rem; color:var(--text-muted); letter-spacing:.5px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:.6rem; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:.8rem 1rem; }
  .card .v { font-size:1.5rem; font-weight:600; } .card .l { color:var(--text-muted); font-size:.8rem; }
  .wrap { overflow-x:auto; border:1px solid var(--border); border-radius:12px; }
  table { width:100%; border-collapse:collapse; font-size:.9rem; }
  th, td { text-align:left; padding:.55rem .75rem; border-bottom:1px solid var(--border); white-space:nowrap; vertical-align:middle; }
  th { color:var(--text-muted); font-weight:500; font-size:.78rem; text-transform:uppercase; letter-spacing:.5px; background:var(--card); }
  tr:last-child td { border-bottom:0; }
  tbody tr:hover { background:var(--card-hover); }
  td.wrapok { white-space:normal; min-width:12rem; }
  a { color:var(--text); } a.row { text-decoration:none; } a.row:hover { color:var(--accent); }
  .muted { color:var(--text-muted); } .zh { font-size:1.05rem; } .py { color:#f0c060; } .en { color:#8ec5ff; }
  .bad { color:var(--accent); } .good { color:#4cc38a; }
  .bar { display:inline-block; width:90px; height:7px; border-radius:4px; background:var(--border); overflow:hidden; vertical-align:middle; }
  .bar > span { display:block; height:100%; } .bar .high { background:#4cc38a; } .bar .mid { background:#f0c060; } .bar .low { background:var(--accent); }
  .num { font-variant-numeric:tabular-nums; }
  .pill { display:inline-block; padding:.05rem .5rem; border-radius:999px; border:1px solid var(--border); font-size:.75rem; color:var(--text-muted); }
  .empty { padding:1.2rem; color:var(--text-muted); }
  form.inline { display:inline; margin:0; }
  .hwform { display:grid; gap:.8rem; background:var(--card); border:1px solid var(--border); border-radius:12px; padding:1rem; }
  .hwform label { display:grid; gap:.3rem; font-size:.85rem; color:var(--text-muted); }
  .hwform .two { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:.8rem; }
  .hwform input, .hwform select, .hwform textarea { font:inherit; font-size:.95rem; color:var(--text); background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:.5rem .7rem; width:100%; }
  .hwform textarea { resize:vertical; line-height:1.5; }
  .hwform input:focus, .hwform select:focus, .hwform textarea:focus { outline:none; border-color:var(--accent); }
  .hwform input[type=date] { color-scheme:dark; }
  .hwform code { font-size:.8rem; color:var(--text); }
  .hwform .actions { display:flex; gap:.5rem; }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-size:.9rem; padding:.5rem 1.1rem; }
  a.btn { text-decoration:none; display:inline-block; }
  .flash.bad { border-left-color:#f0c060; }
  tr.past td { opacity:.55; }
  .pre { white-space:pre-line; font-size:.82rem; margin-top:.2rem; }
  .addform { display:flex; gap:.5rem; flex-wrap:wrap; }
  .addform input { flex:1; min-width:14rem; font:inherit; padding:.5rem .75rem; border-radius:8px; background:var(--card); color:var(--text); border:1px solid var(--border); }
  .addform input:focus { outline:none; border-color:var(--accent); }
  .addform .btn { font-size:.9rem; padding:.5rem 1rem; }
  .btn { font:inherit; font-size:.8rem; padding:.25rem .65rem; border-radius:8px; cursor:pointer; background:transparent; color:var(--text); border:1px solid var(--border); }
  .btn:hover { border-color:var(--accent); }
  .pill.admin { border-color:var(--accent); color:var(--accent); }
  .flash { background:var(--card); border:1px solid var(--border); border-left:3px solid var(--accent); border-radius:8px; padding:.6rem .9rem; margin-bottom:1rem; }
</style>
</head><body>
<header><div class="crumbs"><a href="/">练习中文</a> · <a href="/admin">Users</a> · <a href="/admin/homework">Homework</a> · <a href="/admin/admins">Admins</a></div><h1>管理 <b>Admin</b></h1></header>
<main>$body</main>
<script src="/nav.js" defer></script>
</body></html>
HTML;
}
