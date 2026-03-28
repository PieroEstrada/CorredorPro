-- =============================================================================
-- CorredorPro · Migración v3
-- Reestructura Prospectos, Requerimientos y Cochera; añade índices.
--
-- EJECUTAR sobre BD que ya tiene migration_v2 aplicada.
-- Compatible con MySQL 8.0+ y MariaDB 10.3.2+
-- Ejecutar en phpMyAdmin o mysql CLI: mysql -u user -p db < migration_v3.sql
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PROSPECTOS — solo datos personales
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE prospectos
    ADD COLUMN IF NOT EXISTS dni     VARCHAR(20) NULL COMMENT 'DNI o documento' AFTER usuario_id,
    ADD COLUMN IF NOT EXISTS celular VARCHAR(40) NULL                            AFTER nombre;

-- Migrar telefono → celular (copiar si celular aún vacío)
UPDATE prospectos SET celular  = telefono WHERE celular  IS NULL AND telefono IS NOT NULL;
-- WhatsApp hereda celular si estaba vacío
UPDATE prospectos SET whatsapp = celular   WHERE (whatsapp IS NULL OR whatsapp = '') AND celular IS NOT NULL;

-- Eliminar columnas que ya no son datos personales
ALTER TABLE prospectos
    DROP COLUMN IF EXISTS codigo,
    DROP COLUMN IF EXISTS correo,
    DROP COLUMN IF EXISTS documento,
    DROP COLUMN IF EXISTS estado,
    DROP COLUMN IF EXISTS fuente,
    DROP COLUMN IF EXISTS telefono;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PROPIEDADES — cochera unificada: NO_TIENE | MOTO | CARRO
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE propiedades
    ADD COLUMN IF NOT EXISTS cochera_v3 VARCHAR(10) NOT NULL DEFAULT 'NO_TIENE'
        COMMENT 'NO_TIENE | MOTO | CARRO' AFTER cochera;

-- Migrar datos: cochera (bool) + tipo_cochera (text) → cochera_v3
UPDATE propiedades SET cochera_v3 =
    CASE
        WHEN (cochera IS NULL OR cochera = 0) THEN 'NO_TIENE'
        WHEN cochera = 1
             AND tipo_cochera IS NOT NULL
             AND (tipo_cochera LIKE '%moto%' OR tipo_cochera LIKE '%lineal%')
             AND tipo_cochera NOT LIKE '%carro%'
             AND tipo_cochera NOT LIKE '%camioneta%'
             AND tipo_cochera NOT LIKE '%auto%'   THEN 'MOTO'
        ELSE 'CARRO'
    END;

ALTER TABLE propiedades
    DROP COLUMN IF EXISTS cochera,
    DROP COLUMN IF EXISTS tipo_cochera,
    DROP COLUMN IF EXISTS cantidad_vehiculos;

