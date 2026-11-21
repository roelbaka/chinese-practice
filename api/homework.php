<?php
// Public: all homework, newest due date first. {"today": "YYYY-MM-DD", "items": [...]}
require __DIR__ . '/../server/homework.php';

date_default_timezone_set('Europe/Amsterdam');
json_out(['today' => date('Y-m-d'), 'items' => homework_all()]);
