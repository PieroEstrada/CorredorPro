<?php
declare(strict_types=1);

require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/parser_bridge.php';
require_once __DIR__ . '/matching.php';

cp_boot_session();

$route  = cp_api_route();
$method = cp_request_method();

// Ejecutar limpiezas diferidas pendientes en cada petición autenticada de lectura
// (no bloquea la respuesta porque típicamente no hay nada que limpiar)
$_cp_cleanup_done = false;

try {

    // =========================================================================
    // AUTH
    // =========================================================================

    if ($route === '/auth/login' && $method === 'POST') {
        $body     = cp_request_body();
        // Acepta el campo 'login' (correo o usuario) o el antiguo 'correo' por compatibilidad
        $login    = cp_nullable_string($body['login'] ?? $body['correo'] ?? null);
        $password = (string) ($body['password'] ?? '');

        if (!$login || $password === '') {
            cp_json_error('Usuario/correo y contraseña son obligatorios.', 422);
        }

        $user = cp_auth_attempt($login, $password);
        if (!$user) cp_json_error('Credenciales incorrectas.', 401);

        cp_run_pending_cleanups(cp_db());
        cp_json(['ok' => true, 'user' => $user]);
    }

    if ($route === '/auth/logout' && $method === 'POST') {
        cp_auth_logout();
        cp_json(['ok' => true]);
    }

    if ($route === '/auth/me' && $method === 'GET') {
        cp_json(['ok' => true, 'user' => cp_require_auth()]);
    }

    // =========================================================================
    // PARSER
    // =========================================================================

    if ($route === '/extract/anuncio' && $method === 'POST') {
        cp_require_auth();
        $body = cp_request_body();
        $text = cp_nullable_string($body['text'] ?? null);
        if (!$text) cp_json_error('Debes enviar el texto del anuncio.', 422);

        // Capturar errores del parser (Python no instalado, proc_open fallido, etc.)
        // y devolverlos como 422 con mensaje legible en lugar de 500 genérico.
        try {
            $result = cp_extract_from_announcement($text);
            cp_json(['ok' => true, 'data' => $result]);
        } catch (\RuntimeException $parserEx) {
            cp_write_log('parser', $parserEx->getMessage());
            cp_json_error(
                'El parser no pudo procesar el anuncio: ' . $parserEx->getMessage()
                . ' — Verifica que Python esté instalado y la variable CP_PYTHON_BIN en app/config.php.',
                422
            );
        }
    }

    // =========================================================================
    // PROPIEDADES
    // =========================================================================

    if ($route === '/propiedades' && $method === 'GET') {
        $user = cp_require_auth();
        $db   = cp_db();
        cp_run_pending_cleanups($db);

        $filters = [];
        $params  = [];

        if (!empty($_GET['tipo'])) {
            $tipo = $_GET['tipo'];
            // "Local" captura tanto "Local" como "Local comercial" en BD
            if (stripos($tipo, 'local') !== false) {
                $filters[] = "p.tipo LIKE '%Local%'";
            } else {
                $filters[] = 'p.tipo = ?';
                $params[]  = $tipo;
            }
        }
        if (!empty($_GET['operacion'])) {
            $filters[] = 'p.operacion = ?';
            $params[]  = $_GET['operacion'];
        }
        if (!empty($_GET['estado'])) {
            $filters[] = 'p.estado = ?';
            $params[]  = $_GET['estado'];
        }
        if (!empty($_GET['piso'])) {
            $filters[] = 'p.piso = ?';
            $params[]  = (int) $_GET['piso'];
        }
        if (!empty($_GET['precio_max'])) {
            $filters[] = 'p.precio <= ?';
            $params[]  = (float) $_GET['precio_max'];
        }
        if (!empty($_GET['cochera'])) {
            $coch = strtoupper($_GET['cochera']);
            if (in_array($coch, ['NO_TIENE', 'MOTO', 'CARRO'], true)) {
                $filters[] = 'p.cochera = ?';
                $params[]  = $coch;
            }
        }
        // Propiedades son visibles para todos los usuarios del sistema (no filtrar por usuario_id)

        $where = $filters ? 'WHERE ' . implode(' AND ', $filters) : '';
        $sql   = "SELECT p.*,
                    (SELECT fp.filename FROM fotos_propiedades fp
                     WHERE fp.propiedad_id = p.id AND fp.es_principal = 1 LIMIT 1) AS foto_principal
                  FROM propiedades p
                  {$where}
                  ORDER BY p.id DESC";

        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        foreach ($rows as &$row) {
            $row['referencias']         = cp_db_json_decode($row['referencias'] ?? null, []);
            $row['documentacion']       = cp_db_json_decode($row['documentacion'] ?? null, []);
            $row['uso_ideal']           = cp_db_json_decode($row['uso_ideal'] ?? null, []);
            $row['nacionalidades_aceptadas'] = cp_db_json_decode($row['nacionalidades_aceptadas'] ?? null, []);
        }
        unset($row);

        cp_json(['ok' => true, 'items' => $rows]);
    }

    if ($route === '/propiedades' && $method === 'POST') {
        $user = cp_require_auth();
        $body = cp_request_body();
        $db   = cp_db();

        $linkMaps = cp_nullable_string($body['link_maps'] ?? null);
        $coords   = $linkMaps
            ? cp_extract_coords_from_maps_link($linkMaps)
            : ['lat' => null, 'lng' => null];

        $codigo = cp_generate_code($db, 'propiedades', 'PROP');

        $stmt = $db->prepare("INSERT INTO propiedades (
            codigo, usuario_id, titulo, tipo, operacion, estado, precio, moneda,
            piso, area, area_construida, frente, fondo, izquierda, derecha,
            habitaciones, banos, medios_banos,
            sala, comedor, cocina, kitchenette, patio, jardin, balcon, terraza,
            lavanderia, tendedero, azotea, deposito, oficina,
            aire_acondicionado, ventilador_techo, amoblado, closets,
            reservorio_agua, agua_24h, cochera,
            seguridad, rejas, porton, internet_incluido, mantenimiento_incluido,
            agua_incluida, agua_monto, agua_a_consumo, servicios_incluidos, luz, luz_monto,
            mascotas, extranjeros, nacionalidades_aceptadas, ninos_permitidos,
            ubicacion, referencias, distrito, ciudad,
            mes_adelantado, mes_garantia, contrato_minimo,
            documentacion, uso_ideal, descripcion_original,
            parser_confianza, parser_evidencia, parser_faltantes, parser_advertencias,
            link_maps, latitud, longitud
        ) VALUES (
            :codigo, :usuario_id, :titulo, :tipo, :operacion, :estado, :precio, :moneda,
            :piso, :area, :area_construida, :frente, :fondo, :izquierda, :derecha,
            :habitaciones, :banos, :medios_banos,
            :sala, :comedor, :cocina, :kitchenette, :patio, :jardin, :balcon, :terraza,
            :lavanderia, :tendedero, :azotea, :deposito, :oficina,
            :aire_acondicionado, :ventilador_techo, :amoblado, :closets,
            :reservorio_agua, :agua_24h, :cochera,
            :seguridad, :rejas, :porton, :internet_incluido, :mantenimiento_incluido,
            :agua_incluida, :agua_monto, :agua_a_consumo, :servicios_incluidos, :luz, :luz_monto,
            :mascotas, :extranjeros, :nacionalidades_aceptadas, :ninos_permitidos,
            :ubicacion, :referencias, :distrito, :ciudad,
            :mes_adelantado, :mes_garantia, :contrato_minimo,
            :documentacion, :uso_ideal, :descripcion_original,
            :parser_confianza, :parser_evidencia, :parser_faltantes, :parser_advertencias,
            :link_maps, :latitud, :longitud
        )");

        $stmt->execute([
            'codigo'                  => $codigo,
            'usuario_id'              => (int) $user['id'],
            'titulo'                  => cp_nullable_string($body['titulo'] ?? null),
            'tipo'                    => cp_nullable_string($body['tipo'] ?? null),
            'operacion'               => cp_nullable_string($body['operacion'] ?? null),
            'estado'                  => cp_nullable_string($body['estado'] ?? 'Disponible') ?? 'Disponible',
            'precio'                  => cp_nullable_float($body['precio'] ?? null),
            'moneda'                  => cp_nullable_string($body['moneda'] ?? 'S/') ?? 'S/',
            'piso'                    => cp_nullable_int($body['piso'] ?? null),
            'area'                    => cp_nullable_float($body['area'] ?? null),
            'area_construida'         => cp_nullable_float($body['area_construida'] ?? null),
            'frente'                  => cp_nullable_float($body['frente'] ?? null),
            'fondo'                   => cp_nullable_float($body['fondo'] ?? null),
            'izquierda'               => cp_nullable_float($body['izquierda'] ?? null),
            'derecha'                 => cp_nullable_float($body['derecha'] ?? null),
            'habitaciones'            => cp_nullable_int($body['habitaciones'] ?? null),
            'banos'                   => cp_nullable_int($body['banos'] ?? null),
            'medios_banos'            => cp_nullable_int($body['medios_banos'] ?? null),
            'sala'                    => cp_bool_to_int($body['sala'] ?? null),
            'comedor'                 => cp_bool_to_int($body['comedor'] ?? null),
            'cocina'                  => cp_bool_to_int($body['cocina'] ?? null),
            'kitchenette'             => cp_bool_to_int($body['kitchenette'] ?? null),
            'patio'                   => cp_bool_to_int($body['patio'] ?? null),
            'jardin'                  => cp_bool_to_int($body['jardin'] ?? null),
            'balcon'                  => cp_bool_to_int($body['balcon'] ?? null),
            'terraza'                 => cp_bool_to_int($body['terraza'] ?? null),
            'lavanderia'              => cp_bool_to_int($body['lavanderia'] ?? null),
            'tendedero'               => cp_bool_to_int($body['tendedero'] ?? null),
            'azotea'                  => cp_bool_to_int($body['azotea'] ?? null),
            'deposito'                => cp_bool_to_int($body['deposito'] ?? null),
            'oficina'                 => cp_bool_to_int($body['oficina'] ?? null),
            'aire_acondicionado'      => cp_bool_to_int($body['aire_acondicionado'] ?? null),
            'ventilador_techo'        => cp_bool_to_int($body['ventilador_techo'] ?? null),
            'amoblado'                => cp_bool_to_int($body['amoblado'] ?? null),
            'closets'                 => cp_bool_to_int($body['closets'] ?? null),
            'reservorio_agua'         => cp_bool_to_int($body['reservorio_agua'] ?? null),
            'agua_24h'                => cp_bool_to_int($body['agua_24h'] ?? null),
            'cochera'                 => in_array($body['cochera'] ?? '', ['NO_TIENE','MOTO','CARRO'], true) ? $body['cochera'] : 'NO_TIENE',
            'seguridad'               => cp_bool_to_int($body['seguridad'] ?? null),
            'rejas'                   => cp_bool_to_int($body['rejas'] ?? null),
            'porton'                  => cp_bool_to_int($body['porton'] ?? null),
            'internet_incluido'       => cp_bool_to_int($body['internet_incluido'] ?? null),
            'mantenimiento_incluido'  => cp_bool_to_int($body['mantenimiento_incluido'] ?? null),
            'agua_incluida'           => cp_bool_to_int($body['agua_incluida'] ?? null),
            'agua_monto'              => cp_nullable_float($body['agua_monto'] ?? null),
            'agua_a_consumo'          => cp_bool_to_int($body['agua_a_consumo'] ?? null),
            'servicios_incluidos'     => cp_db_json_encode($body['servicios_incluidos'] ?? null),
            'luz'                     => cp_nullable_string($body['luz'] ?? null),
            'luz_monto'               => cp_nullable_float($body['luz_monto'] ?? null),
            'mascotas'                => cp_nullable_string($body['mascotas'] ?? 'No especificado') ?? 'No especificado',
            'extranjeros'             => cp_bool_to_int($body['extranjeros'] ?? false) ?? 0,
            'nacionalidades_aceptadas'=> cp_db_json_encode($body['nacionalidades_aceptadas'] ?? []),
            'ninos_permitidos'        => cp_nullable_string($body['ninos_permitidos'] ?? 'No especificado') ?? 'No especificado',
            'ubicacion'               => cp_nullable_string($body['ubicacion'] ?? null),
            'referencias'             => cp_db_json_encode($body['referencias'] ?? []),
            'distrito'                => cp_nullable_string($body['distrito'] ?? null),
            'ciudad'                  => cp_nullable_string($body['ciudad'] ?? 'Pucallpa') ?? 'Pucallpa',
            'mes_adelantado'          => cp_nullable_int($body['condiciones']['mes_adelantado'] ?? $body['mes_adelantado'] ?? null),
            'mes_garantia'            => cp_nullable_int($body['condiciones']['mes_garantia'] ?? $body['mes_garantia'] ?? null),
            'contrato_minimo'         => cp_nullable_string($body['condiciones']['contrato_minimo'] ?? $body['contrato_minimo'] ?? null),
            'documentacion'           => cp_db_json_encode($body['documentacion'] ?? []),
            'uso_ideal'               => cp_db_json_encode($body['uso_ideal'] ?? []),
            'descripcion_original'    => cp_nullable_string($body['descripcion_original'] ?? null),
            'parser_confianza'        => cp_db_json_encode($body['confianza'] ?? []),
            'parser_evidencia'        => cp_db_json_encode($body['evidencia'] ?? []),
            'parser_faltantes'        => cp_db_json_encode($body['faltantes'] ?? []),
            'parser_advertencias'     => cp_db_json_encode($body['advertencias'] ?? []),
            'link_maps'               => $linkMaps,
            'latitud'                 => $coords['lat'],
            'longitud'                => $coords['lng'],
        ]);

        $id = (int) $db->lastInsertId();
        cp_match_recompute_for_property($id);
        cp_json(['ok' => true, 'id' => $id, 'codigo' => $codigo]);
    }

    if (preg_match('#^/propiedades/(\d+)$#', $route, $m) && $method === 'GET') {
        $user = cp_require_auth();
        $db   = cp_db();
        $id   = (int) $m[1];

        $stmt = $db->prepare('SELECT * FROM propiedades WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) cp_json_error('Propiedad no encontrada.', 404);

        // Propiedades visibles para todos los usuarios (sin restricción por usuario_id)

        $row['referencias']              = cp_db_json_decode($row['referencias'] ?? null, []);
        $row['documentacion']            = cp_db_json_decode($row['documentacion'] ?? null, []);
        $row['uso_ideal']                = cp_db_json_decode($row['uso_ideal'] ?? null, []);
        $row['nacionalidades_aceptadas'] = cp_db_json_decode($row['nacionalidades_aceptadas'] ?? null, []);

        // Fotos
        $fStmt = $db->prepare('SELECT id, filename, es_principal, orden FROM fotos_propiedades WHERE propiedad_id = ? ORDER BY es_principal DESC, orden ASC');
        $fStmt->execute([$id]);
        $row['fotos'] = $fStmt->fetchAll();

        cp_json(['ok' => true, 'item' => $row]);
    }

    if (preg_match('#^/propiedades/(\d+)$#', $route, $m) && $method === 'PUT') {
        $user = cp_require_auth();
        $db   = cp_db();
        $body = cp_request_body();
        $id   = (int) $m[1];

        // Verificar que existe y que el usuario tiene permiso
        $prop = $db->prepare('SELECT id, usuario_id FROM propiedades WHERE id = ? LIMIT 1');
        $prop->execute([$id]);
        $prop = $prop->fetch();
        if (!$prop) cp_json_error('Propiedad no encontrada.', 404);
        if ($user['rol'] === 'corredor' && (int) $prop['usuario_id'] !== (int) $user['id']) {
            cp_json_error('Sin permiso.', 403);
        }

        $allowed = [
            'titulo', 'tipo', 'operacion', 'precio', 'moneda', 'piso', 'area', 'area_construida',
            'habitaciones', 'banos', 'medios_banos', 'mascotas',
            'luz', 'luz_monto', 'agua_monto', 'agua_a_consumo', 'agua_incluida',
            'internet_incluido', 'mantenimiento_incluido', 'cochera', 'porton', 'amoblado',
            'lavanderia', 'terraza', 'patio', 'seguridad', 'rejas', 'aire_acondicionado',
            'ubicacion', 'distrito', 'ciudad',
            'mes_adelantado', 'mes_garantia', 'contrato_minimo', 'descripcion_original',
            'ninos_permitidos', 'extranjeros', 'servicios_incluidos',
        ];

        $sets   = [];
        $values = [];

        foreach ($allowed as $field) {
            if (!array_key_exists($field, $body)) continue;
            $sets[]   = "{$field} = ?";
            $values[] = cp_clean_parser_value($body[$field]);
        }

        foreach (['referencias', 'documentacion', 'uso_ideal', 'nacionalidades_aceptadas'] as $jsonField) {
            if (array_key_exists($jsonField, $body)) {
                $sets[]   = "{$jsonField} = ?";
                $values[] = cp_db_json_encode($body[$jsonField]);
            }
        }

        // link_maps → extraer coords
        if (array_key_exists('link_maps', $body)) {
            $linkMaps = cp_nullable_string($body['link_maps']);
            $coords   = $linkMaps
                ? cp_extract_coords_from_maps_link($linkMaps)
                : ['lat' => null, 'lng' => null];
            $sets[]   = 'link_maps = ?';
            $values[] = $linkMaps;
            $sets[]   = 'latitud = ?';
            $values[] = $coords['lat'];
            $sets[]   = 'longitud = ?';
            $values[] = $coords['lng'];
        }

        if (!$sets) cp_json_error('No hay campos para actualizar.', 422);

        $values[] = $id;
        $stmt = $db->prepare('UPDATE propiedades SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE id = ?');
        $stmt->execute($values);

        cp_match_recompute_for_property($id);
        cp_json(['ok' => true]);
    }

    // PATCH /propiedades/{id}/estado  — cambiar estado (admin)
    if (preg_match('#^/propiedades/(\d+)/estado$#', $route, $m) && $method === 'PATCH') {
        $user = cp_require_admin();
        $db   = cp_db();
        $body = cp_request_body();
        $id   = (int) $m[1];

        $estado = cp_nullable_string($body['estado'] ?? null);
        if (!in_array($estado, ['Disponible', 'Alquilado', 'Vendido'], true)) {
            cp_json_error('Estado no válido. Use: Disponible, Alquilado, Vendido.', 422);
        }

        $current = $db->prepare('SELECT id FROM propiedades WHERE id = ? LIMIT 1');
        $current->execute([$id]);
        if (!$current->fetch()) cp_json_error('Propiedad no encontrada.', 404);

        $limpieza = null;
        if ($estado === 'Alquilado' || $estado === 'Vendido') {
            $limpieza = date('Y-m-d H:i:s', strtotime('+1 day'));
        }
        // Si vuelve a Disponible: limpieza_programada = NULL (se cancela)

        $db->prepare('UPDATE propiedades SET estado = ?, limpieza_programada = ?, updated_at = NOW() WHERE id = ?')
           ->execute([$estado, $limpieza, $id]);

        cp_json(['ok' => true, 'estado' => $estado, 'limpieza_programada' => $limpieza]);
    }

    // POST /propiedades/{id}/cerrar — cierre atómico: cambia estado + registra comisión (admin)
    if (preg_match('#^/propiedades/(\d+)/cerrar$#', $route, $m) && $method === 'POST') {
        $user = cp_require_admin();
        $db   = cp_db();
        $body = cp_request_body();
        $id   = (int) $m[1];

        $estado = cp_nullable_string($body['estado'] ?? null);
        if (!in_array($estado, ['Alquilado', 'Vendido'], true)) {
            cp_json_error('estado debe ser Alquilado o Vendido.', 422);
        }

        $prop = $db->prepare('SELECT id FROM propiedades WHERE id = ? LIMIT 1');
        $prop->execute([$id]);
        if (!$prop->fetch()) cp_json_error('Propiedad no encontrada.', 404);

        $tipoOp          = ($estado === 'Vendido') ? 'Venta' : 'Alquiler';
        $fecha           = cp_nullable_string($body['fecha'] ?? null) ?? cp_today();
        $montoTotal      = cp_nullable_float($body['monto_total'] ?? null);
        $responsableTipo = cp_nullable_string($body['responsable_tipo'] ?? 'admin') ?? 'admin';
        $cerradoPorId    = null;
        $corrExterno     = null;

        if ($responsableTipo === 'corredor_registrado') {
            $cerradoPorId = cp_nullable_int($body['cerrado_por_id'] ?? null);
            if (!$cerradoPorId) cp_json_error('cerrado_por_id es obligatorio para corredor registrado.', 422);
        } elseif ($responsableTipo === 'corredor_externo') {
            $corrExterno = cp_nullable_string($body['corredor_externo'] ?? null);
            if (!$corrExterno) cp_json_error('corredor_externo es obligatorio.', 422);
        }

        $pctCorredor   = cp_nullable_float($body['porcentaje_corredor'] ?? 0) ?? 0.0;
        $montoCorredor = cp_nullable_float($body['monto_corredor'] ?? null);
        $montoAdmin    = cp_nullable_float($body['monto_admin'] ?? null);

        // Auto-calcular desglose si se proveyó monto_total pero no el desglose
        if ($montoTotal !== null && $montoCorredor === null) {
            $montoCorredor = round($montoTotal * $pctCorredor / 100, 2);
            $montoAdmin    = round($montoTotal - $montoCorredor, 2);
        }

        $fechaPago     = cp_nullable_string($body['fecha_pago'] ?? null);
        $estadoPago    = in_array($body['estado_pago'] ?? '', ['Pendiente', 'Pagado'], true)
            ? $body['estado_pago'] : 'Pendiente';
        $observaciones = cp_nullable_string($body['observaciones'] ?? null);

        $db->beginTransaction();
        try {
            $limpieza = date('Y-m-d H:i:s', strtotime('+1 day'));
            $db->prepare('UPDATE propiedades SET estado = ?, limpieza_programada = ?, updated_at = NOW() WHERE id = ?')
               ->execute([$estado, $limpieza, $id]);

            $comisionId = null;
            if ($montoTotal !== null && $montoTotal > 0) {
                $stmt = $db->prepare(
                    'INSERT INTO comisiones
                     (propiedad_id, usuario_id, cerrado_por_id, corredor_externo, tipo_operacion,
                      fecha, monto_total, porcentaje_corredor, monto_corredor, monto_admin,
                      fecha_pago, estado_pago, observaciones)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $stmt->execute([
                    $id,
                    (int) $user['id'],
                    $cerradoPorId,
                    $corrExterno,
                    $tipoOp,
                    $fecha,
                    $montoTotal,
                    $pctCorredor,
                    $montoCorredor,
                    $montoAdmin,
                    $fechaPago,
                    $estadoPago,
                    $observaciones,
                ]);
                $comisionId = (int) $db->lastInsertId();
            }

            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }

        cp_json(['ok' => true, 'estado' => $estado, 'comision_id' => $comisionId, 'limpieza_programada' => $limpieza]);
    }

    // DELETE /propiedades/{id} — eliminación definitiva (admin)
    if (preg_match('#^/propiedades/(\d+)$#', $route, $m) && $method === 'DELETE') {
        $user = cp_require_admin();
        $db   = cp_db();
        $id   = (int) $m[1];

        $exists = $db->prepare('SELECT id FROM propiedades WHERE id = ? LIMIT 1');
        $exists->execute([$id]);
        if (!$exists->fetch()) cp_json_error('Propiedad no encontrada.', 404);

        // Eliminar fotos físicas y registros
        cp_delete_property_photos($db, $id);

        // Eliminar registros relacionados (FK)
        $db->prepare('DELETE FROM matches WHERE propiedad_id = ?')->execute([$id]);
        $db->prepare('DELETE FROM seguimientos WHERE propiedad_id = ?')->execute([$id]);
        $db->prepare('UPDATE citas SET propiedad_id = NULL WHERE propiedad_id = ?')->execute([$id]);

        // Eliminar la propiedad
        $db->prepare('DELETE FROM propiedades WHERE id = ?')->execute([$id]);

        cp_json(['ok' => true]);
    }

    // =========================================================================
    // FOTOS DE PROPIEDADES
    // =========================================================================

    if (preg_match('#^/propiedades/(\d+)/fotos$#', $route, $m) && $method === 'GET') {
        $user   = cp_require_auth();
        $db     = cp_db();
        $propId = (int) $m[1];

        $stmt = $db->prepare(
            'SELECT id, filename, es_principal, orden, created_at
             FROM fotos_propiedades WHERE propiedad_id = ?
             ORDER BY es_principal DESC, orden ASC'
        );
        $stmt->execute([$propId]);
        cp_json(['ok' => true, 'items' => $stmt->fetchAll()]);
    }

    if (preg_match('#^/propiedades/(\d+)/fotos$#', $route, $m) && $method === 'POST') {
        $user   = cp_require_auth();
        $db     = cp_db();
        $propId = (int) $m[1];

        // Verificar que la propiedad existe y el usuario tiene permiso
        $propRow = $db->prepare('SELECT id, usuario_id FROM propiedades WHERE id = ? LIMIT 1');
        $propRow->execute([$propId]);
        $propRow = $propRow->fetch();
        if (!$propRow) cp_json_error('Propiedad no encontrada.', 404);
        if ($user['rol'] !== 'admin') {
            cp_json_error('Solo administradores pueden subir fotos.', 403);
        }

        if (empty($_FILES['fotos'])) {
            cp_json_error('No se enviaron archivos. Usa el campo "fotos" o "fotos[]".', 422);
        }

        // Normalizar $_FILES a array multi-file
        $files = $_FILES['fotos'];
        if (!is_array($files['name'])) {
            $files = [
                'name'     => [$files['name']],
                'type'     => [$files['type']],
                'tmp_name' => [$files['tmp_name']],
                'error'    => [$files['error']],
                'size'     => [$files['size']],
            ];
        }

        $dir = CP_UPLOADS_PATH . DIRECTORY_SEPARATOR . 'propiedades' . DIRECTORY_SEPARATOR . $propId;
        if (!is_dir($dir)) {
            if (!@mkdir($dir, 0755, true)) {
                cp_json_error('No se pudo crear el directorio de uploads.', 500);
            }
        }

        // Crear .htaccess de seguridad en el directorio de la propiedad
        $htFile = $dir . DIRECTORY_SEPARATOR . '.htaccess';
        if (!file_exists($htFile)) {
            @file_put_contents($htFile, "Options -Indexes\nphp_flag engine off\n");
        }

        $uploaded  = [];
        $skipped   = [];

        $cntStmt = $db->prepare('SELECT COUNT(*) FROM fotos_propiedades WHERE propiedad_id = ?');
        $cntStmt->execute([$propId]);
        $totalFotas = (int) $cntStmt->fetchColumn();

        for ($i = 0, $n = count($files['name']); $i < $n; $i++) {
            if ((int) $files['error'][$i] !== UPLOAD_ERR_OK) {
                $skipped[] = ['name' => $files['name'][$i], 'reason' => 'error_upload'];
                continue;
            }

            // Validar tamaño
            if ((int) $files['size'][$i] > CP_FOTO_MAX_SIZE) {
                $skipped[] = ['name' => $files['name'][$i], 'reason' => 'tamaño excede 5MB'];
                continue;
            }

            // Validar extensión
            $ext = strtolower(pathinfo((string) $files['name'][$i], PATHINFO_EXTENSION));
            if (!in_array($ext, CP_FOTO_ALLOWED_EXT, true)) {
                $skipped[] = ['name' => $files['name'][$i], 'reason' => 'extensión no permitida'];
                continue;
            }

            // Validar tipo MIME real
            $finfo = new \finfo(FILEINFO_MIME_TYPE);
            $mime  = $finfo->file((string) $files['tmp_name'][$i]);
            if (!in_array($mime, CP_FOTO_ALLOWED_TYPES, true)) {
                $skipped[] = ['name' => $files['name'][$i], 'reason' => 'tipo MIME no permitido'];
                continue;
            }

            // Nombre seguro único
            $filename = sprintf('%s_%d.%s', uniqid('f', true), $propId, $ext);
            $dest     = $dir . DIRECTORY_SEPARATOR . $filename;

            if (!move_uploaded_file((string) $files['tmp_name'][$i], $dest)) {
                $skipped[] = ['name' => $files['name'][$i], 'reason' => 'no se pudo mover el archivo'];
                continue;
            }

            $isPrincipal = ($totalFotas === 0 && count($uploaded) === 0) ? 1 : 0;
            $orden       = $totalFotas + count($uploaded);

            $ins = $db->prepare(
                'INSERT INTO fotos_propiedades (propiedad_id, filename, es_principal, orden)
                 VALUES (?, ?, ?, ?)'
            );
            $ins->execute([$propId, $filename, $isPrincipal, $orden]);
            $fotoId    = (int) $db->lastInsertId();
            $uploaded[] = ['id' => $fotoId, 'filename' => $filename, 'es_principal' => $isPrincipal];
        }

        cp_json(['ok' => true, 'uploaded' => $uploaded, 'skipped' => $skipped]);
    }

    // DELETE /fotos/{id}
    if (preg_match('#^/fotos/(\d+)$#', $route, $m) && $method === 'DELETE') {
        $user = cp_require_auth();
        $db   = cp_db();
        $id   = (int) $m[1];

        $stmt = $db->prepare(
            'SELECT fp.*, p.usuario_id FROM fotos_propiedades fp
             JOIN propiedades p ON p.id = fp.propiedad_id
             WHERE fp.id = ? LIMIT 1'
        );
        $stmt->execute([$id]);
        $foto = $stmt->fetch();
        if (!$foto) cp_json_error('Foto no encontrada.', 404);

        if ($user['rol'] !== 'admin') {
            cp_json_error('Solo administradores pueden eliminar fotos.', 403);
        }

        // Eliminar archivo físico
        $path = CP_UPLOADS_PATH . DIRECTORY_SEPARATOR . 'propiedades'
              . DIRECTORY_SEPARATOR . $foto['propiedad_id']
              . DIRECTORY_SEPARATOR . $foto['filename'];
        cp_safe_delete_file($path);

        $db->prepare('DELETE FROM fotos_propiedades WHERE id = ?')->execute([$id]);

        // Si era principal, asignar nueva principal
        if ((int) $foto['es_principal'] === 1) {
            $next = $db->prepare(
                'SELECT id FROM fotos_propiedades WHERE propiedad_id = ? ORDER BY orden ASC LIMIT 1'
            );
            $next->execute([$foto['propiedad_id']]);
            $nextId = $next->fetchColumn();
            if ($nextId) {
                $db->prepare('UPDATE fotos_propiedades SET es_principal = 1 WHERE id = ?')
                   ->execute([$nextId]);
            }
        }

        cp_json(['ok' => true]);
    }

    // PUT /fotos/{id}/principal — marcar como foto principal
    if (preg_match('#^/fotos/(\d+)/principal$#', $route, $m) && $method === 'PUT') {
        $user = cp_require_auth();
        $db   = cp_db();
        $id   = (int) $m[1];

        $stmt = $db->prepare(
            'SELECT fp.*, p.usuario_id FROM fotos_propiedades fp
             JOIN propiedades p ON p.id = fp.propiedad_id
             WHERE fp.id = ? LIMIT 1'
        );
        $stmt->execute([$id]);
        $foto = $stmt->fetch();
        if (!$foto) cp_json_error('Foto no encontrada.', 404);

        if ($user['rol'] !== 'admin') {
            cp_json_error('Solo administradores pueden modificar fotos.', 403);
        }

        $db->prepare('UPDATE fotos_propiedades SET es_principal = 0 WHERE propiedad_id = ?')
           ->execute([$foto['propiedad_id']]);
        $db->prepare('UPDATE fotos_propiedades SET es_principal = 1 WHERE id = ?')
           ->execute([$id]);

        cp_json(['ok' => true]);
    }

    // =========================================================================
    // MAPA
    // =========================================================================

    if ($route === '/mapa/pins' && $method === 'GET') {
        cp_require_auth();
        $db   = cp_db();
        $stmt = $db->query(
            "SELECT p.id, p.codigo, p.titulo, p.precio, p.moneda, p.tipo, p.operacion, p.estado,
                    p.latitud, p.longitud, p.distrito, p.link_maps,
                    (SELECT fp.filename FROM fotos_propiedades fp
                     WHERE fp.propiedad_id = p.id AND fp.es_principal = 1 LIMIT 1) AS foto_principal
             FROM propiedades p
             WHERE p.latitud IS NOT NULL AND p.longitud IS NOT NULL
               AND p.estado != 'Inactivo'
             ORDER BY p.id DESC"
        );
        cp_json(['ok' => true, 'items' => $stmt->fetchAll()]);
    }

    // =========================================================================
    // USUARIOS  (administración — admin only, excepto cambio de propia contraseña)
    // =========================================================================

    if ($route === '/usuarios' && $method === 'GET') {
        cp_require_admin();
        $db   = cp_db();
        $stmt = $db->query(
            'SELECT id, codigo, username, nombre, correo, rol, activo, created_at, updated_at
             FROM usuarios ORDER BY id ASC'
        );
        cp_json(['ok' => true, 'items' => $stmt->fetchAll()]);
    }

    if ($route === '/usuarios' && $method === 'POST') {
        cp_require_admin();
        $body = cp_request_body();
        $db   = cp_db();

        $nombre   = cp_nullable_string($body['nombre'] ?? null);
        $correo   = cp_nullable_string($body['correo'] ?? null);
        $username = cp_nullable_string($body['username'] ?? null);
        $password = (string) ($body['password'] ?? '');
        $rol      = cp_nullable_string($body['rol'] ?? 'corredor') ?? 'corredor';

        if (!$nombre) cp_json_error('El nombre es obligatorio.', 422);
        if (!$correo && !$username) cp_json_error('Debes ingresar al menos un correo o un nombre de usuario.', 422);
        if ($correo && !filter_var($correo, FILTER_VALIDATE_EMAIL)) cp_json_error('El correo no tiene un formato válido.', 422);
        if (strlen($password) < 6) cp_json_error('La contraseña debe tener al menos 6 caracteres.', 422);
        if (!in_array($rol, ['admin', 'corredor'], true)) cp_json_error('Rol inválido.', 422);

        // Verificar unicidad de correo (solo si se proporcionó)
        if ($correo) {
            $exists = $db->prepare('SELECT id FROM usuarios WHERE correo = ? LIMIT 1');
            $exists->execute([$correo]);
            if ($exists->fetch()) cp_json_error('El correo ya está registrado.', 409);
        }

        // Verificar unicidad de username (solo si se proporcionó)
        if ($username) {
            $checkUser = $db->prepare('SELECT id FROM usuarios WHERE username = ? LIMIT 1');
            $checkUser->execute([$username]);
            if ($checkUser->fetch()) cp_json_error('El nombre de usuario ya está en uso.', 409);
        }

        $codigo = cp_generate_code($db, 'usuarios', 'USR');
        $stmt = $db->prepare(
            'INSERT INTO usuarios (codigo, username, nombre, correo, password_hash, rol, activo)
             VALUES (?, ?, ?, ?, ?, ?, 1)'
        );
        $stmt->execute([$codigo, $username, $nombre, $correo, password_hash($password, PASSWORD_DEFAULT), $rol]);
        cp_json(['ok' => true, 'id' => (int) $db->lastInsertId(), 'codigo' => $codigo]);
    }

    if (preg_match('#^/usuarios/(\d+)$#', $route, $m) && $method === 'GET') {
        cp_require_admin();
        $db   = cp_db();
        $stmt = $db->prepare(
            'SELECT id, codigo, username, nombre, correo, rol, activo, created_at, updated_at
             FROM usuarios WHERE id = ? LIMIT 1'
        );
        $stmt->execute([(int) $m[1]]);
        $u = $stmt->fetch();
        if (!$u) cp_json_error('Usuario no encontrado.', 404);
        cp_json(['ok' => true, 'item' => $u]);
    }

    if (preg_match('#^/usuarios/(\d+)$#', $route, $m) && $method === 'PUT') {
        cp_require_admin();
        $db   = cp_db();
        $body = cp_request_body();
        $id   = (int) $m[1];

        $sets   = [];
        $values = [];

        foreach (['nombre', 'correo', 'rol', 'username'] as $f) {
            if (!array_key_exists($f, $body)) continue;
            if ($f === 'correo' && !filter_var($body[$f], FILTER_VALIDATE_EMAIL)) {
                cp_json_error('Correo inválido.', 422);
            }
            if ($f === 'rol' && !in_array($body[$f], ['admin', 'corredor'], true)) {
                cp_json_error('Rol inválido.', 422);
            }
            $sets[]   = "{$f} = ?";
            $values[] = cp_nullable_string($body[$f]);
        }

        if (!$sets) cp_json_error('No hay campos para actualizar.', 422);

        $values[] = $id;
        $db->prepare('UPDATE usuarios SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE id = ?')
           ->execute($values);
        cp_json(['ok' => true]);
    }

    // PUT /usuarios/{id}/password
    if (preg_match('#^/usuarios/(\d+)/password$#', $route, $m) && $method === 'PUT') {
        $user = cp_require_auth();
        $db   = cp_db();
        $body = cp_request_body();
        $id   = (int) $m[1];

        $isAdmin   = $user['rol'] === 'admin';
        $isSelf    = (int) $user['id'] === $id;

        if (!$isAdmin && !$isSelf) cp_json_error('Sin permiso.', 403);

        $newPassword = (string) ($body['password'] ?? '');
        if (strlen($newPassword) < 6) cp_json_error('La contraseña debe tener al menos 6 caracteres.', 422);

        // Si no es admin, verificar contraseña actual
        if (!$isAdmin) {
            $current = (string) ($body['password_actual'] ?? '');
            $row = $db->prepare('SELECT password_hash FROM usuarios WHERE id = ? LIMIT 1');
            $row->execute([$id]);
            $row = $row->fetch();
            if (!$row || !password_verify($current, $row['password_hash'])) {
                cp_json_error('Contraseña actual incorrecta.', 401);
            }
        }

        $db->prepare('UPDATE usuarios SET password_hash = ?, updated_at = NOW() WHERE id = ?')
           ->execute([password_hash($newPassword, PASSWORD_DEFAULT), $id]);
        cp_json(['ok' => true]);
    }

    // PATCH /usuarios/{id}/estado
    if (preg_match('#^/usuarios/(\d+)/estado$#', $route, $m) && $method === 'PATCH') {
        $admin = cp_require_admin();
        $db    = cp_db();
        $body  = cp_request_body();
        $id    = (int) $m[1];

        if ((int) $admin['id'] === $id) cp_json_error('No puedes cambiar tu propio estado.', 422);

        $activo = isset($body['activo']) ? (int) $body['activo'] : null;
        if ($activo === null) cp_json_error('Campo "activo" es requerido (1 o 0).', 422);

        $db->prepare('UPDATE usuarios SET activo = ?, updated_at = NOW() WHERE id = ?')
           ->execute([$activo ? 1 : 0, $id]);
        cp_json(['ok' => true]);
    }

    // =========================================================================
    // PROSPECTOS
    // =========================================================================

    if ($route === '/prospectos' && $method === 'GET') {
        $user = cp_require_auth();
        $db   = cp_db();

        // Todos los roles ven SOLO sus propios prospectos (privacidad de clientes)
        $filters = ['p.usuario_id = ?'];
        $params  = [(int) $user['id']];

        // Filtros que requieren consulta a requerimientos_prospecto
        $reqConds  = [];
        $reqParams = [];

        if (!empty($_GET['tipo_inmueble'])) {
            $tipo = $_GET['tipo_inmueble'];
            // Busca en requerimiento_tipos_inmueble via sub-EXISTS
            if (stripos($tipo, 'local') !== false) {
                $reqConds[] = "EXISTS (SELECT 1 FROM requerimiento_tipos_inmueble rti WHERE rti.requerimiento_id = r.id AND rti.tipo_inmueble LIKE '%Local%')";
            } else {
                $reqConds[]  = "EXISTS (SELECT 1 FROM requerimiento_tipos_inmueble rti WHERE rti.requerimiento_id = r.id AND rti.tipo_inmueble = ?)";
                $reqParams[] = $tipo;
            }
        }
        if (!empty($_GET['cochera'])) {
            $coch = strtoupper($_GET['cochera']);
            if (in_array($coch, ['NO_TIENE', 'MOTO', 'CARRO'], true)) {
                $reqConds[]  = 'r.cochera = ?';
                $reqParams[] = $coch;
            }
        }
        if (!empty($_GET['mascota'])) {
            $reqConds[]  = 'r.requiere_propiedad_con_mascota = ?';
            $reqParams[] = (int) $_GET['mascota'];
        }
        if (!empty($_GET['primer_piso'])) {
            $reqConds[]  = 'r.primer_piso = 1';
        }
        if (!empty($_GET['presupuesto_max'])) {
            $reqConds[]  = 'r.presupuesto_max <= ?';
            $reqParams[] = (float) $_GET['presupuesto_max'];
        }

        if ($reqConds) {
            $reqWhere  = implode(' AND ', $reqConds);
            $filters[] = "EXISTS (SELECT 1 FROM requerimientos_prospecto r WHERE r.prospecto_id = p.id AND {$reqWhere})";
            foreach ($reqParams as $rp) {
                $params[] = $rp;
            }
        }

        $where = 'WHERE ' . implode(' AND ', $filters);
        $stmt  = $db->prepare("SELECT p.* FROM prospectos p {$where} ORDER BY p.id DESC");
        $stmt->execute($params);
        $items = $stmt->fetchAll();

        // Adjuntar resumen de requerimientos a cada prospecto (para mostrar en cards)
        if ($items) {
            $prospIds = array_column($items, 'id');
            $ph       = implode(',', array_fill(0, count($prospIds), '?'));
            $rStmt    = $db->prepare(
                "SELECT id, prospecto_id, presupuesto_max, cochera,
                        requiere_propiedad_con_mascota, primer_piso
                 FROM requerimientos_prospecto WHERE prospecto_id IN ({$ph}) ORDER BY id DESC"
            );
            $rStmt->execute($prospIds);
            $allReqs = $rStmt->fetchAll();

            if ($allReqs) {
                $rIds  = array_column($allReqs, 'id');
                $ph2   = implode(',', array_fill(0, count($rIds), '?'));
                $tStmt = $db->prepare(
                    "SELECT requerimiento_id, tipo_inmueble FROM requerimiento_tipos_inmueble WHERE requerimiento_id IN ({$ph2})"
                );
                $tStmt->execute($rIds);
                $tiposByReq = [];
                foreach ($tStmt->fetchAll() as $tr) {
                    $tiposByReq[(int) $tr['requerimiento_id']][] = $tr['tipo_inmueble'];
                }
                foreach ($allReqs as &$req) {
                    $req['tipos_inmueble'] = $tiposByReq[(int) $req['id']] ?? [];
                }
                unset($req);
            }

            $reqsByProsp = [];
            foreach ($allReqs as $req) {
                $reqsByProsp[(int) $req['prospecto_id']][] = $req;
            }
            foreach ($items as &$item) {
                $item['requerimientos'] = $reqsByProsp[(int) $item['id']] ?? [];
            }
            unset($item);
        }

        cp_json(['ok' => true, 'items' => $items]);
    }

    if ($route === '/prospectos' && $method === 'POST') {
        $user = cp_require_auth();
        $body = cp_request_body();
        $db   = cp_db();

        if (!cp_nullable_string($body['nombre'] ?? null)) cp_json_error('El nombre es obligatorio.', 422);

        $celular  = cp_nullable_string($body['celular'] ?? null);
        $whatsapp = cp_nullable_string($body['whatsapp'] ?? null) ?? $celular;
        $stmt = $db->prepare(
            'INSERT INTO prospectos (usuario_id, dni, nombre, celular, whatsapp, nacionalidad, observaciones)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            (int) $user['id'],
            cp_nullable_string($body['dni'] ?? null),
            cp_nullable_string($body['nombre'] ?? null),
            $celular,
            $whatsapp,
            cp_nullable_string($body['nacionalidad'] ?? null),
            cp_nullable_string($body['observaciones'] ?? null),
        ]);
        cp_json(['ok' => true, 'id' => (int) $db->lastInsertId()]);
    }

    if (preg_match('#^/prospectos/(\d+)$#', $route, $m) && $method === 'GET') {
        $user = cp_require_auth();
        $db   = cp_db();
        $id   = (int) $m[1];

        $stmt = $db->prepare('SELECT * FROM prospectos WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) cp_json_error('Prospecto no encontrado.', 404);

        // Todos los roles solo acceden a sus propios prospectos
        if ((int) $row['usuario_id'] !== (int) $user['id']) {
            cp_json_error('Sin permiso.', 403);
        }

        cp_json(['ok' => true, 'item' => $row]);
    }

    if (preg_match('#^/prospectos/(\d+)$#', $route, $m) && $method === 'PUT') {
        $user = cp_require_auth();
        $db   = cp_db();
        $body = cp_request_body();
        $id   = (int) $m[1];

        $allowed = ['nombre', 'dni', 'celular', 'whatsapp', 'nacionalidad', 'observaciones'];
        $sets    = [];
        $values  = [];

        foreach ($allowed as $f) {
            if (!array_key_exists($f, $body)) continue;
            $sets[]   = "{$f} = ?";
            $values[] = cp_nullable_string($body[$f]);
        }
        if (!$sets) cp_json_error('No hay campos para actualizar.', 422);

        $values[] = $id;
        $db->prepare('UPDATE prospectos SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE id = ?')
           ->execute($values);
        cp_json(['ok' => true]);
    }

    // GET /prospectos/{id}/comentarios
    if (preg_match('#^/prospectos/(\d+)/comentarios$#', $route, $m) && $method === 'GET') {
        cp_require_auth();
        $db   = cp_db();
        $id   = (int) $m[1];

        $stmt = $db->prepare(
            'SELECT pc.id, pc.comentario, pc.created_at,
                    u.nombre AS autor, u.rol AS autor_rol
             FROM prospecto_comentarios pc
             JOIN usuarios u ON u.id = pc.usuario_id
             WHERE pc.prospecto_id = ?
             ORDER BY pc.created_at DESC'
        );
        $stmt->execute([$id]);
        cp_json(['ok' => true, 'items' => $stmt->fetchAll()]);
    }

    // POST /prospectos/{id}/comentarios
    if (preg_match('#^/prospectos/(\d+)/comentarios$#', $route, $m) && $method === 'POST') {
        $user = cp_require_auth();
        $db   = cp_db();
        $body = cp_request_body();
        $id   = (int) $m[1];

        $comentario = cp_nullable_string($body['comentario'] ?? null);
        if (!$comentario) cp_json_error('El comentario no puede estar vacío.', 422);

        // Verificar que el prospecto existe
        $exists = $db->prepare('SELECT id FROM prospectos WHERE id = ? LIMIT 1');
        $exists->execute([$id]);
        if (!$exists->fetch()) cp_json_error('Prospecto no encontrado.', 404);

        $stmt = $db->prepare(
            'INSERT INTO prospecto_comentarios (prospecto_id, usuario_id, comentario)
             VALUES (?, ?, ?)'
        );
        $stmt->execute([$id, (int) $user['id'], $comentario]);
        cp_json(['ok' => true, 'id' => (int) $db->lastInsertId()]);
    }

    if (preg_match('#^/prospectos/(\d+)/requerimientos$#', $route, $m) && $method === 'GET') {
        cp_require_auth();
        $db         = cp_db();
        $prospId    = (int) $m[1];

        $stmt = $db->prepare('SELECT * FROM requerimientos_prospecto WHERE prospecto_id = ? ORDER BY id DESC');
        $stmt->execute([$prospId]);
        $items = $stmt->fetchAll();

        if ($items) {
            $reqIds       = array_column($items, 'id');
            $placeholders = implode(',', array_fill(0, count($reqIds), '?'));
            $tiposStmt    = $db->prepare(
                "SELECT requerimiento_id, tipo_inmueble FROM requerimiento_tipos_inmueble WHERE requerimiento_id IN ({$placeholders})"
            );
            $tiposStmt->execute($reqIds);
            $tiposByReq = [];
            foreach ($tiposStmt->fetchAll() as $tr) {
                $tiposByReq[(int) $tr['requerimiento_id']][] = $tr['tipo_inmueble'];
            }
            foreach ($items as &$item) {
                $item['tipos_inmueble'] = $tiposByReq[(int) $item['id']] ?? [];
            }
            unset($item);
        }

        cp_json(['ok' => true, 'items' => $items]);
    }

    if (preg_match('#^/prospectos/(\d+)/requerimientos$#', $route, $m) && $method === 'POST') {
        $user    = cp_require_auth();
        $db      = cp_db();
        $body    = cp_request_body();
        $prospId = (int) $m[1];

        // Verificar que el prospecto pertenece al usuario
        $own = $db->prepare('SELECT id FROM prospectos WHERE id = ? AND usuario_id = ? LIMIT 1');
        $own->execute([$prospId, (int) $user['id']]);
        if (!$own->fetch()) cp_json_error('Prospecto no encontrado.', 404);

        $cochera = $body['cochera'] ?? 'NO_TIENE';
        if (!in_array($cochera, ['NO_TIENE', 'MOTO', 'CARRO'], true)) $cochera = 'NO_TIENE';

        $stmt = $db->prepare(
            'INSERT INTO requerimientos_prospecto
             (prospecto_id, presupuesto_max, cochera, requiere_propiedad_con_mascota, primer_piso, observaciones)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $prospId,
            cp_nullable_float($body['presupuesto_max'] ?? null),
            $cochera,
            cp_bool_to_int($body['requiere_propiedad_con_mascota'] ?? false) ?? 0,
            cp_bool_to_int($body['primer_piso'] ?? false) ?? 0,
            cp_nullable_string($body['observaciones'] ?? null),
        ]);
        $reqId = (int) $db->lastInsertId();

        // Insertar tipos de inmueble
        $tipos = $body['tipos_inmueble'] ?? [];
        if (is_array($tipos) && !empty($tipos)) {
            $insT = $db->prepare('INSERT INTO requerimiento_tipos_inmueble (requerimiento_id, tipo_inmueble) VALUES (?, ?)');
            foreach ($tipos as $tipo) {
                $t = cp_nullable_string($tipo);
                if ($t) $insT->execute([$reqId, $t]);
            }
        }

        cp_json(['ok' => true, 'id' => $reqId]);
    }

    if (preg_match('#^/prospectos/(\d+)/requerimientos/(\d+)$#', $route, $m) && $method === 'PUT') {
        $user    = cp_require_auth();
        $db      = cp_db();
        $body    = cp_request_body();
        $prospId = (int) $m[1];
        $reqId   = (int) $m[2];

        // Verificar que pertenece al usuario
        $own = $db->prepare(
            'SELECT r.id FROM requerimientos_prospecto r
             JOIN prospectos p ON p.id = r.prospecto_id
             WHERE r.id = ? AND p.usuario_id = ? LIMIT 1'
        );
        $own->execute([$reqId, (int) $user['id']]);
        if (!$own->fetch()) cp_json_error('Requerimiento no encontrado.', 404);

        $cochera = $body['cochera'] ?? null;
        if ($cochera !== null && !in_array($cochera, ['NO_TIENE', 'MOTO', 'CARRO'], true)) $cochera = 'NO_TIENE';

        $sets   = [];
        $values = [];

        if ($cochera !== null)                              { $sets[] = 'cochera = ?';                         $values[] = $cochera; }
        if (array_key_exists('presupuesto_max', $body))    { $sets[] = 'presupuesto_max = ?';                 $values[] = cp_nullable_float($body['presupuesto_max']); }
        if (array_key_exists('requiere_propiedad_con_mascota', $body)) { $sets[] = 'requiere_propiedad_con_mascota = ?'; $values[] = cp_bool_to_int($body['requiere_propiedad_con_mascota']) ?? 0; }
        if (array_key_exists('primer_piso', $body))        { $sets[] = 'primer_piso = ?';                    $values[] = cp_bool_to_int($body['primer_piso']) ?? 0; }
        if (array_key_exists('observaciones', $body))      { $sets[] = 'observaciones = ?';                  $values[] = cp_nullable_string($body['observaciones']); }

        if ($sets) {
            $values[] = $reqId;
            $db->prepare('UPDATE requerimientos_prospecto SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE id = ?')
               ->execute($values);
        }

        // Reemplazar tipos si se envían
        if (array_key_exists('tipos_inmueble', $body)) {
            $db->prepare('DELETE FROM requerimiento_tipos_inmueble WHERE requerimiento_id = ?')->execute([$reqId]);
            $tipos = $body['tipos_inmueble'] ?? [];
            if (is_array($tipos) && !empty($tipos)) {
                $insT = $db->prepare('INSERT INTO requerimiento_tipos_inmueble (requerimiento_id, tipo_inmueble) VALUES (?, ?)');
                foreach ($tipos as $tipo) {
                    $t = cp_nullable_string($tipo);
                    if ($t) $insT->execute([$reqId, $t]);
                }
            }
        }

        cp_json(['ok' => true]);
    }

    if (preg_match('#^/prospectos/(\d+)/requerimientos/(\d+)$#', $route, $m) && $method === 'DELETE') {
        $user  = cp_require_auth();
        $db    = cp_db();
        $reqId = (int) $m[2];

        $own = $db->prepare(
            'SELECT r.id FROM requerimientos_prospecto r
             JOIN prospectos p ON p.id = r.prospecto_id
             WHERE r.id = ? AND p.usuario_id = ? LIMIT 1'
        );
        $own->execute([$reqId, (int) $user['id']]);
        if (!$own->fetch()) cp_json_error('Requerimiento no encontrado.', 404);

        // CASCADE eliminará requerimiento_tipos_inmueble automáticamente
        $db->prepare('DELETE FROM requerimientos_prospecto WHERE id = ?')->execute([$reqId]);
        cp_json(['ok' => true]);
    }

    // =========================================================================
    // SEGUIMIENTOS
    // =========================================================================

    if ($route === '/seguimientos' && $method === 'GET') {
        cp_require_auth();
        $db   = cp_db();
        $stmt = $db->query(
            'SELECT s.*, p.nombre AS prospecto_nombre, pr.titulo AS propiedad_titulo
             FROM seguimientos s
             LEFT JOIN prospectos p ON p.id = s.prospecto_id
             LEFT JOIN propiedades pr ON pr.id = s.propiedad_id
             ORDER BY s.fecha DESC, s.id DESC'
        );
        cp_json(['ok' => true, 'items' => $stmt->fetchAll()]);
    }

    if ($route === '/seguimientos' && $method === 'POST') {
        $user = cp_require_auth();
        $db   = cp_db();
        $body = cp_request_body();

        $stmt = $db->prepare(
            'INSERT INTO seguimientos (usuario_id, prospecto_id, propiedad_id, tipo, fecha, nota, resultado)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            (int) $user['id'],
            cp_nullable_int($body['prospecto_id'] ?? null),
            cp_nullable_int($body['propiedad_id'] ?? null),
            cp_nullable_string($body['tipo'] ?? 'Llamada') ?? 'Llamada',
            cp_nullable_string($body['fecha'] ?? cp_today()) ?? cp_today(),
            cp_nullable_string($body['nota'] ?? null),
            cp_nullable_string($body['resultado'] ?? null),
        ]);
        cp_json(['ok' => true, 'id' => (int) $db->lastInsertId()]);
    }

    // =========================================================================
    // CITAS
    // =========================================================================

    if ($route === '/citas' && $method === 'GET') {
        $user = cp_require_auth();
        $db   = cp_db();

        $filters = ['c.usuario_id = ?'];
        $params  = [(int) $user['id']];

        if (!empty($_GET['prospecto_id'])) {
            $filters[] = 'c.prospecto_id = ?';
            $params[]  = (int) $_GET['prospecto_id'];
        }
        if (!empty($_GET['estado'])) {
            $filters[] = 'c.estado = ?';
            $params[]  = $_GET['estado'];
        }
        if (!empty($_GET['fecha_desde'])) {
            $filters[] = 'c.fecha >= ?';
            $params[]  = $_GET['fecha_desde'];
        }
        if (!empty($_GET['fecha_hasta'])) {
            $filters[] = 'c.fecha <= ?';
            $params[]  = $_GET['fecha_hasta'];
        }

        $where = 'WHERE ' . implode(' AND ', $filters);
        $stmt  = $db->prepare(
            "SELECT c.*, p.nombre AS prospecto_nombre, p.celular AS prospecto_celular, p.whatsapp AS prospecto_whatsapp, pr.titulo AS propiedad_titulo
             FROM citas c
             LEFT JOIN prospectos p ON p.id = c.prospecto_id
             LEFT JOIN propiedades pr ON pr.id = c.propiedad_id
             {$where}
             ORDER BY c.fecha ASC, c.hora ASC"
        );
        $stmt->execute($params);
        cp_json(['ok' => true, 'items' => $stmt->fetchAll()]);
    }

    if ($route === '/citas' && $method === 'POST') {
        $user = cp_require_auth();
        $db   = cp_db();
        $body = cp_request_body();

        $stmt = $db->prepare(
            'INSERT INTO citas (usuario_id, prospecto_id, propiedad_id, titulo, tipo, fecha, hora, duracion_min, ubicacion, notas, estado)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            (int) $user['id'],
            cp_nullable_int($body['prospecto_id'] ?? null),
            cp_nullable_int($body['propiedad_id'] ?? null),
            cp_nullable_string($body['titulo'] ?? null),
            cp_nullable_string($body['tipo'] ?? 'Visita') ?? 'Visita',
            cp_nullable_string($body['fecha'] ?? cp_today()) ?? cp_today(),
            cp_nullable_string($body['hora'] ?? null),
            cp_nullable_int($body['duracion_min'] ?? 60) ?? 60,
            cp_nullable_string($body['ubicacion'] ?? null),
            cp_nullable_string($body['notas'] ?? null),
            cp_nullable_string($body['estado'] ?? 'Pendiente') ?? 'Pendiente',
        ]);
        cp_json(['ok' => true, 'id' => (int) $db->lastInsertId()]);
    }

    if (preg_match('#^/citas/(\d+)$#', $route, $m) && $method === 'PUT') {
        $user = cp_require_auth();
        $db   = cp_db();
        $body = cp_request_body();
        $id   = (int) $m[1];

        $cita = $db->prepare('SELECT id, usuario_id FROM citas WHERE id = ? LIMIT 1');
        $cita->execute([$id]);
        $cita = $cita->fetch();
        if (!$cita) cp_json_error('Cita no encontrada.', 404);
        if ((int) $cita['usuario_id'] !== (int) $user['id']) cp_json_error('Sin permiso.', 403);

        $allowed = ['titulo', 'tipo', 'fecha', 'hora', 'duracion_min', 'ubicacion', 'notas', 'estado'];
        $sets    = [];
        $values  = [];

        foreach ($allowed as $f) {
            if (!array_key_exists($f, $body)) continue;
            $sets[]   = "{$f} = ?";
            $values[] = $body[$f];
        }
        if (!$sets) cp_json_error('No hay campos para actualizar.', 422);

        $values[] = $id;
        $db->prepare('UPDATE citas SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE id = ?')
           ->execute($values);
        cp_json(['ok' => true]);
    }

    if (preg_match('#^/citas/(\d+)$#', $route, $m) && $method === 'DELETE') {
        $user = cp_require_auth();
        $db   = cp_db();
        $id   = (int) $m[1];

        $cita = $db->prepare('SELECT id, usuario_id FROM citas WHERE id = ? LIMIT 1');
        $cita->execute([$id]);
        $cita = $cita->fetch();
        if (!$cita) cp_json_error('Cita no encontrada.', 404);
        if ((int) $cita['usuario_id'] !== (int) $user['id']) cp_json_error('Sin permiso.', 403);

        $db->prepare('DELETE FROM citas WHERE id = ?')->execute([$id]);
        cp_json(['ok' => true]);
    }

    // =========================================================================
    // CITAS: PARSER DE PLANTILLA
    // Extrae datos de texto tipo plantilla y busca prospecto + propiedad
    // =========================================================================

    if ($route === '/citas/parse' && $method === 'POST') {
        $user = cp_require_auth();
        $db   = cp_db();
        $body = cp_request_body();
        $text = cp_nullable_string($body['text'] ?? null);
        if (!$text) cp_json_error('Debes enviar el texto de la cita.', 422);

        $parsed = cp_parse_cita_text($text);

        // Buscar prospecto por celular, luego por nombre
        $prospectos = [];
        if ($parsed['celular']) {
            $cel = preg_replace('/\D/', '', $parsed['celular']); // solo dígitos
            $stmt = $db->prepare(
                "SELECT id, nombre, celular, whatsapp FROM prospectos
                 WHERE usuario_id = ? AND (
                     REPLACE(REPLACE(REPLACE(celular,' ',''),'-',''),'(','') LIKE ?
                     OR REPLACE(REPLACE(REPLACE(whatsapp,' ',''),'-',''),'(','') LIKE ?
                 ) LIMIT 5"
            );
            $stmt->execute([(int) $user['id'], "%{$cel}%", "%{$cel}%"]);
            $prospectos = $stmt->fetchAll();
        }
        if (empty($prospectos) && $parsed['cliente']) {
            $stmt = $db->prepare(
                "SELECT id, nombre, celular, whatsapp FROM prospectos
                 WHERE usuario_id = ? AND nombre LIKE ? LIMIT 5"
            );
            $stmt->execute([(int) $user['id'], '%' . $parsed['cliente'] . '%']);
            $prospectos = $stmt->fetchAll();
        }

        // Buscar propiedad por texto libre (ubicación, referencias, título, descripción)
        $propiedades = [];
        $searchTerms = array_filter([
            $parsed['lugar'] ?? null,
        ]);
        if (!empty($searchTerms)) {
            $term = '%' . implode('%', $searchTerms) . '%';
            $baseSql = $user['rol'] === 'corredor'
                ? "AND p.usuario_id = {$user['id']}"
                : '';
            $stmt = $db->prepare(
                "SELECT p.id, p.codigo, p.titulo, p.precio, p.moneda, p.ubicacion, p.distrito, p.referencias, p.piso
                 FROM propiedades p
                 WHERE p.estado = 'Disponible' {$baseSql}
                   AND (p.titulo LIKE ? OR p.ubicacion LIKE ? OR p.referencias LIKE ? OR p.descripcion_original LIKE ?)
                 ORDER BY p.id DESC LIMIT 5"
            );
            $stmt->execute([$term, $term, $term, $term]);
            $propiedades = $stmt->fetchAll();
            foreach ($propiedades as &$prop) {
                $prop['referencias'] = cp_db_json_decode($prop['referencias'] ?? null, []);
            }
            unset($prop);
        }

        cp_json([
            'ok'          => true,
            'parsed'      => $parsed,
            'prospectos'  => $prospectos,
            'propiedades' => $propiedades,
        ]);
    }

    // =========================================================================
    // DASHBOARD
    // =========================================================================

    if ($route === '/dashboard' && $method === 'GET') {
        $user = cp_require_auth();
        $db   = cp_db();
        $uid  = (int) $user['id'];

        // Fecha de hoy en zona horaria de Perú (UTC-5)
        $now      = new \DateTimeImmutable('now', new \DateTimeZone('America/Lima'));
        $hoy      = $now->format('Y-m-d');
        $manana   = $now->modify('+1 day')->format('Y-m-d');
        $en7dias  = $now->modify('+7 days')->format('Y-m-d');

        // Citas de hoy
        $stmtHoy = $db->prepare(
            "SELECT c.*, p.nombre AS prospecto_nombre, p.celular AS prospecto_celular, p.whatsapp AS prospecto_whatsapp, pr.titulo AS propiedad_titulo
             FROM citas c
             LEFT JOIN prospectos p ON p.id = c.prospecto_id
             LEFT JOIN propiedades pr ON pr.id = c.propiedad_id
             WHERE c.usuario_id = ? AND c.fecha = ? AND c.estado != 'Cancelada'
             ORDER BY c.hora ASC"
        );
        $stmtHoy->execute([$uid, $hoy]);
        $citasHoy = $stmtHoy->fetchAll();

        // Próximas citas (mañana + 7 días, pendientes)
        $stmtProx = $db->prepare(
            "SELECT c.*, p.nombre AS prospecto_nombre, p.celular AS prospecto_celular, p.whatsapp AS prospecto_whatsapp, pr.titulo AS propiedad_titulo
             FROM citas c
             LEFT JOIN prospectos p ON p.id = c.prospecto_id
             LEFT JOIN propiedades pr ON pr.id = c.propiedad_id
             WHERE c.usuario_id = ? AND c.fecha > ? AND c.fecha <= ? AND c.estado = 'Pendiente'
             ORDER BY c.fecha ASC, c.hora ASC
             LIMIT 10"
        );
        $stmtProx->execute([$uid, $hoy, $en7dias]);
        $citasProximas = $stmtProx->fetchAll();

        // Conteos generales — propiedades son visibles para todos
        $totalProps = $db->prepare("SELECT COUNT(*) FROM propiedades WHERE estado = 'Disponible'");
        $totalProps->execute([]);

        $totalProsp = $db->prepare("SELECT COUNT(*) FROM prospectos WHERE usuario_id = ?");
        $totalProsp->execute([$uid]);

        $totalMatches = $db->prepare(
            "SELECT COUNT(*) FROM matches m
             INNER JOIN propiedades p ON p.id = m.propiedad_id
             WHERE p.usuario_id = ? AND m.visto = 0"
        );
        $totalMatches->execute([$uid]);

        cp_json([
            'ok'              => true,
            'hoy'             => $hoy,
            'citas_hoy'       => $citasHoy,
            'citas_proximas'  => $citasProximas,
            'resumen'         => [
                'propiedades_disponibles' => (int) $totalProps->fetchColumn(),
                'prospectos'              => (int) $totalProsp->fetchColumn(),
                'matches_nuevos'          => (int) $totalMatches->fetchColumn(),
            ],
        ]);
    }

    // =========================================================================
    // BLACKLIST
    // =========================================================================

    if ($route === '/blacklist' && $method === 'GET') {
        cp_require_auth();
        $db = cp_db();
        cp_json(['ok' => true, 'items' => $db->query('SELECT * FROM blacklist ORDER BY id DESC')->fetchAll()]);
    }

    if ($route === '/blacklist' && $method === 'POST') {
        $user = cp_require_auth();
        $db   = cp_db();
        $body = cp_request_body();

        $stmt = $db->prepare(
            'INSERT INTO blacklist (usuario_id, prospecto_id, nombre, telefono, motivo)
             VALUES (?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            (int) $user['id'],
            cp_nullable_int($body['prospecto_id'] ?? null),
            cp_nullable_string($body['nombre'] ?? null),
            cp_nullable_string($body['telefono'] ?? null),
            cp_nullable_string($body['motivo'] ?? null),
        ]);
        cp_json(['ok' => true, 'id' => (int) $db->lastInsertId()]);
    }

    // =========================================================================
    // MATCHES
    // =========================================================================

    if ($route === '/matches' && $method === 'GET') {
        $user = cp_require_auth();
        $min  = isset($_GET['min']) ? max(0, (int) $_GET['min']) : 30;
        // Cada usuario ve solo los matches de sus propias propiedades
        cp_json(['ok' => true, 'items' => cp_match_list($min, (int) $user['id'])]);
    }

    // GET /propiedades/{id}/matches — matches pre-computados de una propiedad (todos pueden ver)
    if (preg_match('#^/propiedades/(\d+)/matches$#', $route, $m) && $method === 'GET') {
        cp_require_auth();
        $db     = cp_db();
        $propId = (int) $m[1];
        $prop   = $db->prepare('SELECT id FROM propiedades WHERE id = ? LIMIT 1');
        $prop->execute([$propId]);
        if (!$prop->fetch()) cp_json_error('Propiedad no encontrada.', 404);
        cp_json(['ok' => true, 'items' => cp_match_list_for_property($propId)]);
    }

    // GET /propiedades/{id}/clientes-recomendados — cálculo live vs prospectos del usuario actual
    if (preg_match('#^/propiedades/(\d+)/clientes-recomendados$#', $route, $m) && $method === 'GET') {
        $user   = cp_require_auth();
        $db     = cp_db();
        $propId = (int) $m[1];

        $propStmt = $db->prepare('SELECT * FROM propiedades WHERE id = ? LIMIT 1');
        $propStmt->execute([$propId]);
        $property = $propStmt->fetch();
        if (!$property) cp_json_error('Propiedad no encontrada.', 404);

        // Requerimientos de prospectos del usuario actual
        $reqStmt = $db->prepare(
            "SELECT r.*, p.nombre AS prospecto_nombre, p.celular AS prospecto_celular,
                    p.whatsapp AS prospecto_whatsapp
             FROM requerimientos_prospecto r
             INNER JOIN prospectos p ON p.id = r.prospecto_id
             WHERE p.usuario_id = ?
             ORDER BY r.id DESC"
        );
        $reqStmt->execute([(int) $user['id']]);
        $requirements = $reqStmt->fetchAll();

        if (!$requirements) {
            cp_json(['ok' => true, 'items' => []]);
            return;
        }

        $reqIds = array_column($requirements, 'id');
        $ph     = implode(',', array_fill(0, count($reqIds), '?'));
        $tStmt  = $db->prepare(
            "SELECT requerimiento_id, tipo_inmueble FROM requerimiento_tipos_inmueble WHERE requerimiento_id IN ({$ph})"
        );
        $tStmt->execute($reqIds);
        $tiposByReq = [];
        foreach ($tStmt->fetchAll() as $tr) {
            $tiposByReq[(int) $tr['requerimiento_id']][] = $tr['tipo_inmueble'];
        }

        $results = [];
        foreach ($requirements as $req) {
            $req['tipos_inmueble'] = $tiposByReq[(int) $req['id']] ?? [];
            $match = cp_match_calculate($property, $req);
            if ($match['score'] < 25) continue;
            $razones = array_merge(
                $match['razones'],
                array_map(fn($r) => "— $r", $match['rechazos'])
            );
            $results[] = [
                'prospecto_id'       => (int) $req['prospecto_id'],
                'prospecto_nombre'   => $req['prospecto_nombre'],
                'prospecto_celular'  => $req['prospecto_celular'],
                'prospecto_whatsapp' => $req['prospecto_whatsapp'],
                'requerimiento_id'   => (int) $req['id'],
                'score'              => (int) $match['score'],
                'nivel'              => cp_match_nivel((int) $match['score']),
                'razones'            => $razones,
            ];
        }
        usort($results, fn($a, $b) => $b['score'] - $a['score']);
        cp_json(['ok' => true, 'items' => $results]);
    }

    // GET /prospectos/{id}/inmuebles-recomendados — propiedades compatibles con los requerimientos del prospecto
    if (preg_match('#^/prospectos/(\d+)/inmuebles-recomendados$#', $route, $m) && $method === 'GET') {
        $user    = cp_require_auth();
        $db      = cp_db();
        $prospId = (int) $m[1];

        // Verificar que el prospecto pertenece al usuario actual
        $own = $db->prepare('SELECT id FROM prospectos WHERE id = ? AND usuario_id = ? LIMIT 1');
        $own->execute([$prospId, (int) $user['id']]);
        if (!$own->fetch()) cp_json_error('Prospecto no encontrado.', 404);

        // Obtener requerimientos del prospecto
        $reqStmt = $db->prepare('SELECT * FROM requerimientos_prospecto WHERE prospecto_id = ? ORDER BY id DESC');
        $reqStmt->execute([$prospId]);
        $requirements = $reqStmt->fetchAll();

        if (!$requirements) {
            cp_json(['ok' => true, 'items' => [], 'sin_requerimientos' => true]);
            return;
        }

        // Cargar tipos para cada requerimiento
        $reqIds = array_column($requirements, 'id');
        $ph     = implode(',', array_fill(0, count($reqIds), '?'));
        $tStmt  = $db->prepare("SELECT requerimiento_id, tipo_inmueble FROM requerimiento_tipos_inmueble WHERE requerimiento_id IN ({$ph})");
        $tStmt->execute($reqIds);
        $tiposByReq = [];
        foreach ($tStmt->fetchAll() as $tr) {
            $tiposByReq[(int) $tr['requerimiento_id']][] = $tr['tipo_inmueble'];
        }
        foreach ($requirements as &$req) {
            $req['tipos_inmueble'] = $tiposByReq[(int) $req['id']] ?? [];
        }
        unset($req);

        // Obtener todas las propiedades disponibles
        $propStmt = $db->prepare("SELECT * FROM propiedades WHERE estado = 'Disponible' ORDER BY id DESC");
        $propStmt->execute();
        $properties = $propStmt->fetchAll();

        if (!$properties) {
            cp_json(['ok' => true, 'items' => []]);
            return;
        }

        // Foto principal por propiedad (una sola query)
        $propIds = array_column($properties, 'id');
        $fPh     = implode(',', array_fill(0, count($propIds), '?'));
        $fStmt   = $db->prepare("SELECT propiedad_id, filename FROM fotos_propiedades WHERE propiedad_id IN ({$fPh}) AND es_principal = 1");
        $fStmt->execute($propIds);
        $fotoByProp = [];
        foreach ($fStmt->fetchAll() as $f) {
            $fotoByProp[(int) $f['propiedad_id']] = $f['filename'];
        }

        // Calcular mejor score por propiedad (usando todos los requerimientos del prospecto)
        $results = [];
        foreach ($properties as $property) {
            $pid       = (int) $property['id'];
            $bestScore = 0;
            $bestRaz   = [];
            foreach ($requirements as $req) {
                $match = cp_match_calculate($property, $req);
                if ($match['score'] > $bestScore) {
                    $bestScore = $match['score'];
                    $bestRaz   = array_merge(
                        $match['razones'],
                        array_map(fn($r) => "— $r", $match['rechazos'])
                    );
                }
            }
            if ($bestScore < 25) continue;
            $results[] = [
                'propiedad_id'       => $pid,
                'propiedad_codigo'   => $property['codigo'],
                'propiedad_titulo'   => $property['titulo'],
                'propiedad_precio'   => $property['precio'],
                'propiedad_moneda'   => $property['moneda'] ?? 'S/',
                'propiedad_tipo'     => $property['tipo'],
                'propiedad_operacion'=> $property['operacion'],
                'propiedad_ubicacion'=> $property['ubicacion'] ?? $property['distrito'] ?? '',
                'foto_principal'     => $fotoByProp[$pid] ?? null,
                'score'              => $bestScore,
                'nivel'              => cp_match_nivel($bestScore),
                'razones'            => $bestRaz,
            ];
        }
        usort($results, fn($a, $b) => $b['score'] - $a['score']);
        cp_json(['ok' => true, 'items' => $results]);
    }

    // =========================================================================
    // COMISIONES
    // =========================================================================

    if ($route === '/comisiones' && $method === 'GET') {
        $user = cp_require_auth();
        $db   = cp_db();

        $filters = [];
        $params  = [];

        // Corredor solo ve sus propias comisiones
        if ($user['rol'] === 'corredor') {
            $filters[] = '(c.usuario_id = ? OR c.cerrado_por_id = ?)';
            $params[]  = (int) $user['id'];
            $params[]  = (int) $user['id'];
        }

        // Filtros opcionales
        if (!empty($_GET['tipo_operacion'])) {
            $filters[] = 'c.tipo_operacion = ?';
            $params[]  = $_GET['tipo_operacion'];
        }
        if (!empty($_GET['mes']) && !empty($_GET['anio'])) {
            $filters[] = 'MONTH(c.fecha) = ? AND YEAR(c.fecha) = ?';
            $params[]  = (int) $_GET['mes'];
            $params[]  = (int) $_GET['anio'];
        } elseif (!empty($_GET['anio'])) {
            $filters[] = 'YEAR(c.fecha) = ?';
            $params[]  = (int) $_GET['anio'];
        }
        if (!empty($_GET['corredor_id'])) {
            $filters[] = 'c.cerrado_por_id = ?';
            $params[]  = (int) $_GET['corredor_id'];
        }

        $where = $filters ? 'WHERE ' . implode(' AND ', $filters) : '';
        $sql   = "SELECT c.*,
                    pr.codigo AS propiedad_codigo, pr.titulo AS propiedad_titulo,
                    u.nombre  AS registrado_por_nombre,
                    cb.nombre AS cerrado_por_nombre
                  FROM comisiones c
                  INNER JOIN propiedades pr ON pr.id = c.propiedad_id
                  INNER JOIN usuarios    u  ON u.id  = c.usuario_id
                  LEFT  JOIN usuarios    cb ON cb.id = c.cerrado_por_id
                  {$where}
                  ORDER BY c.fecha DESC, c.id DESC";

        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $items = $stmt->fetchAll();

        // Resumen
        $totalTotal     = array_sum(array_column($items, 'monto_total'));
        $totalCorredor  = array_sum(array_column($items, 'monto_corredor'));
        $totalAdmin     = array_sum(array_column($items, 'monto_admin'));

        cp_json([
            'ok'      => true,
            'items'   => $items,
            'resumen' => [
                'total_comisiones' => count($items),
                'monto_total'      => $totalTotal,
                'monto_corredor'   => $totalCorredor,
                'monto_admin'      => $totalAdmin,
            ],
        ]);
    }

    if ($route === '/comisiones' && $method === 'POST') {
        $user = cp_require_auth();
        $body = cp_request_body();
        $db   = cp_db();

        $propId  = cp_nullable_int($body['propiedad_id'] ?? null);
        $fecha   = cp_nullable_string($body['fecha'] ?? cp_today());
        $monto   = cp_nullable_float($body['monto_total'] ?? null);
        $tipo    = cp_nullable_string($body['tipo_operacion'] ?? 'Alquiler') ?? 'Alquiler';

        if (!$propId) cp_json_error('propiedad_id es obligatorio.', 422);
        if ($monto === null || $monto <= 0) cp_json_error('monto_total debe ser mayor a 0.', 422);
        if (!in_array($tipo, ['Venta', 'Alquiler'], true)) {
            cp_json_error('tipo_operacion debe ser Venta o Alquiler.', 422);
        }

        // Verificar permiso sobre la propiedad
        $propRow = $db->prepare('SELECT usuario_id FROM propiedades WHERE id = ? LIMIT 1');
        $propRow->execute([$propId]);
        $propRow = $propRow->fetch();
        if (!$propRow) cp_json_error('Propiedad no encontrada.', 404);
        if ($user['rol'] === 'corredor' && (int) $propRow['usuario_id'] !== (int) $user['id']) {
            cp_json_error('Sin permiso sobre esta propiedad.', 403);
        }

        $cerradoPorId = cp_nullable_int($body['cerrado_por_id'] ?? null);
        $corrExterno  = cp_nullable_string($body['corredor_externo'] ?? null);
        // Si es corredor, la operación la cerró él mismo
        if ($user['rol'] === 'corredor') {
            $cerradoPorId = (int) $user['id'];
            $corrExterno  = null;
        }

        $pctCorredor   = cp_nullable_float($body['porcentaje_corredor'] ?? null);
        $montoCorredor = cp_nullable_float($body['monto_corredor'] ?? null);
        $montoAdmin    = cp_nullable_float($body['monto_admin'] ?? null);

        // Si no se especifica desglose, inferir automáticamente cuando es corredor
        if ($montoCorredor === null && $montoAdmin === null) {
            if ($cerradoPorId !== null && $cerradoPorId !== (int) $user['id']) {
                // Admin registra comisión de corredor; no infiere
            } elseif ($user['rol'] === 'corredor') {
                $montoCorredor = $monto;
                $montoAdmin    = 0;
            } else {
                $montoAdmin    = $monto;
                $montoCorredor = 0;
            }
        }

        $fechaPago  = cp_nullable_string($body['fecha_pago'] ?? null);
        $estadoPago = in_array($body['estado_pago'] ?? '', ['Pendiente', 'Pagado'], true)
            ? $body['estado_pago'] : 'Pendiente';

        $stmt = $db->prepare(
            'INSERT INTO comisiones
             (propiedad_id, usuario_id, cerrado_por_id, corredor_externo, tipo_operacion,
              fecha, monto_total, porcentaje_corredor, monto_corredor, monto_admin,
              fecha_pago, estado_pago, observaciones)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $propId,
            (int) $user['id'],
            $cerradoPorId,
            $corrExterno,
            $tipo,
            $fecha,
            $monto,
            $pctCorredor,
            $montoCorredor,
            $montoAdmin,
            $fechaPago,
            $estadoPago,
            cp_nullable_string($body['observaciones'] ?? null),
        ]);
        cp_json(['ok' => true, 'id' => (int) $db->lastInsertId()]);
    }

    if (preg_match('#^/comisiones/(\d+)$#', $route, $m) && $method === 'GET') {
        $user = cp_require_auth();
        $db   = cp_db();
        $id   = (int) $m[1];

        $stmt = $db->prepare(
            'SELECT c.*, pr.titulo AS propiedad_titulo, pr.codigo AS propiedad_codigo,
                    u.nombre AS registrado_por_nombre, cb.nombre AS cerrado_por_nombre
             FROM comisiones c
             INNER JOIN propiedades pr ON pr.id = c.propiedad_id
             INNER JOIN usuarios    u  ON u.id  = c.usuario_id
             LEFT  JOIN usuarios    cb ON cb.id = c.cerrado_por_id
             WHERE c.id = ? LIMIT 1'
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) cp_json_error('Comisión no encontrada.', 404);

        if ($user['rol'] === 'corredor'
            && (int) $row['usuario_id'] !== (int) $user['id']
            && (int) ($row['cerrado_por_id'] ?? 0) !== (int) $user['id']) {
            cp_json_error('Sin permiso.', 403);
        }
        cp_json(['ok' => true, 'item' => $row]);
    }

    if (preg_match('#^/comisiones/(\d+)$#', $route, $m) && $method === 'PUT') {
        $user = cp_require_auth();
        $db   = cp_db();
        $body = cp_request_body();
        $id   = (int) $m[1];

        $row = $db->prepare('SELECT * FROM comisiones WHERE id = ? LIMIT 1');
        $row->execute([$id]);
        $row = $row->fetch();
        if (!$row) cp_json_error('Comisión no encontrada.', 404);

        if ($user['rol'] === 'corredor' && (int) $row['usuario_id'] !== (int) $user['id']) {
            cp_json_error('Sin permiso.', 403);
        }

        $allowed = ['tipo_operacion', 'fecha', 'monto_total', 'porcentaje_corredor', 'monto_corredor', 'monto_admin',
                    'cerrado_por_id', 'corredor_externo', 'fecha_pago', 'estado_pago', 'observaciones'];
        $sets    = [];
        $values  = [];

        foreach ($allowed as $f) {
            if (!array_key_exists($f, $body)) continue;
            $sets[]   = "{$f} = ?";
            $values[] = $body[$f] === '' ? null : $body[$f];
        }
        if (!$sets) cp_json_error('No hay campos para actualizar.', 422);

        $values[] = $id;
        $db->prepare('UPDATE comisiones SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE id = ?')
           ->execute($values);
        cp_json(['ok' => true]);
    }

    if (preg_match('#^/comisiones/(\d+)$#', $route, $m) && $method === 'DELETE') {
        $user = cp_require_admin();
        $db   = cp_db();
        $id   = (int) $m[1];

        $exists = $db->prepare('SELECT id FROM comisiones WHERE id = ? LIMIT 1');
        $exists->execute([$id]);
        if (!$exists->fetch()) cp_json_error('Comisión no encontrada.', 404);

        $db->prepare('DELETE FROM comisiones WHERE id = ?')->execute([$id]);
        cp_json(['ok' => true]);
    }

    // =========================================================================
    // 404
    // =========================================================================

    cp_json_error('Ruta no encontrada.', 404);

} catch (\Throwable $e) {
    cp_write_log('api', $e->getMessage(), ['route' => $route, 'method' => $method, 'trace' => $e->getTraceAsString()]);
    cp_json_error('Error interno del servidor: ' . $e->getMessage(), 500);
}

