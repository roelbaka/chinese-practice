<?php
/*
 * Give a Google account access to /admin. Run on the server:
 *   cd /opt/app && docker compose exec php php /srv/site/server/add-admin.php someone@gmail.com
 * Only the SHA-256 hash of the (lower-cased) address is stored. Add --remove to take access away.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/lib.php';

$args = array_slice($argv, 1);
$remove = in_array('--remove', $args, true);
$emails = array_values(array_filter($args, fn($a) => $a !== '--remove'));
if (!$emails) { fwrite(STDERR, "usage: add-admin.php [--remove] email…\n"); exit(1); }

foreach ($emails as $email) {
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { fwrite(STDERR, "not an email: $email\n"); exit(1); }
    $h = email_hash($email);
    if ($remove) {
        db()->prepare('DELETE FROM admins WHERE email_hash = ?')->execute([$h]);
        echo "removed $email\n";
    } else {
        db()->prepare('INSERT OR IGNORE INTO admins (email_hash) VALUES (?)')->execute([$h]);
        echo "admin: $email\n";
    }
}
