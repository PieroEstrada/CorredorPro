<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

/**
 * Retorna la conexión PDO singleton.
 * NO crea la base de datos ni las tablas automáticamente.
 * Si la conexión falla, responde con JSON de error y termina.
 */
function cp_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        CP_DB_HOST,
        CP_DB_PORT,
        CP_DB_NAME
    );

    try {
        $pdo = new PDO($dsn, CP_DB_USER, CP_DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec("SET time_zone = '-05:00'");
    } catch (\PDOException $e) {
        http_response_code(503);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'ok'     => false,
            'error'  => 'No se pudo conectar a la base de datos. '
                      . 'Revise la configuración en app/config.php y asegúrese '
                      . 'de que la base de datos exista antes de iniciar la aplicación.',
            'detail' => $e->getMessage(),
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    return $pdo;
}