// ── Helpers privados de API ────────────────────────────────────────────────

/**
 * Parsea el texto de plantilla de cita y extrae los campos conocidos.
 * Formato de referencia:
 *   VISITA: 29-03-2026
 *   HORA: 11:00 am
 *   LUGAR: Av Lloque Yupanqui 2do PISO (950)
 *   CLIENTE: Alexander Mori
 *   CELULAR: 992 596 825
 */
function cp_parse_cita_text(string $text): array
{
    $lines  = preg_split('/\r?\n/', trim($text));
    $result = [
        'tipo'    => 'Visita',
        'fecha'   => null,
        'hora'    => null,
        'lugar'   => null,
        'cliente' => null,
        'celular' => null,
        'monto'   => null,
    ];

    foreach ($lines as $line) {
        $line = trim($line);
        if (!$line) continue;

        // Separar clave: valor
        if (!preg_match('/^([^:]+):\s*(.+)$/u', $line, $m)) continue;
        $key = mb_strtolower(trim($m[1]));
        $val = trim($m[2]);

        if (in_array($key, ['visita','fecha','date'], true)) {
            $result['tipo']  = 'Visita';
            $result['fecha'] = cp_parse_date_str($val);
        } elseif (in_array($key, ['llamada'], true)) {
            $result['tipo']  = 'Llamada';
            $result['fecha'] = cp_parse_date_str($val);
        } elseif (in_array($key, ['reunión','reunion','meeting'], true)) {
            $result['tipo']  = 'Reunión';
            $result['fecha'] = cp_parse_date_str($val);
        } elseif (in_array($key, ['hora','hour','time'], true)) {
            $result['hora'] = cp_parse_time_str($val);
        } elseif (in_array($key, ['lugar','dirección','direccion','location','address','inmueble'], true)) {
            // Extraer monto entre paréntesis si existe: (950) → 950
            if (preg_match('/\((\d[\d\s,\.]*)\)\s*$/', $val, $pm)) {
                $result['monto'] = (float) preg_replace('/[\s,]/', '', $pm[1]);
                $val = trim(preg_replace('/\s*\(\d[\d\s,\.]*\)\s*$/', '', $val));
            }
            $result['lugar'] = $val;
        } elseif (in_array($key, ['cliente','client','nombre','name'], true)) {
            $result['cliente'] = $val;
        } elseif (in_array($key, ['celular','cel','teléfono','telefono','phone','whatsapp','wa'], true)) {
            $result['celular'] = $val;
        }
    }

    return $result;
}

