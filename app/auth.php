<?php
declare(strict_types=1);

require_once __DIR__ . '/db.php';

/**
 * Intenta autenticar por correo electrónico o nombre de usuario.
 * $login puede ser un email o un username.
 */
function cp_auth_attempt(string $login, string $password): ?array
{
    cp_boot_session();
    $db = cp_db();

    // Buscar por correo primero; si no hay @, también buscar por username
    if (str_contains($login, '@')) {
        $stmt = $db->prepare('SELECT * FROM usuarios WHERE correo = ? AND activo = 1 LIMIT 1');
        $stmt->execute([$login]);
    } else {
        $stmt = $db->prepare(
            'SELECT * FROM usuarios WHERE (username = ? OR correo = ?) AND activo = 1 LIMIT 1'
        );
        $stmt->execute([$login, $login]);
    }
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, (string) $user['password_hash'])) {
        return null;
    }

    $_SESSION['user_id'] = (int) $user['id'];
    unset($user['password_hash']);
    return $user;
}

function cp_auth_logout(): void
{
    cp_boot_session();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(
            session_name(), '', time() - 42000,
            $p['path'], $p['domain'] ?? '',
            $p['secure'] ?? false, $p['httponly'] ?? true
        );
    }
    session_destroy();
}

function cp_current_user(): ?array
{
    cp_boot_session();
    if (empty($_SESSION['user_id'])) return null;

    $db   = cp_db();
    $stmt = $db->prepare(
        'SELECT id, codigo, nombre, correo, rol, activo, created_at
         FROM usuarios WHERE id = ? AND activo = 1 LIMIT 1'
    );
    $stmt->execute([(int) $_SESSION['user_id']]);
    $user = $stmt->fetch();
    return $user ?: null;
}

function cp_require_auth(): array
{
    $user = cp_current_user();
    if (!$user) cp_json_error('No autorizado.', 401);
    return $user;
}

function cp_require_admin(): array
{
    $user = cp_require_auth();
    if ($user['rol'] !== 'admin') {
        cp_json_error('Acción reservada para administradores.', 403);
    }
    return $user;
}
