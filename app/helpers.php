<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

// ─── Sesión ───────────────────────────────────────────────────────────────────

function cp_boot_session(): void
{
    if (session_status() === PHP_SESSION_NONE) {
        session_name(CP_SESSION_NAME);

        // Configurar cookie ANTES de session_start().
        // path='/' garantiza que la cookie se envíe en todas las rutas del dominio
        // (evita el bug de XAMPP donde path queda como /corredor_pro/public/).
        session_set_cookie_params([
            'lifetime' => 0,        // hasta cerrar el navegador
            'path'     => '/',      // todas las rutas del dominio
            'secure'   => false,    // true solo si usas HTTPS
            'httponly' => true,     // no accesible desde JavaScript
            'samesite' => 'Lax',    // compatible con fetch credentials:same-origin
        ]);

        session_start();
    }
}

// ─── Respuestas JSON ──────────────────────────────────────────────────────────

function cp_json(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function cp_json_error(string $message, int $status = 400, array $extra = []): never
{
    cp_json(array_merge(['ok' => false, 'error' => $message], $extra), $status);
}

// ─── Request helpers ─────────────────────────────────────────────────────────

function cp_request_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function cp_request_method(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function cp_api_route(): string
{
    if (!empty($_GET['route'])) {
        return '/' . trim((string) $_GET['route'], '/');
    }
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    if (preg_match('#/api(?:\.php)?(/.*)$#', $uri, $m)) {
        return $m[1] ?: '/';
    }
    return '/';
}

// ─── Tipos / cast ─────────────────────────────────────────────────────────────

function cp_now(): string  { return date('Y-m-d H:i:s'); }
function cp_today(): string { return date('Y-m-d'); }

function cp_nullable_string(mixed $v): ?string
{
    if ($v === null) return null;
    $v = trim((string) $v);
    return $v === '' ? null : $v;
}

function cp_nullable_float(mixed $v): ?float
{
    if ($v === null || $v === '') return null;
    if (is_string($v)) $v = str_replace([' ', ','], ['', '.'], $v);
    return is_numeric($v) ? (float) $v : null;
}

function cp_nullable_int(mixed $v): ?int
{
    if ($v === null || $v === '') return null;
    return is_numeric($v) ? (int) $v : null;
}

function cp_bool_to_int(mixed $v): ?int
{
    if ($v === null || $v === '') return null;
    if (is_bool($v)) return $v ? 1 : 0;
    $n = strtolower(trim((string) $v));
    if (in_array($n, ['1', 'true', 'si', 'sí', 'yes'], true)) return 1;
    if (in_array($n, ['0', 'false', 'no'], true)) return 0;
    return null;
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

function cp_write_log(string $channel, string $message, array $context = []): void
{
    $file = CP_LOG_PATH . DIRECTORY_SEPARATOR . date('Y-m-d') . '.log';
    $line = sprintf(
        "[%s] [%s] %s %s%s",
        cp_now(),
        strtoupper($channel),
        $message,
        $context ? json_encode($context, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : '',
        PHP_EOL
    );
    @file_put_contents($file, $line, FILE_APPEND);
}

// ─── Generación de códigos ────────────────────────────────────────────────────

function cp_generate_code(PDO $db, string $table, string $prefix, int $padding = 5): string
{
    $stmt = $db->query("SELECT codigo FROM `{$table}` ORDER BY id DESC LIMIT 1");
    $last = $stmt ? $stmt->fetchColumn() : null;
    if (!$last || !preg_match('/(\d+)$/', (string) $last, $m)) {
        return $prefix . str_pad('1', $padding, '0', STR_PAD_LEFT);
    }
    return $prefix . str_pad((string) ((int) $m[1] + 1), $padding, '0', STR_PAD_LEFT);
}

// ─── JSON encode/decode seguro ────────────────────────────────────────────────

function cp_db_json_encode(mixed $v): ?string
{
    if ($v === null) return null;
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function cp_db_json_decode(?string $v, mixed $fallback = []): mixed
{
    if ($v === null || $v === '') return $fallback;
    $d = json_decode($v, true);
    return json_last_error() === JSON_ERROR_NONE ? $d : $fallback;
}

function cp_clean_parser_value(mixed $v): mixed
{
    if (is_string($v)) {
        $t = trim($v);
        return $t === '' ? null : $t;
    }
    if (is_array($v)) return array_map('cp_clean_parser_value', $v);
    return $v;
}

// ─── Google Maps: extracción de coordenadas ───────────────────────────────────

/**
 * Intenta extraer latitud y longitud de un enlace de Google Maps.
 * Soporta formatos:
 *   - https://www.google.com/maps/place/.../@-8.3791,-74.5539,15z
 *   - https://maps.google.com/?q=-8.3791,-74.5539
 *   - https://maps.google.com/?ll=-8.3791,-74.5539
 *   - https://www.google.com/maps?q=-8.3791,-74.5539
 *   - https://www.google.com/maps/place/...!3d-8.3791!4d-74.5539
 *   - https://maps.app.goo.gl/... (acortado — no se resuelve, devuelve null/null)
 *   - https://goo.gl/maps/...    (acortado — no se resuelve, devuelve null/null)
 */
function cp_extract_coords_from_maps_link(string $url): array
{
    $url = trim($url);
    if ($url === '') return ['lat' => null, 'lng' => null];

    // Formato @lat,lng,zoom dentro del path
    if (preg_match('/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/', $url, $m)) {
        return ['lat' => (float) $m[1], 'lng' => (float) $m[2]];
    }

    // Parámetros ?q=lat,lng o ?q=lat%2Clng
    if (preg_match('/[?&]q=(-?\d{1,3}\.?\d*)[,+%2C]+(-?\d{1,3}\.?\d*)/i', $url, $m)) {
        return ['lat' => (float) $m[1], 'lng' => (float) $m[2]];
    }

    // Parámetro ?ll=lat,lng
    if (preg_match('/[?&]ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/i', $url, $m)) {
        return ['lat' => (float) $m[1], 'lng' => (float) $m[2]];
    }

    // Data embebida !3d{lat}!4d{lng}
    if (preg_match('/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/', $url, $m)) {
        return ['lat' => (float) $m[1], 'lng' => (float) $m[2]];
    }

    // Coordenadas planas en path: /maps/-8.3791,-74.5539
    if (preg_match('#/maps/(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)#', $url, $m)) {
        return ['lat' => (float) $m[1], 'lng' => (float) $m[2]];
    }

    return ['lat' => null, 'lng' => null];
}

// ─── Fotos: borrado seguro ────────────────────────────────────────────────────

/**
 * Elimina un archivo físico solo si está dentro de CP_UPLOADS_PATH.
 * Previene path traversal.
 */
function cp_safe_delete_file(string $path): bool
{
    $uploadsReal = realpath(CP_UPLOADS_PATH);
    if (!$uploadsReal) return false;

    // Normalizar sin resolver symlinks para que funcione aunque el archivo no exista
    $normalized = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $path);
    $realPath   = realpath($normalized);

    if ($realPath === false) return false; // archivo no existe
    if (!str_starts_with($realPath, $uploadsReal . DIRECTORY_SEPARATOR)) return false;
    if (!is_file($realPath)) return false;

    return @unlink($realPath);
}

/**
 * Elimina todas las fotos físicas de una propiedad y sus registros en BD.
 */
function cp_delete_property_photos(PDO $db, int $propId): void
{
    $stmt = $db->prepare('SELECT filename FROM fotos_propiedades WHERE propiedad_id = ?');
    $stmt->execute([$propId]);
    $fotos = $stmt->fetchAll();

    foreach ($fotos as $foto) {
        $path = CP_UPLOADS_PATH . DIRECTORY_SEPARATOR . 'propiedades'
              . DIRECTORY_SEPARATOR . $propId
              . DIRECTORY_SEPARATOR . $foto['filename'];
        cp_safe_delete_file($path);
    }

    $dir = CP_UPLOADS_PATH . DIRECTORY_SEPARATOR . 'propiedades'
         . DIRECTORY_SEPARATOR . $propId;
    if (is_dir($dir)) @rmdir($dir);

    $db->prepare('DELETE FROM fotos_propiedades WHERE propiedad_id = ?')->execute([$propId]);
}

// ─── Limpieza diferida de fotos ───────────────────────────────────────────────

/**
 * Revisa propiedades con limpieza programada vencida y ejecuta la limpieza.
 * Llamar en cada inicio de sesión o carga del módulo de propiedades.
 */
function cp_run_pending_cleanups(PDO $db): void
{
    $stmt = $db->prepare(
        "SELECT id FROM propiedades
         WHERE limpieza_programada IS NOT NULL
           AND limpieza_programada <= NOW()
           AND estado IN ('Alquilado', 'Vendido')"
    );
    $stmt->execute();
    $ids = $stmt->fetchAll(\PDO::FETCH_COLUMN);

    foreach ($ids as $id) {
        cp_delete_property_photos($db, (int) $id);
        $db->prepare('UPDATE propiedades SET limpieza_programada = NULL WHERE id = ?')
           ->execute([$id]);
        cp_write_log('cleanup', "Fotos eliminadas para propiedad #{$id}");
    }
}
