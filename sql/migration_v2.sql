-- =============================================================================
-- CorredorPro · Migración v2
-- Ejecutar sobre una BD existente que ya tiene corredor_pro.sql instalado.
--
-- NOTA: ADD COLUMN IF NOT EXISTS requiere MySQL 8.0+ / MariaDB 10.3.2+.
-- Si usas MySQL 5.7, ejecuta cada ALTER TABLE por separado y omite IF NOT EXISTS.
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- USUARIOS: campo username para login alternativo + correo pasa a ser nullable
-- (permite registro solo con username, solo con correo, o con ambos)
-- -----------------------------------------------------------------------------
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS username VARCHAR(80) NULL UNIQUE AFTER codigo;

ALTER TABLE usuarios
    MODIFY COLUMN correo VARCHAR(190) NULL UNIQUE;

-- -----------------------------------------------------------------------------
-- PROPIEDADES: nuevos campos de agua y servicios incluidos
-- -----------------------------------------------------------------------------
ALTER TABLE propiedades
    ADD COLUMN IF NOT EXISTS agua_a_consumo     TINYINT(1) NULL    AFTER agua_monto,
    ADD COLUMN IF NOT EXISTS servicios_incluidos TEXT       NULL    AFTER agua_a_consumo;

-- -----------------------------------------------------------------------------
-- PROSPECTOS: si el prospecto tiene mascota (para matching)
-- -----------------------------------------------------------------------------
ALTER TABLE prospectos
    ADD COLUMN IF NOT EXISTS tiene_mascota TINYINT(1) NOT NULL DEFAULT 0 AFTER observaciones;

-- -----------------------------------------------------------------------------
-- REQUERIMIENTOS: piso buscado y tipos múltiples de inmueble
-- -----------------------------------------------------------------------------
ALTER TABLE requerimientos_prospecto
    ADD COLUMN IF NOT EXISTS piso_buscado   VARCHAR(80) NULL AFTER banos_min,
    ADD COLUMN IF NOT EXISTS tipos_inmueble TEXT        NULL AFTER tipo_inmueble;

-- -----------------------------------------------------------------------------
-- COMISIONES: módulo de comisiones / finanzas de corredores
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comisiones (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    propiedad_id    INT            NOT NULL,
    usuario_id      INT            NOT NULL COMMENT 'Quien registra la comisión (puede ser admin o corredor)',
    cerrado_por_id  INT            NULL     COMMENT 'Corredor que cerró la operación (NULL si fue el admin)',
    tipo_operacion  VARCHAR(30)    NOT NULL DEFAULT 'Alquiler' COMMENT 'Venta | Alquiler',
    fecha           DATE           NOT NULL,
    monto_total     DECIMAL(14,2)  NOT NULL COMMENT 'Comisión total recibida',
    monto_corredor  DECIMAL(14,2)  NULL     COMMENT 'Parte del corredor',
    monto_admin     DECIMAL(14,2)  NULL     COMMENT 'Parte del administrador',
    observaciones   TEXT           NULL,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME       NULL     DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_comisiones_propiedad FOREIGN KEY (propiedad_id)   REFERENCES propiedades(id),
    CONSTRAINT fk_comisiones_usuario   FOREIGN KEY (usuario_id)     REFERENCES usuarios(id),
    CONSTRAINT fk_comisiones_corredor  FOREIGN KEY (cerrado_por_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- FIN DE MIGRACIÓN v2
-- =============================================================================