ALTER TABLE propiedades CHANGE cochera_v3 cochera VARCHAR(10) NOT NULL DEFAULT 'NO_TIENE';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TABLA RELACIONAL: tipos de inmueble por requerimiento
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS requerimiento_tipos_inmueble (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    requerimiento_id INT         NOT NULL,
    tipo_inmueble    VARCHAR(80) NOT NULL,
    CONSTRAINT fk_rqti_req FOREIGN KEY (requerimiento_id)
        REFERENCES requerimientos_prospecto(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migrar tipo_inmueble existente a la nueva tabla
INSERT IGNORE INTO requerimiento_tipos_inmueble (requerimiento_id, tipo_inmueble)
SELECT id, tipo_inmueble
FROM requerimientos_prospecto
WHERE tipo_inmueble IS NOT NULL AND tipo_inmueble != '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REQUERIMIENTOS — reestructura completa
-- ─────────────────────────────────────────────────────────────────────────────

-- Agregar columnas nuevas
ALTER TABLE requerimientos_prospecto
    ADD COLUMN IF NOT EXISTS cochera_v3                     VARCHAR(10) NOT NULL DEFAULT 'NO_TIENE' AFTER cochera,
    ADD COLUMN IF NOT EXISTS requiere_propiedad_con_mascota TINYINT(1)  NOT NULL DEFAULT 0          AFTER cochera_v3,
    ADD COLUMN IF NOT EXISTS primer_piso                    TINYINT(1)  NOT NULL DEFAULT 0          AFTER requiere_propiedad_con_mascota,
    ADD COLUMN IF NOT EXISTS observaciones                  TEXT        NULL                        AFTER primer_piso;

-- Migrar cochera vieja → nueva
UPDATE requerimientos_prospecto SET cochera_v3 =
    CASE
        WHEN cochera = 'Sí'
             AND tipo_vehiculo IS NOT NULL
             AND (tipo_vehiculo LIKE '%moto%' OR tipo_vehiculo LIKE '%lineal%')
             AND tipo_vehiculo NOT LIKE '%carro%'
             AND tipo_vehiculo NOT LIKE '%camioneta%' THEN 'MOTO'
        WHEN cochera = 'Sí' THEN 'CARRO'
        ELSE 'NO_TIENE'
    END;

-- Migrar tiene_mascota de prospectos → requiere_propiedad_con_mascota
UPDATE requerimientos_prospecto r
    JOIN prospectos p ON p.id = r.prospecto_id
SET r.requiere_propiedad_con_mascota = COALESCE(p.tiene_mascota, 0);

-- Migrar piso_buscado → primer_piso
UPDATE requerimientos_prospecto
SET primer_piso = 1
WHERE piso_buscado IS NOT NULL AND (piso_buscado LIKE '%1%' OR piso_buscado LIKE '%primer%');

-- Eliminar columnas que ya no se usan
ALTER TABLE requerimientos_prospecto
    DROP COLUMN IF EXISTS operacion,
    DROP COLUMN IF EXISTS tipo_inmueble,
    DROP COLUMN IF EXISTS tipos_inmueble,
    DROP COLUMN IF EXISTS presupuesto_min,
    DROP COLUMN IF EXISTS moneda,
    DROP COLUMN IF EXISTS zonas,
    DROP COLUMN IF EXISTS habitaciones_min,
    DROP COLUMN IF EXISTS banos_min,
    DROP COLUMN IF EXISTS piso_buscado,
    DROP COLUMN IF EXISTS cochera,
    DROP COLUMN IF EXISTS tipo_vehiculo,
    DROP COLUMN IF EXISTS mascotas,
    DROP COLUMN IF EXISTS extranjero,
    DROP COLUMN IF EXISTS estado;

-- Renombrar cochera_v3 → cochera
ALTER TABLE requerimientos_prospecto
    CHANGE cochera_v3 cochera VARCHAR(10) NOT NULL DEFAULT 'NO_TIENE';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PROSPECTOS — eliminar tiene_mascota (ya migrado a requerimientos)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE prospectos DROP COLUMN IF EXISTS tiene_mascota;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ÍNDICES DE PERFORMANCE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_prop_tipo      ON propiedades(tipo);
CREATE INDEX IF NOT EXISTS idx_prop_operacion ON propiedades(operacion);
CREATE INDEX IF NOT EXISTS idx_prop_estado    ON propiedades(estado);
CREATE INDEX IF NOT EXISTS idx_prop_precio    ON propiedades(precio);
CREATE INDEX IF NOT EXISTS idx_prop_piso      ON propiedades(piso);
CREATE INDEX IF NOT EXISTS idx_prop_cochera   ON propiedades(cochera);

CREATE INDEX IF NOT EXISTS idx_prosp_usuario  ON prospectos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_prosp_dni      ON prospectos(dni);
CREATE INDEX IF NOT EXISTS idx_prosp_celular  ON prospectos(celular);

CREATE INDEX IF NOT EXISTS idx_req_prospecto  ON requerimientos_prospecto(prospecto_id);
CREATE INDEX IF NOT EXISTS idx_req_presup     ON requerimientos_prospecto(presupuesto_max);
CREATE INDEX IF NOT EXISTS idx_req_cochera    ON requerimientos_prospecto(cochera);
CREATE INDEX IF NOT EXISTS idx_req_mascota    ON requerimientos_prospecto(requiere_propiedad_con_mascota);
CREATE INDEX IF NOT EXISTS idx_req_piso       ON requerimientos_prospecto(primer_piso);

CREATE INDEX IF NOT EXISTS idx_rqti_req       ON requerimiento_tipos_inmueble(requerimiento_id);
CREATE INDEX IF NOT EXISTS idx_rqti_tipo      ON requerimiento_tipos_inmueble(tipo_inmueble);

CREATE INDEX IF NOT EXISTS idx_citas_usuario   ON citas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_citas_fecha     ON citas(fecha);
CREATE INDEX IF NOT EXISTS idx_citas_estado    ON citas(estado);
CREATE INDEX IF NOT EXISTS idx_citas_prospecto ON citas(prospecto_id);
CREATE INDEX IF NOT EXISTS idx_citas_propiedad ON citas(propiedad_id);

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- FIN MIGRACIÓN v3
-- =============================================================================
