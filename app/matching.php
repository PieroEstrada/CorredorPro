<?php
declare(strict_types=1);

require_once __DIR__ . '/db.php';

function cp_match_calculate(array $property, array $requirement): array
{
    $score = 0;
    $reasons = [];

    if (!empty($requirement['tipo_inmueble']) && !empty($property['tipo'])) {
        if (mb_strtolower((string) $requirement['tipo_inmueble']) === mb_strtolower((string) $property['tipo'])) {
            $score += 25;
            $reasons[] = 'Tipo coincide';
        }
    }

    if (!empty($requirement['operacion']) && !empty($property['operacion'])) {
        if (mb_strtolower((string) $requirement['operacion']) === mb_strtolower((string) $property['operacion'])) {
            $score += 20;
            $reasons[] = 'Operación coincide';
        }
    }

    if ($property['precio'] !== null && ($requirement['presupuesto_min'] !== null || $requirement['presupuesto_max'] !== null)) {
        $min = $requirement['presupuesto_min'] !== null ? (float) $requirement['presupuesto_min'] : 0;
        $max = $requirement['presupuesto_max'] !== null ? (float) $requirement['presupuesto_max'] : PHP_FLOAT_MAX;
        $price = (float) $property['precio'];

        if ($price >= $min && $price <= $max) {
            $score += 25;
            $reasons[] = 'Precio dentro del rango';
        } elseif ($price <= ($max * 1.1)) {
            $score += 10;
            $reasons[] = 'Precio cercano al rango';
        }
    }

    if ($property['habitaciones'] !== null && $requirement['habitaciones_min'] !== null) {
        if ((int) $property['habitaciones'] >= (int) $requirement['habitaciones_min']) {
            $score += 10;
            $reasons[] = 'Cumple habitaciones mínimas';
        }
    }

    if ($property['banos'] !== null && $requirement['banos_min'] !== null) {
        if ((int) $property['banos'] >= (int) $requirement['banos_min']) {
            $score += 10;
            $reasons[] = 'Cumple baños mínimos';
        }
    }

    if (!empty($requirement['zonas']) && !empty($property['ubicacion'])) {
        $zones = array_filter(array_map('trim', explode(',', (string) $requirement['zonas'])));
        foreach ($zones as $zone) {
            if (stripos((string) $property['ubicacion'], $zone) !== false || stripos((string) $property['distrito'], $zone) !== false) {
                $score += 10;
                $reasons[] = 'Zona compatible';
                break;
            }
        }
    }

    if (!empty($requirement['cochera']) && $requirement['cochera'] === 'Sí' && (int) ($property['cochera'] ?? 0) === 1) {
        $score += 5;
        $reasons[] = 'Tiene cochera';
    }

    return [
        'score' => min($score, 100),
        'razones' => $reasons,
    ];
}

function cp_match_recompute_for_property(int $propertyId): void
{
    $db = cp_db();

    $propertyStmt = $db->prepare('SELECT * FROM propiedades WHERE id = ? LIMIT 1');
    $propertyStmt->execute([$propertyId]);
    $property = $propertyStmt->fetch();

    if (!$property) {
        return;
    }

    $db->prepare('DELETE FROM matches WHERE propiedad_id = ?')->execute([$propertyId]);

    $requirements = $db->query(
        "SELECT r.*, p.id AS prospecto_id_real, p.estado AS prospecto_estado
         FROM requerimientos_prospecto r
         INNER JOIN prospectos p ON p.id = r.prospecto_id
         WHERE r.estado = 'Activo' AND p.estado <> 'Descartado'"
    )->fetchAll();

    $insert = $db->prepare(
        'INSERT INTO matches (propiedad_id, prospecto_id, requerimiento_id, score, razones, visto)
         VALUES (?, ?, ?, ?, ?, 0)'
    );

    foreach ($requirements as $requirement) {
        $match = cp_match_calculate($property, $requirement);
        if ($match['score'] < 40) {
            continue;
        }

        $insert->execute([
            $propertyId,
            (int) $requirement['prospecto_id_real'],
            (int) $requirement['id'],
            (int) $match['score'],
            cp_db_json_encode($match['razones']),
        ]);
    }
}

function cp_match_list(int $minScore = 40): array
{
    $db = cp_db();
    $stmt = $db->prepare(
        "SELECT
            m.*,
            pr.codigo AS propiedad_codigo,
            pr.titulo AS propiedad_titulo,
            pr.precio AS propiedad_precio,
            pr.moneda AS propiedad_moneda,
            pr.ubicacion AS propiedad_ubicacion,
            p.nombre AS prospecto_nombre,
            p.telefono AS prospecto_telefono
        FROM matches m
        INNER JOIN propiedades pr ON pr.id = m.propiedad_id
        INNER JOIN prospectos p ON p.id = m.prospecto_id
        WHERE m.score >= ?
        ORDER BY m.score DESC, m.id DESC"
    );
    $stmt->execute([$minScore]);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$row) {
        $row['razones'] = cp_db_json_decode($row['razones'], []);
    }

    return $rows;
}