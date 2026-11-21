<?php
/*
 * Homework set by admins (/admin/homework), shown to everyone on /homework/ via /api/homework.
 * An item has a due date, a class (Beginners, Improvers, Intermediate, Advanced or all), a title,
 * free text (web addresses in it become links) and a list of links ("Label | https://…" or just the address; site paths like /hsk3/… too).
 */
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

/** The four classes at school; '' = every class. */
const HOMEWORK_TRACKS = [
    '' => 'All classes',
    'beginners' => 'Beginners',
    'improvers' => 'Improvers',
    'intermediate' => 'Intermediate',
    'advanced' => 'Advanced',
];
const HOMEWORK_MAX_LINKS = 20;

function homework_table(): PDO
{
    $pdo = db();
    $pdo->exec('CREATE TABLE IF NOT EXISTS homework (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        due_date   TEXT NOT NULL,              -- YYYY-MM-DD
        track      TEXT NOT NULL DEFAULT \'\',  -- key of HOMEWORK_TRACKS
        title      TEXT NOT NULL,
        body       TEXT NOT NULL DEFAULT \'\',
        links      TEXT NOT NULL DEFAULT \'[]\', -- JSON [{"label": …, "url": …}]
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');
    return $pdo;
}

/** A link target we allow: http(s) addresses and paths on this site. */
function homework_url_ok(string $url): bool
{
    if (preg_match('#^/(?!/)[^\s\\\\]*$#', $url)) return true;
    return (bool)preg_match('#^https?://#i', $url) && filter_var($url, FILTER_VALIDATE_URL) !== false;
}

/** "Label | url" or "url", one per line → [{label, url}], plus the lines that were not valid. */
function homework_parse_links(string $text): array
{
    $links = [];
    $bad = [];
    foreach (preg_split('/\R/', $text) as $line) {
        $line = trim($line);
        if ($line === '') continue;
        if (str_contains($line, '|')) {
            [$label, $url] = array_map('trim', explode('|', $line, 2));
        } else {
            [$label, $url] = ['', $line];
        }
        if (homework_url_ok($url) && count($links) < HOMEWORK_MAX_LINKS) {
            $links[] = ['label' => mb_substr($label, 0, 120), 'url' => $url];
        } else {
            $bad[] = $line;
        }
    }
    return [$links, $bad];
}

function homework_links_text(array $links): string
{
    return implode("\n", array_map(fn($l) => ($l['label'] !== '' ? $l['label'] . ' | ' : '') . $l['url'], $links));
}

function homework_row(array $r): array
{
    $links = json_decode($r['links'] ?: '[]', true);
    return [
        'id' => (int)$r['id'],
        'due' => $r['due_date'],
        'track' => $r['track'],
        'trackName' => HOMEWORK_TRACKS[$r['track']] ?? HOMEWORK_TRACKS[''],
        'title' => $r['title'],
        'body' => $r['body'],
        'links' => is_array($links) ? $links : [],
        'updated' => $r['updated_at'],
    ];
}

/** All homework, newest due date first. */
function homework_all(): array
{
    $rows = homework_table()->query('SELECT * FROM homework ORDER BY due_date DESC, id DESC')->fetchAll();
    return array_map('homework_row', $rows);
}

function homework_valid_date(string $d): bool
{
    return (bool)preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $d, $m) && checkdate((int)$m[2], (int)$m[3], (int)$m[1]);
}
