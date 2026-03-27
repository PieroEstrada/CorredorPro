<?php
declare(strict_types=1);

define('CP_APP_NAME',  'CorredorPro');
define('CP_ROOT',       dirname(__DIR__));
define('CP_APP_PATH',   CP_ROOT . DIRECTORY_SEPARATOR . 'app');
define('CP_PUBLIC_PATH',CP_ROOT . DIRECTORY_SEPARATOR . 'public');
define('CP_STORAGE_PATH', CP_ROOT . DIRECTORY_SEPARATOR . 'storage');
define('CP_LOG_PATH',   CP_STORAGE_PATH . DIRECTORY_SEPARATOR . 'logs');
define('CP_UPLOADS_PATH', CP_ROOT . DIRECTORY_SEPARATOR . 'uploads');

// ─── Base de datos ────────────────────────────────────────────────────────────
// XAMPP local: DB_HOST=127.0.0.1, DB_USER=root, DB_PASS=''
// Hosting: ajusta los valores con los datos del panel cPanel
define('CP_DB_HOST', '127.0.0.1');
define('CP_DB_PORT', 3306);
define('CP_DB_NAME', 'corredor_pro');
define('CP_DB_USER', 'root');
define('CP_DB_PASS', '');

// ─── Zona horaria ─────────────────────────────────────────────────────────────
define('CP_TIMEZONE',     'America/Lima');
define('CP_SESSION_NAME', 'corredorpro_session');

// ─── Parser Python ────────────────────────────────────────────────────────────
define('CP_PYTHON_BIN',     'C:\\Python314\\python.exe');
define('CP_PYTHON_SCRIPT',  CP_ROOT . DIRECTORY_SEPARATOR . 'python' . DIRECTORY_SEPARATOR . 'parser_inmuebles.py');
define('CP_PYTHON_TIMEOUT', 15);

// ─── Fotos ────────────────────────────────────────────────────────────────────
define('CP_FOTO_MAX_SIZE',      5 * 1024 * 1024);  // 5 MB
define('CP_FOTO_ALLOWED_TYPES', ['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
define('CP_FOTO_ALLOWED_EXT',   ['jpg', 'jpeg', 'png', 'webp', 'gif']);

date_default_timezone_set(CP_TIMEZONE);

foreach ([CP_STORAGE_PATH, CP_LOG_PATH, CP_UPLOADS_PATH] as $_cp_dir) {
    if (!is_dir($_cp_dir)) {
        @mkdir($_cp_dir, 0755, true);
    }
}
