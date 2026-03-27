# CorredorPro · Guía de Migración

Esta guía describe qué cambió respecto a la versión anterior y cómo migrar sin perder datos.

---

## Qué se eliminó

### Creación automática de BD y tablas

**Antes:** `app/db.php` intentaba ejecutar `CREATE DATABASE IF NOT EXISTS` y `CREATE TABLE IF NOT EXISTS` en cada inicio. En hosting compartido esto fallaba porque el usuario MySQL no tiene permisos para crear bases de datos.

**Ahora:** El sistema se conecta directamente a una BD existente. Si la BD no existe o las credenciales son incorrectas, devuelve un error JSON claro en lugar de romperse silenciosamente.

**Qué hacer:** Importar `sql/corredor_pro.sql` manualmente antes del primer acceso.

### seed automático

**Antes:** `cp_db_seed_demo()` insertaba usuarios y datos de prueba si la BD estaba vacía.

**Ahora:** No hay inserción automática. Crear los usuarios iniciales usando el SQL de la guía de instalación.

---

## Qué se agregó

### Columnas nuevas en `propiedades`

```sql
ALTER TABLE propiedades
    ADD COLUMN IF NOT EXISTS link_maps           VARCHAR(500)  NULL,
    ADD COLUMN IF NOT EXISTS latitud             DECIMAL(10,8) NULL,
    ADD COLUMN IF NOT EXISTS longitud            DECIMAL(11,8) NULL,
    ADD COLUMN IF NOT EXISTS limpieza_programada DATETIME      NULL;
```

Estas columnas soportan:
- `link_maps`: link original de Google Maps pegado por el corredor
- `latitud` / `longitud`: extraídas automáticamente del link (el sistema lo hace internamente)
- `limpieza_programada`: fecha en que se borrarán las fotos tras marcar alquilado/vendido

### Tabla nueva: `fotos_propiedades`

```sql
CREATE TABLE fotos_propiedades (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    propiedad_id INT          NOT NULL,
    filename     VARCHAR(255) NOT NULL,
    es_principal TINYINT(1)   NOT NULL DEFAULT 0,
    orden        INT          NOT NULL DEFAULT 0,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (propiedad_id) REFERENCES propiedades(id)
);
```

Las fotos físicas se guardan en `uploads/propiedades/{id}/`. Solo se guarda el nombre de archivo en BD.

### Tabla nueva: `prospecto_comentarios`

```sql
CREATE TABLE prospecto_comentarios (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    prospecto_id INT      NOT NULL,
    usuario_id   INT      NOT NULL,
    comentario   TEXT     NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prospecto_id) REFERENCES prospectos(id),
    FOREIGN KEY (usuario_id)   REFERENCES usuarios(id)
);
```

Permite el historial de comentarios internos por prospecto.

---

## Archivos que reemplazar

| Archivo                        | Cambio                                              |
|-------------------------------|-----------------------------------------------------|
| `app/config.php`               | Actualizado: sin SEED_DEMO, agrega CP_UPLOADS_PATH  |
| `app/db.php`                   | Reescrito: sin CREATE DATABASE / CREATE TABLE       |
| `app/helpers.php`              | Nuevas funciones: coords, fotos, limpieza diferida  |
| `app/auth.php`                 | Agrega `cp_require_admin()`                         |
| `app/api.php`                  | Reescrito: todos los endpoints nuevos y anteriores  |
| `public/index.php`             | Agrega Leaflet CDN + uploadsBase                    |
| `public/assets/app.js`         | Reescrito: mapa, fotos, usuarios, comentarios       |
| `public/assets/styles.css`     | Reescrito: estilos nuevos                           |
| `.htaccess` (raíz)             | Actualizado: enruta a public/, API y uploads        |

---

## Carpetas a crear

```bash
mkdir -p uploads/propiedades
mkdir -p storage/logs
mkdir -p sql
mkdir -p docs
```

**Permisos en Linux/hosting:**

```bash
chmod 755 uploads
chmod 755 uploads/propiedades
chmod 755 storage
chmod 755 storage/logs
```

---

## Lógica de limpieza diferida de fotos

### Cómo funciona

1. Admin marca una propiedad como **Alquilado** o **Vendido**
2. El sistema registra `limpieza_programada = NOW() + 1 día` en la BD
3. Las fotos físicas **no se borran de inmediato**
4. En cada login o carga del módulo de propiedades, el sistema revisa si hay limpiezas vencidas
5. Si `limpieza_programada <= NOW()` y el estado sigue siendo Alquilado/Vendido → borra fotos físicas y registros de BD

### Cómo revertir un error

1. Antes de que se cumpla el plazo: admin marca la propiedad como **Disponible**
2. El sistema cancela automáticamente la limpieza (`limpieza_programada = NULL`)
3. Las fotos se conservan

### Sin cron real

El sistema no requiere cron jobs. La limpieza se ejecuta de forma "piggyback" en cada petición al módulo de propiedades o al hacer login. Para hosting compartido esto es suficiente.

