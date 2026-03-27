# CorredorPro · Guía de Instalación

## Requisitos

- PHP 8.0 o superior
- MySQL 5.7+ / MariaDB 10.4+
- Apache con `mod_rewrite` activado
- Servidor local: XAMPP, Laragon, WAMP — o hosting compartido con cPanel

---

## Instalación en XAMPP (Windows)

### 1. Copiar el proyecto

Coloca la carpeta `corredor_pro` dentro de:

```
C:\xampp\htdocs\corredor_pro\
```

Estructura esperada:

```
corredor_pro/
├── .htaccess
├── app/
├── public/
├── uploads/
├── sql/
├── docs/
└── python/
```

### 2. Crear la base de datos manualmente

Abre tu navegador y ve a `http://localhost/phpmyadmin`.

1. Clic en **Nueva** (panel izquierdo)
2. Nombre de la base de datos: `corredor_pro`
3. Cotejamiento: `utf8mb4_unicode_ci`
4. Clic en **Crear**

### 3. Importar el esquema SQL

1. Selecciona la base `corredor_pro` en phpMyAdmin
2. Pestaña **Importar**
3. Selecciona el archivo: `sql/corredor_pro.sql`
4. Clic en **Ejecutar**

### 4. Configurar la conexión

Edita `app/config.php`:

```php
define('CP_DB_HOST', '127.0.0.1');   // o 'localhost'
define('CP_DB_PORT', 3306);
define('CP_DB_NAME', 'corredor_pro');
define('CP_DB_USER', 'root');
define('CP_DB_PASS', '');            // XAMPP sin contraseña por defecto
```

### 5. Crear usuario inicial

Abre phpMyAdmin → pestaña SQL y ejecuta:

```sql
INSERT INTO usuarios (codigo, nombre, correo, password_hash, rol)
VALUES (
    'USR00001',
    'Admin CorredorPro',
    'admin@corredor.pro',
    '$2y$12$reemplaza_con_hash_real',
    'admin'
);
```

Para generar el hash de la contraseña, ejecuta en la terminal de XAMPP:

```
php -r "echo password_hash('admin123', PASSWORD_DEFAULT);"
```

Copia el resultado y reemplázalo en la consulta anterior.

### 6. Permisos de escritura en uploads

XAMPP en Windows normalmente ya tiene permisos de escritura. Si hay errores al subir fotos, verifica que la carpeta `uploads/` y sus subcarpetas tengan permisos de escritura.

### 7. Activar mod_rewrite en XAMPP

Abre `C:\xampp\apache\conf\extra\httpd-vhosts.conf` o `httpd.conf` y asegúrate de que el directorio tenga:

```apache
<Directory "C:/xampp/htdocs/corredor_pro">
    AllowOverride All
    Require all granted
</Directory>
```

También verifica que el módulo esté activado en `httpd.conf`:

```apache
LoadModule rewrite_module modules/mod_rewrite.so
```

### 8. Acceder al sistema

```
http://localhost/corredor_pro/
```

---

## Instalación en Hosting Compartido (cPanel)

### 1. Subir archivos

Sube todo el contenido de `corredor_pro/` mediante FTP o el administrador de archivos de cPanel a:

```
/public_html/corredor_pro/
```

### 2. Crear base de datos

En cPanel → **Bases de datos MySQL**:

1. Crear base de datos: `mi_usuario_corredor`
2. Crear usuario MySQL con contraseña segura
3. Agregar el usuario a la base de datos con **TODOS los privilegios**

### 3. Importar SQL

En cPanel → **phpMyAdmin**:

1. Seleccionar la base de datos
2. Importar → seleccionar `sql/corredor_pro.sql`
3. Ejecutar

### 4. Configurar app/config.php

```php
define('CP_DB_HOST', 'localhost');         // En hosting casi siempre es 'localhost'
define('CP_DB_NAME', 'mi_usuario_corredor');
define('CP_DB_USER', 'mi_usuario_mysql');
define('CP_DB_PASS', 'contraseña_segura');
```

### 5. Verificar .htaccess

El archivo `.htaccess` raíz usa `RewriteBase /corredor_pro/`. Si el proyecto está en el raíz del hosting (ejemplo: `public_html/`) cambia la línea a:

```apache
RewriteBase /
```

### 6. Permisos de carpetas

En cPanel → Administrador de archivos, asigna permisos `755` a:

```
uploads/
uploads/propiedades/
storage/
storage/logs/
```

---

## Estructura de carpetas del proyecto

```
corredor_pro/
├── .htaccess               → Enruta todo a public/
├── app/
│   ├── config.php          → Configuración de BD, rutas, constantes
│   ├── db.php              → Conexión PDO (sin auto-creación)
│   ├── helpers.php         → Funciones utilitarias
│   ├── auth.php            → Login, logout, sesión
│   ├── api.php             → Router de API REST
│   ├── matching.php        → Motor de compatibilidad propiedad-prospecto
│   └── parser_bridge.php   → Extracción de datos desde anuncio con Python
├── public/
│   ├── index.php           → Entrada del frontend SPA
│   ├── api.php             → Punto de entrada de la API (incluye app/api.php)
│   ├── .htaccess           → Routing interno de public/
│   └── assets/
│       ├── app.js          → Frontend SPA vanilla JS
│       └── styles.css      → Estilos CSS
├── uploads/
│   ├── .htaccess           → Seguridad (bloquea ejecución PHP)
│   └── propiedades/        → Fotos organizadas por ID de propiedad
│       └── {id}/
│           ├── .htaccess
│           └── *.jpg
├── python/
│   └── parser_inmuebles.py → Parser de anuncios con IA
├── sql/
│   └── corredor_pro.sql    → Esquema completo de BD
├── storage/
│   └── logs/               → Logs de la aplicación
└── docs/
    ├── instalacion.md      → Este archivo
    └── migracion.md        → Guía de migración
```

---

## Credenciales por defecto

No hay credenciales automáticas. Debes crearlas manualmente usando el SQL de instalación.

Ejemplo de usuarios de desarrollo:

| Rol      | Correo                | Contraseña  |
|----------|-----------------------|-------------|
| admin    | admin@corredor.pro    | admin123    |
| corredor | carlos@corredor.pro   | carlos123   |

---

## Solución de problemas comunes

### Error 500 al abrir la aplicación

- Verifica que `mod_rewrite` esté activo en Apache
- Revisa `storage/logs/` para ver el mensaje de error real
- Confirma que `app/config.php` tiene las credenciales correctas

### "No se pudo conectar a la base de datos"

- La base de datos debe existir antes de acceder a la app (no se crea automáticamente)
- Verifica host, nombre de BD, usuario y contraseña en `app/config.php`

### Las fotos no se muestran

- Verifica que `uploads/propiedades/` tenga permisos de escritura (755 en Linux)
- El `.htaccess` de uploads bloquea PHP pero debe permitir imágenes

### El mapa no carga

- Requiere conexión a internet (carga Leaflet + OpenStreetMap desde CDN)
- Si estás offline, descarga Leaflet localmente y ajusta las rutas en `public/index.php`

### Rutas de API no funcionan (404 en api/)

- Confirma que `mod_rewrite` está activo
- En el `.htaccess` raíz, verifica que `RewriteBase` coincide con la ruta del proyecto
