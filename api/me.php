<?php
// Who is signed in: {"user": {"email": …, "name": …, "admin": bool}} or {"user": null}.
require __DIR__ . '/../server/admin.php';

resume_session();
$u = current_user();
json_out(['user' => $u ? ['email' => $u['email'], 'name' => $u['name'], 'admin' => is_admin($u)] : null]);