Si quieres forzar la limpieza inmediata, puedes ejecutar manualmente desde phpMyAdmin:

```sql
-- Ver propiedades con limpieza pendiente
SELECT id, codigo, titulo, estado, limpieza_programada
FROM propiedades
WHERE limpieza_programada IS NOT NULL
  AND limpieza_programada <= NOW();
```

---

## Flujo de estado de inmueble

```
Disponible ←→ Alquilado  (reversible dentro de 24h antes de borrar fotos)
Disponible ←→ Vendido    (reversible dentro de 24h antes de borrar fotos)
cualquier estado → DELETE definitivo (admin, borra fotos inmediatamente)
```

| Acción                 | Estado resultante | limpieza_programada  | Fotos     |
|------------------------|-------------------|----------------------|-----------|
| Crear propiedad        | Disponible        | NULL                 | Sin fotos |
| Marcar Alquilado       | Alquilado         | NOW() + 24h          | Se conservan |
| Marcar Vendido         | Vendido           | NOW() + 24h          | Se conservan |
| Revertir a Disponible  | Disponible        | NULL (cancelado)     | Se conservan |
| Cumplir plazo limpieza | sin cambio        | NULL (ejecutado)     | **BORRADAS** |
| Eliminar definitivo    | (borrado)         | -                    | **BORRADAS** |

---

## Nuevos endpoints de API

### Propiedades

| Método   | Ruta                          | Descripción                          | Rol mínimo |
|----------|-------------------------------|--------------------------------------|------------|
| `PATCH`  | `/propiedades/{id}/estado`    | Cambiar estado (Disponible/Alquilado/Vendido) | admin |
| `DELETE` | `/propiedades/{id}`           | Eliminar definitivamente + fotos     | admin      |
| `GET`    | `/propiedades/{id}/fotos`     | Listar fotos de una propiedad        | corredor   |
| `POST`   | `/propiedades/{id}/fotos`     | Subir fotos (multipart/form-data)    | corredor   |
| `DELETE` | `/fotos/{id}`                 | Eliminar foto individual             | corredor*  |
| `PUT`    | `/fotos/{id}/principal`       | Marcar como foto principal           | corredor*  |

*Corredor solo puede operar sus propias propiedades.

### Mapa

| Método | Ruta          | Descripción                              |
|--------|---------------|------------------------------------------|
| `GET`  | `/mapa/pins`  | Propiedades con coordenadas válidas      |

### Usuarios

| Método   | Ruta                       | Descripción                  |
|----------|----------------------------|------------------------------|
| `GET`    | `/usuarios`                | Listar todos los usuarios    |
| `POST`   | `/usuarios`                | Crear usuario                |
| `GET`    | `/usuarios/{id}`           | Ver un usuario               |
| `PUT`    | `/usuarios/{id}`           | Editar datos de usuario      |
| `PUT`    | `/usuarios/{id}/password`  | Cambiar contraseña           |
| `PATCH`  | `/usuarios/{id}/estado`    | Activar/inactivar usuario    |

### Comentarios

| Método | Ruta                                  | Descripción                    |
|--------|---------------------------------------|--------------------------------|
| `GET`  | `/prospectos/{id}/comentarios`        | Listar comentarios del prospecto |
| `POST` | `/prospectos/{id}/comentarios`        | Agregar comentario             |

---

## Extracción de coordenadas desde Google Maps

El sistema intenta extraer lat/lng automáticamente de los siguientes formatos:

| Formato de URL                                              | Compatible |
|------------------------------------------------------------|:----------:|
| `https://www.google.com/maps/place/.../@-8.38,-74.55,15z` | ✅         |
| `https://maps.google.com/?q=-8.38,-74.55`                  | ✅         |
| `https://maps.google.com/?ll=-8.38,-74.55`                 | ✅         |
| `https://www.google.com/maps?q=-8.38,-74.55`               | ✅         |
| `https://www.google.com/maps/place/...!3d-8.38!4d-74.55`  | ✅         |
| `https://maps.app.goo.gl/...` (link acortado)              | ❌ (guarda link pero no extrae coords) |
| `https://goo.gl/maps/...` (link acortado viejo)            | ❌ (igual) |

**Si no se extraen coordenadas:** la propiedad se guarda sin lat/lng y no aparecerá en el mapa. Para agregar el pin después, edita la propiedad y pega un link directo (no acortado).

---

## Seguridad de uploads

- Las fotos se guardan en `uploads/propiedades/{id}/`
- Cada directorio tiene su propio `.htaccess` con `php_flag engine off`
- El directorio raíz `uploads/.htaccess` bloquea ejecución de PHP, Perl, Python, etc.
- Los nombres de archivo son generados automáticamente (`uniqid`) — el nombre original del usuario nunca se usa en disco
- Se valida tipo MIME real (finfo), extensión y tamaño antes de aceptar el archivo
- No se permite path traversal: cada archivo debe estar dentro de `CP_UPLOADS_PATH`
