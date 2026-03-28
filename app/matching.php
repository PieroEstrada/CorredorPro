<?php
declare(strict_types=1);

require_once __DIR__ . '/db.php';

/**
 * Calcula un score de 0-100 entre una propiedad y un requerimiento.
 * $requirement['tipos_inmueble'] debe ser un array PHP (no JSON string).
 * Devuelve ['score' => int, 'razones' => string[], 'rechazos' => string[]]
 */
function cp_match_calculate(array $property, array $requirement): array
{
    $score    = 0;
    $razones  = [];
    $rechazos = [];

    // ── Tipo de inmueble ──────────────────────────────────────────────────────
    // tipos_inmueble viene como array PHP desde requerimiento_tipos_inmueble
    $propTipo   = mb_strtolower((string) ($property['tipo'] ?? ''));
    $tiposArray = $requirement['tipos_inmueble'] ?? [];
    if (!empty($tiposArray)) {
        $tiposNorm = array_map('mb_strtolower', (array) $tiposArray);
        if ($propTipo && in_array($propTipo, $tiposNorm, true)) {
            $score   += 25;
            $razones[] = 'Tipo coincide';
        } else {
            $rechazos[] = 'Tipo no coincide';
        }
    }

    // ── Precio / presupuesto ──────────────────────────────────────────────────
    if ($property['precio'] !== null && $requirement['presupuesto_max'] !== null) {
        $max   = (float) $requirement['presupuesto_max'];
        $price = (float) $property['precio'];

        if ($price <= $max) {
            $score   += 20;
            $razones[] = 'Precio dentro del presupuesto';
        } elseif ($price <= ($max * 1.1)) {
            $score   += 8;
            $razones[] = 'Precio cercano al presupuesto';
        } else {
            $rechazos[] = 'Excede el presupuesto';
        }
    }

    // ── Cochera ───────────────────────────────────────────────────────────────
    // Ambos usan: NO_TIENE | MOTO | CARRO
    $reqCochera  = mb_strtoupper(trim((string) ($requirement['cochera'] ?? 'NO_TIENE')));
    $propCochera = mb_strtoupper(trim((string) ($property['cochera'] ?? 'NO_TIENE')));

    if ($reqCochera !== 'NO_TIENE') {
        if ($propCochera === 'NO_TIENE') {
            $rechazos[] = 'No tiene cochera';
        } elseif ($reqCochera === $propCochera) {
            $score   += 10;
            $razones[] = 'Cochera compatible';
        } elseif ($propCochera === 'CARRO' && $reqCochera === 'MOTO') {
            // Cochera de carro también sirve para moto
            $score   += 7;
            $razones[] = 'Tiene cochera (mayor capacidad)';
        } else {
            // Pide carro, tiene solo moto
            $score   += 2;
            $razones[] = 'Tiene cochera (capacidad menor)';
        }
    }

    // ── Mascotas ──────────────────────────────────────────────────────────────
    $reqMascota  = (int) ($requirement['requiere_propiedad_con_mascota'] ?? 0);
    $propMascotas = mb_strtolower(trim((string) ($property['mascotas'] ?? 'no especificado')));

    if ($reqMascota === 1) {
        if ($propMascotas === 'sí' || $propMascotas === 'si') {
            $score   += 5;
            $razones[] = 'Acepta mascotas';
        } elseif ($propMascotas === 'no') {
            $score   -= 20;
            $rechazos[] = 'No acepta mascotas (penalización)';
        }
        // 'no especificado' → neutro
    }

    // ── Primer piso ───────────────────────────────────────────────────────────
    $reqPrimerPiso = (int) ($requirement['primer_piso'] ?? 0);
    $propPiso      = (int) ($property['piso'] ?? 0);

    if ($reqPrimerPiso === 1) {
        if ($propPiso === 1) {
            $score   += 5;
            $razones[] = 'Es primer piso';
        } elseif ($propPiso > 1) {
            $rechazos[] = 'No es primer piso';
        }
    }

    return [
        'score'    => max(0, min($score, 100)),
        'razones'  => $razones,
        'rechazos' => $rechazos,
    ];
}

/**
 * Nivel de interés según score.
 */
function cp_match_nivel(int $score): string
{
    if ($score >= 80) return 'Alto interés';
    if ($score >= 60) return 'Medio interés';
    if ($score >= 40) return 'Bajo interés';
    return 'No compatible';
}

/**
 * Recalcula todos los matches de una propiedad.
 * Solo cruza contra prospectos del mismo usuario dueño de la propiedad.
 */
