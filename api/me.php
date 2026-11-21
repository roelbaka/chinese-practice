<?php
// Who is signed in: {"user": {"email": …, "name": …}} or {"user": null}.
require __DIR__ . '/../server/lib.php';

resume_session();
$u = current_user();
json_out(['user' => $u ? ['email' => $u['email'], 'name' => $u['name']] : null]);