function cp_parse_date_str(string $v): ?string
{
    $v = trim($v);
    // dd-mm-yyyy o dd/mm/yyyy
    if (preg_match('#^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$#', $v, $m)) {
        return sprintf('%04d-%02d-%02d', (int)$m[3], (int)$m[2], (int)$m[1]);
    }
    // yyyy-mm-dd
    if (preg_match('#^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$#', $v, $m)) {
        return sprintf('%04d-%02d-%02d', (int)$m[1], (int)$m[2], (int)$m[3]);
    }
    // dd de mes de yyyy (español)
    $meses = ['enero'=>1,'febrero'=>2,'marzo'=>3,'abril'=>4,'mayo'=>5,'junio'=>6,
              'julio'=>7,'agosto'=>8,'septiembre'=>9,'octubre'=>10,'noviembre'=>11,'diciembre'=>12];
    if (preg_match('/^(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})$/iu', $v, $m)) {
        $mes = $meses[mb_strtolower($m[2])] ?? null;
        if ($mes) return sprintf('%04d-%02d-%02d', (int)$m[3], $mes, (int)$m[1]);
    }
    return null;
}

function cp_parse_time_str(string $v): ?string
{
    $v = trim($v);
    // HH:MM am/pm
    if (preg_match('/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i', $v, $m)) {
        $h = (int)$m[1];
        $min = (int)$m[2];
        $period = strtolower($m[3] ?? '');
        if ($period === 'pm' && $h < 12) $h += 12;
        if ($period === 'am' && $h === 12) $h = 0;
        return sprintf('%02d:%02d:00', $h, $min);
    }
    // HH:MM:SS
    if (preg_match('/^(\d{1,2}):(\d{2}):(\d{2})$/', $v, $m)) {
        return sprintf('%02d:%02d:%02d', (int)$m[1], (int)$m[2], (int)$m[3]);
    }
    return null;
}