function cp_match_recompute_for_property(int $propertyId): void
{
    $db = cp_db();

    $propertyStmt = $db->prepare('SELECT * FROM propiedades WHERE id = ? LIMIT 1');
    $propertyStmt->execute([$propertyId]);
    $property = $propertyStmt->fetch();

    if (!$property) {
        return;
    }

    $ownerUserId = (int) $property['usuario_id'];

    // Eliminar matches previos de esta propiedad
    $db->prepare('DELETE FROM matches WHERE propiedad_id = ?')->execute([$propertyId]);

    // Requerimientos de prospectos que pertenecen al mismo usuario
    $reqStmt = $db->prepare(
        "SELECT r.*
         FROM requerimientos_prospecto r
         INNER JOIN prospectos p ON p.id = r.prospecto_id
         WHERE p.usuario_id = ?"
    );
    $reqStmt->execute([$ownerUserId]);
    $requirements = $reqStmt->fetchAll();

    if (!$requirements) {
        return;
    }

    // Obtener todos los tipos en una sola consulta
    $reqIds       = array_column($requirements, 'id');
    $placeholders = implode(',', array_fill(0, count($reqIds), '?'));
    $tiposStmt    = $db->prepare(
        "SELECT requerimiento_id, tipo_inmueble
         FROM requerimiento_tipos_inmueble
         WHERE requerimiento_id IN ({$placeholders})"
    );
    $tiposStmt->execute($reqIds);

    $tiposByReq = [];
    foreach ($tiposStmt->fetchAll() as $tr) {
        $tiposByReq[(int) $tr['requerimiento_id']][] = $tr['tipo_inmueble'];
    }

    $insert = $db->prepare(
        'INSERT INTO matches (propiedad_id, prospecto_id, requerimiento_id, score, razones, visto)
         VALUES (?, ?, ?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE score = VALUES(score), razones = VALUES(razones), updated_at = NOW()'
    );

    foreach ($requirements as $requirement) {
        $requirement['tipos_inmueble'] = $tiposByReq[(int) $requirement['id']] ?? [];

        $match = cp_match_calculate($property, $requirement);
        if ($match['score'] < 30) {
            continue;
        }

        $razones = array_merge(
            $match['razones'],
            array_map(fn($r) => "— $r", $match['rechazos'])
        );

        $insert->execute([
            $propertyId,
            (int) $requirement['prospecto_id'],
            (int) $requirement['id'],
            (int) $match['score'],
            cp_db_json_encode($razones),
        ]);
    }
}

/**
 * Lista matches filtrando por usuario dueño de las propiedades.
 * Si $userId es null, devuelve todos (solo para uso interno).
 */
function cp_match_list(int $minScore = 30, ?int $userId = null): array
{
    $db = cp_db();

    $userFilter = $userId !== null ? 'AND pr.usuario_id = ?' : '';
    $params     = [$minScore];
    if ($userId !== null) $params[] = $userId;

    $stmt = $db->prepare(
        "SELECT
            m.*,
            pr.codigo    AS propiedad_codigo,
            pr.titulo    AS propiedad_titulo,
            pr.precio    AS propiedad_precio,
            pr.moneda    AS propiedad_moneda,
            pr.ubicacion AS propiedad_ubicacion,
            pr.tipo      AS propiedad_tipo,
            p.nombre     AS prospecto_nombre,
            p.celular    AS prospecto_celular,
            p.whatsapp   AS prospecto_whatsapp
        FROM matches m
        INNER JOIN propiedades pr ON pr.id = m.propiedad_id
        INNER JOIN prospectos  p  ON p.id  = m.prospecto_id
        WHERE m.score >= ?
          {$userFilter}
        ORDER BY m.score DESC, m.id DESC"
    );
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$row) {
        $row['razones'] = cp_db_json_decode($row['razones'], []);
        $row['nivel']   = cp_match_nivel((int) $row['score']);
    }
    unset($row);

    return $rows;
}

/**
 * Matches de una propiedad específica para mostrar en el detalle.
 * Solo devuelve los correspondientes al dueño de la propiedad.
 */
function cp_match_list_for_property(int $propertyId): array
{
    $db = cp_db();

    $stmt = $db->prepare(
        "SELECT
            m.*,
            p.nombre  AS prospecto_nombre,
            p.celular AS prospecto_celular,
            p.whatsapp AS prospecto_whatsapp
        FROM matches m
        INNER JOIN prospectos p ON p.id = m.prospecto_id
        WHERE m.propiedad_id = ?
        ORDER BY m.score DESC"
    );
    $stmt->execute([$propertyId]);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$row) {
        $row['razones'] = cp_db_json_decode($row['razones'], []);
        $row['nivel']   = cp_match_nivel((int) $row['score']);
    }
    unset($row);

    return $rows;
}
