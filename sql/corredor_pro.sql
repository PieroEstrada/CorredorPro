-- =============================================================================
-- CorredorPro · Esquema completo de base de datos
-- MySQL / MariaDB · Charset utf8mb4
--
-- INSTRUCCIONES:
--   1. Crear la base de datos manualmente desde cPanel o phpMyAdmin.
--   2. Importar este archivo: Importar → seleccionar este .sql → Ejecutar
--   3. Ajustar las credenciales en app/config.php
--
-- FRESH INSTALL: ejecutar TODO este archivo.
-- MIGRACIÓN desde versión anterior: ver sección ALTER TABLE al final.
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- USUARIOS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    codigo        VARCHAR(20)  NOT NULL UNIQUE,
    nombre        VARCHAR(150) NOT NULL,
    correo        VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol           ENUM('admin','corredor') NOT NULL DEFAULT 'corredor',
    activo        TINYINT(1)   NOT NULL DEFAULT 1,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NULL     DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- PROPIEDADES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS propiedades (
    id                       INT AUTO_INCREMENT PRIMARY KEY,
    codigo                   VARCHAR(20)    NOT NULL UNIQUE,
    usuario_id               INT            NOT NULL,
    titulo                   VARCHAR(220)   NULL,
    tipo                     VARCHAR(80)    NULL,
    operacion                VARCHAR(30)    NULL,
    estado                   VARCHAR(30)    NOT NULL DEFAULT 'Disponible',
    -- Nuevas columnas de estado y limpieza diferida
    limpieza_programada      DATETIME       NULL COMMENT 'Fecha en que se deben borrar las fotos (tras marcar alquilado/vendido)',
    precio                   DECIMAL(14,2)  NULL,
    moneda                   VARCHAR(10)    NOT NULL DEFAULT 'S/',
    piso                     INT            NULL,
    area                     DECIMAL(12,2)  NULL,
    area_construida          DECIMAL(12,2)  NULL,
    frente                   DECIMAL(12,2)  NULL,
    fondo                    DECIMAL(12,2)  NULL,
    izquierda                DECIMAL(12,2)  NULL,
    derecha                  DECIMAL(12,2)  NULL,
    habitaciones             INT            NULL,
    banos                    INT            NULL,
    medios_banos             INT            NULL,
    sala                     TINYINT(1)     NULL,
    comedor                  TINYINT(1)     NULL,
    cocina                   TINYINT(1)     NULL,
    kitchenette              TINYINT(1)     NULL,
    patio                    TINYINT(1)     NULL,
    jardin                   TINYINT(1)     NULL,
    balcon                   TINYINT(1)     NULL,
    terraza                  TINYINT(1)     NULL,
    lavanderia               TINYINT(1)     NULL,
    tendedero                TINYINT(1)     NULL,
    azotea                   TINYINT(1)     NULL,
    deposito                 TINYINT(1)     NULL,
    oficina                  TINYINT(1)     NULL,
    aire_acondicionado       TINYINT(1)     NULL,
    ventilador_techo         TINYINT(1)     NULL,
    amoblado                 TINYINT(1)     NULL,
    closets                  TINYINT(1)     NULL,
    reservorio_agua          TINYINT(1)     NULL,
    agua_24h                 TINYINT(1)     NULL,
    cochera                  TINYINT(1)     NULL,
    tipo_cochera             VARCHAR(50)    NULL,
    cantidad_vehiculos       INT            NULL,
    seguridad                TINYINT(1)     NULL,
    rejas                    TINYINT(1)     NULL,
    porton                   TINYINT(1)     NULL,
    internet_incluido        TINYINT(1)     NULL,
    mantenimiento_incluido   TINYINT(1)     NULL,
    agua_incluida            TINYINT(1)     NULL,
    agua_monto               DECIMAL(12,2)  NULL,
    luz                      VARCHAR(50)    NULL,
    luz_monto                DECIMAL(12,2)  NULL,
    mascotas                 VARCHAR(30)    NULL DEFAULT 'No especificado',
    extranjeros              TINYINT(1)     NOT NULL DEFAULT 0,
    nacionalidades_aceptadas TEXT           NULL,
    ninos_permitidos         VARCHAR(30)    NULL DEFAULT 'No especificado',
    ubicacion                TEXT           NULL,
    referencias              TEXT           NULL,
    distrito                 VARCHAR(100)   NULL,
    ciudad                   VARCHAR(100)   NULL DEFAULT 'Pucallpa',
    mes_adelantado           INT            NULL,
    mes_garantia             INT            NULL,
    contrato_minimo          VARCHAR(80)    NULL,
    documentacion            TEXT           NULL,
    uso_ideal                TEXT           NULL,
    descripcion_original     LONGTEXT       NULL,
    parser_confianza         LONGTEXT       NULL,
    parser_evidencia         LONGTEXT       NULL,
    parser_faltantes         LONGTEXT       NULL,
    parser_advertencias      LONGTEXT       NULL,
    -- Ubicación via Google Maps
    link_maps                VARCHAR(500)   NULL COMMENT 'Link original de Google Maps',
    latitud                  DECIMAL(10,8)  NULL COMMENT 'Extraído automáticamente del link_maps',
    longitud                 DECIMAL(11,8)  NULL COMMENT 'Extraído automáticamente del link_maps',
    created_at               DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME       NULL     DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_propiedades_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- FOTOS DE PROPIEDADES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fotos_propiedades (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    propiedad_id  INT          NOT NULL,
    filename      VARCHAR(255) NOT NULL COMMENT 'Nombre de archivo en disco (sin ruta)',
    es_principal  TINYINT(1)   NOT NULL DEFAULT 0,
    orden         INT          NOT NULL DEFAULT 0,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_fotos_propiedad FOREIGN KEY (propiedad_id) REFERENCES propiedades(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- PROSPECTOS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospectos (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    codigo        VARCHAR(20)  NOT NULL UNIQUE,
    usuario_id    INT          NOT NULL,
    nombre        VARCHAR(150) NOT NULL,
    telefono      VARCHAR(40)  NULL,
    whatsapp      VARCHAR(40)  NULL,
    correo        VARCHAR(190) NULL,
    documento     VARCHAR(50)  NULL,
    nacionalidad  VARCHAR(80)  NULL,
    estado        VARCHAR(40)  NOT NULL DEFAULT 'Nuevo',
    fuente        VARCHAR(80)  NULL,
    observaciones TEXT         NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NULL     DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_prospectos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- COMENTARIOS INTERNOS DE PROSPECTOS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospecto_comentarios (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    prospecto_id  INT      NOT NULL,
    usuario_id    INT      NOT NULL,
    comentario    TEXT     NOT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_comentarios_prospecto FOREIGN KEY (prospecto_id) REFERENCES prospectos(id),
    CONSTRAINT fk_comentarios_usuario   FOREIGN KEY (usuario_id)   REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- REQUERIMIENTOS DE PROSPECTOS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS requerimientos_prospecto (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    prospecto_id     INT            NOT NULL,
    operacion        VARCHAR(30)    NULL,
    tipo_inmueble    VARCHAR(80)    NULL,
    presupuesto_min  DECIMAL(14,2)  NULL,
    presupuesto_max  DECIMAL(14,2)  NULL,
    moneda           VARCHAR(10)    NOT NULL DEFAULT 'S/',
    zonas            TEXT           NULL,
    habitaciones_min INT            NULL,
    banos_min        INT            NULL,
    cochera          VARCHAR(30)    NULL,
    tipo_vehiculo    VARCHAR(50)    NULL,
    mascotas         VARCHAR(30)    NULL,
    extranjero       VARCHAR(30)    NULL,
    estado           VARCHAR(30)    NOT NULL DEFAULT 'Activo',
    created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME       NULL     DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_req_prospecto FOREIGN KEY (prospecto_id) REFERENCES prospectos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- SEGUIMIENTOS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seguimientos (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id    INT         NOT NULL,
    prospecto_id  INT         NULL,
    propiedad_id  INT         NULL,
    tipo          VARCHAR(50) NOT NULL DEFAULT 'Llamada',
    fecha         DATE        NULL,
    nota          TEXT        NULL,
    resultado     TEXT        NULL,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_seguimientos_usuario   FOREIGN KEY (usuario_id)   REFERENCES usuarios(id),
    CONSTRAINT fk_seguimientos_prospecto FOREIGN KEY (prospecto_id) REFERENCES prospectos(id),
    CONSTRAINT fk_seguimientos_propiedad FOREIGN KEY (propiedad_id) REFERENCES propiedades(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- CITAS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citas (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id    INT          NOT NULL,
    prospecto_id  INT          NULL,
    propiedad_id  INT          NULL,
    titulo        VARCHAR(200) NOT NULL,
    tipo          VARCHAR(50)  NOT NULL DEFAULT 'Visita',
    fecha         DATE         NOT NULL,
    hora          TIME         NULL,
    duracion_min  INT          NOT NULL DEFAULT 60,
    ubicacion     TEXT         NULL,
    notas         TEXT         NULL,
    estado        VARCHAR(30)  NOT NULL DEFAULT 'Pendiente',
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NULL     DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_citas_usuario   FOREIGN KEY (usuario_id)   REFERENCES usuarios(id),
    CONSTRAINT fk_citas_prospecto FOREIGN KEY (prospecto_id) REFERENCES prospectos(id),
    CONSTRAINT fk_citas_propiedad FOREIGN KEY (propiedad_id) REFERENCES propiedades(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- BLACKLIST
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blacklist (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id    INT          NOT NULL,
    prospecto_id  INT          NULL,
    nombre        VARCHAR(150) NULL,
    telefono      VARCHAR(40)  NULL,
    motivo        TEXT         NOT NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_blacklist_usuario   FOREIGN KEY (usuario_id)   REFERENCES usuarios(id),
    CONSTRAINT fk_blacklist_prospecto FOREIGN KEY (prospecto_id) REFERENCES prospectos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- MATCHES (compatibilidad propiedad-prospecto)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    propiedad_id     INT      NOT NULL,
    prospecto_id     INT      NOT NULL,
    requerimiento_id INT      NULL,
    score            INT      NOT NULL,
    razones          TEXT     NULL,
    visto            TINYINT(1) NOT NULL DEFAULT 0,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NULL     DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_match (propiedad_id, prospecto_id, requerimiento_id),
    CONSTRAINT fk_matches_propiedad FOREIGN KEY (propiedad_id)     REFERENCES propiedades(id),
    CONSTRAINT fk_matches_prospecto FOREIGN KEY (prospecto_id)     REFERENCES prospectos(id),
    CONSTRAINT fk_matches_req       FOREIGN KEY (requerimiento_id) REFERENCES requerimientos_prospecto(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- DATOS INICIALES (usuarios de ejemplo para primera instalación)
-- Descomenta y ejecuta SOLO si la tabla usuarios está vacía.
-- =============================================================================
-- INSERT INTO usuarios (codigo, nombre, correo, password_hash, rol) VALUES
-- ('USR00001', 'Admin CorredorPro', 'admin@corredor.pro',   '$2y$12$...hash_de_admin123...',   'admin'),
-- ('USR00002', 'Carlos Mendoza',    'carlos@corredor.pro',  '$2y$12$...hash_de_carlos123...', 'corredor');
--
-- Para generar un hash válido en PHP: echo password_hash('tu_contraseña', PASSWORD_DEFAULT);
-- O usa el script: php -r "echo password_hash('admin123', PASSWORD_DEFAULT);"

-- =============================================================================
-- MIGRACIÓN DESDE VERSIÓN ANTERIOR
-- Ejecutar SOLO si ya tienes la BD y quieres agregar las nuevas columnas.
-- Ignora los errores "Duplicate column name" si ya existen.
-- =============================================================================

-- Nuevas columnas en propiedades:
-- NOTA: ADD COLUMN IF NOT EXISTS requiere MySQL 8.0+ o MariaDB 10.3.2+.
-- Si usas MySQL 5.7, ejecuta cada ALTER TABLE por separado y omite IF NOT EXISTS.
ALTER TABLE propiedades
    ADD COLUMN IF NOT EXISTS link_maps VARCHAR(500)  NULL  AFTER parser_advertencias,
    ADD COLUMN IF NOT EXISTS latitud DECIMAL(10,8) NULL  AFTER link_maps,
    ADD COLUMN IF NOT EXISTS longitud            DECIMAL(11,8) NULL  AFTER latitud,
    ADD COLUMN IF NOT EXISTS limpieza_programada DATETIME      NULL  AFTER estado;

-- Alternativa para MySQL 5.7 (ejecutar una por una solo si la columna no existe):
-- ALTER TABLE propiedades ADD COLUMN link_maps           VARCHAR(500)  NULL;
-- ALTER TABLE propiedades ADD COLUMN latitud             DECIMAL(10,8) NULL;
-- ALTER TABLE propiedades ADD COLUMN longitud            DECIMAL(11,8) NULL;
-- ALTER TABLE propiedades ADD COLUMN limpieza_programada DATETIME      NULL;

-- Nueva tabla de fotos (si viene de versión sin fotos):
-- La tabla fotos_propiedades ya está en el CREATE TABLE arriba con IF NOT EXISTS.

-- Nueva tabla de comentarios:
-- La tabla prospecto_comentarios ya está en el CREATE TABLE arriba con IF NOT EXISTS.

-- FIN DEL ESQUEMA
