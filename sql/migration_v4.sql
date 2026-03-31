-- =============================================================================
-- CorredorPro · Migración v4
-- Extiende tabla comisiones: responsable externo, porcentaje, fecha/estado pago.
--
-- EJECUTAR sobre BD que ya tiene migration_v3 aplicada.
-- Compatible con MySQL 8.0+ y MariaDB 10.3.2+
-- Ejecutar: mysql -u user -p db < migration_v4.sql
-- =============================================================================

SET NAMES utf8mb4;

ALTER TABLE comisiones
    ADD COLUMN IF NOT EXISTS porcentaje_corredor DECIMAL(5,2)   NULL
        COMMENT '% de la comisión base que corresponde al corredor'     AFTER monto_admin,
    ADD COLUMN IF NOT EXISTS corredor_externo    VARCHAR(150)   NULL
        COMMENT 'Nombre del corredor no registrado en el sistema'       AFTER porcentaje_corredor,
    ADD COLUMN IF NOT EXISTS fecha_pago          DATE           NULL
        COMMENT 'Fecha en que se pagó o se prevé pagar'                 AFTER corredor_externo,
    ADD COLUMN IF NOT EXISTS estado_pago         VARCHAR(20)    NOT NULL DEFAULT 'Pendiente'
        COMMENT 'Pendiente | Pagado'                                    AFTER fecha_pago;

CREATE INDEX IF NOT EXISTS idx_com_estado_pago ON comisiones(estado_pago);
CREATE INDEX IF NOT EXISTS idx_com_fecha       ON comisiones(fecha);

-- =============================================================================
-- FIN MIGRACIÓN v4
-- =============================================================================
