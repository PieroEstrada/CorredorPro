<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/app/helpers.php';
cp_boot_session();

// Base URL relativa al public/ para uploads
// Funciona tanto en XAMPP (localhost/corredor_pro/public/) como en hosting compartido
$uploadsBase = rtrim(dirname($_SERVER['PHP_SELF']), '/\\') . '/../uploads';
?>
<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>CorredorPro · CRM Inmobiliario</title>

    <!-- Leaflet CSS (mapa) — sin integrity para evitar bloqueo por compresión variable de unpkg -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">

    <link rel="stylesheet" href="assets/styles.css">
</head>
<body>
    <div id="app"></div>

    <!-- Template del login -->
    <template id="login-template">
        <section class="login-screen">
            <div class="card login-card">
                <h1>CorredorPro</h1>
                <p class="login-sub">CRM inmobiliario · Pucallpa</p>
                <form id="login-form">
                    <label>Correo o usuario
                        <input type="text" name="login" placeholder="correo@ejemplo.com o usuario" required autocomplete="username">
                    </label>
                    <label>Contraseña
                        <input type="password" name="password" placeholder="••••••••" required autocomplete="current-password">
                    </label>
                    <button type="submit">Iniciar sesión</button>
                    <div class="error-box" id="login-error"></div>
                </form>
            </div>
        </section>
    </template>

    <!-- Leaflet JS — sin integrity para evitar bloqueo por compresión variable de unpkg -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

    <script>
        window.CORREDORPRO = {
            apiBase:     'api',
            uploadsBase: '<?= htmlspecialchars($uploadsBase, ENT_QUOTES, 'UTF-8') ?>'
        };
    </script>
    <script src="assets/app.js"></script>
</body>
</html>
