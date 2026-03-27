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
        $correo   = cp_nullable_string($body['correo'] ?? null);
        $password = (string) ($body['password'] ?? '');

        if (!$correo || $password === '') {
            cp_json_error('Correo y contraseña son obligatorios.', 422);
        }

        $user = cp_auth_attempt($correo, $password);
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
            $filters[] = 'p.tipo = ?';
            $params[]  = $_GET['tipo'];
        }
        if (!empty($_GET['operacion'])) {
            $filters[] = 'p.operacion = ?';
            $params[]  = $_GET['operacion'];
        }
        if (!empty($_GET['estado'])) {
            $filters[] = 'p.estado = ?';
            $params[]  = $_GET['estado'];
        }
        // Corredor solo ve sus propiedades
        if ($user['rol'] === 'corredor') {
            $filters[] = 'p.usuario_id = ?';
            $params[]  = (int) $user['id'];
        }

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
            reservorio_agua, agua_24h, cochera, tipo_cochera, cantidad_vehiculos,
            seguridad, rejas, porton, internet_incluido, mantenimiento_incluido,
            agua_incluida, agua_monto, luz, luz_monto,
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
            :reservorio_agua, :agua_24h, :cochera, :tipo_cochera, :cantidad_vehiculos,
            :seguridad, :rejas, :porton, :internet_incluido, :mantenimiento_incluido,
            :agua_incluida, :agua_monto, :luz, :luz_monto,
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
            'cochera'                 => cp_bool_to_int($body['cochera'] ?? null),
            'tipo_cochera'            => cp_nullable_string($body['tipo_cochera'] ?? null),
            'cantidad_vehiculos'      => cp_nullable_int($body['cantidad_vehiculos'] ?? null),
            'seguridad'               => cp_bool_to_int($body['seguridad'] ?? null),
            'rejas'                   => cp_bool_to_int($body['rejas'] ?? null),
            'porton'                  => cp_bool_to_int($body['porton'] ?? null),
            'internet_incluido'       => cp_bool_to_int($body['internet_incluido'] ?? null),
            'mantenimiento_incluido'  => cp_bool_to_int($body['mantenimiento_incluido'] ?? null),
            'agua_incluida'           => cp_bool_to_int($body['agua_incluida'] ?? null),
            'agua_monto'              => cp_nullable_float($body['agua_monto'] ?? null),
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

        // Corredor solo puede ver sus propiedades
        if ($user['rol'] === 'corredor' && (int) $row['usuario_id'] !== (int) $user['id']) {
            cp_json_error('Sin permiso.', 403);
        }

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
            'habitaciones', 'banos', 'medios_banos', 'tipo_cochera', 'cantidad_vehiculos', 'mascotas',
            'luz', 'luz_monto', 'agua_monto', 'ubicacion', 'distrito', 'ciudad',
            'mes_adelantado', 'mes_garantia', 'contrato_minimo', 'descripcion_original',
            'ninos_permitidos', 'extranjeros',
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
        if ($user['rol'] === 'corredor' && (int) $propRow['usuario_id'] !== (int) $user['id']) {
            cp_json_error('Sin permiso.', 403);
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

        if ($user['rol'] === 'corredor' && (int) $foto['usuario_id'] !== (int) $user['id']) {
            cp_json_error('Sin permiso.', 403);
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

        if ($user['rol'] === 'corredor' && (int) $foto['usuario_id'] !== (int) $user['id']) {
            cp_json_error('Sin permiso.', 403);
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
            'SELECT id, codigo, nombre, correo, rol, activo, created_at, updated_at
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
        $password = (string) ($body['password'] ?? '');
        $rol      = cp_nullable_string($body['rol'] ?? 'corredor') ?? 'corredor';

        if (!$nombre) cp_json_error('El nombre es obligatorio.', 422);
        if (!$correo) cp_json_error('El correo es obligatorio.', 422);
        if (!filter_var($correo, FILTER_VALIDATE_EMAIL)) cp_json_error('Correo inválido.', 422);
        if (strlen($password) < 6) cp_json_error('La contraseña debe tener al menos 6 caracteres.', 422);
        if (!in_array($rol, ['admin', 'corredor'], true)) cp_json_error('Rol inválido.', 422);

        // Verificar que el correo no exista
        $exists = $db->prepare('SELECT id FROM usuarios WHERE correo = ? LIMIT 1');
        $exists->execute([$correo]);
        if ($exists->fetch()) cp_json_error('El correo ya está registrado.', 409);

        $codigo = cp_generate_code($db, 'usuarios', 'USR');
        $stmt = $db->prepare(
            'INSERT INTO usuarios (codigo, nombre, correo, password_hash, rol, activo)
             VALUES (?, ?, ?, ?, ?, 1)'
        );
        $stmt->execute([$codigo, $nombre, $correo, password_hash($password, PASSWORD_DEFAULT), $rol]);
        cp_json(['ok' => true, 'id' => (int) $db->lastInsertId(), 'codigo' => $codigo]);
    }

    if (preg_match('#^/usuarios/(\d+)$#', $route, $m) && $method === 'GET') {
        cp_require_admin();
        $db   = cp_db();
        $stmt = $db->prepare(
            'SELECT id, codigo, nombre, correo, rol, activo, created_at, updated_at
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

        foreach (['nombre', 'correo', 'rol'] as $f) {
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

        $filters = [];
        $params  = [];

        if ($user['rol'] === 'corredor') {
            $filters[] = 'usuario_id = ?';
            $params[]  = (int) $user['id'];
        }
        if (!empty($_GET['estado'])) {
            $filters[] = 'estado = ?';
            $params[]  = $_GET['estado'];
        }

        $where = $filters ? 'WHERE ' . implode(' AND ', $filters) : '';
        $stmt  = $db->prepare("SELECT * FROM prospectos {$where} ORDER BY id DESC");
        $stmt->execute($params);
        cp_json(['ok' => true, 'items' => $stmt->fetchAll()]);
    }

    if ($route === '/prospectos' && $method === 'POST') {
        $user = cp_require_auth();
        $body = cp_request_body();
        $db   = cp_db();

        if (!cp_nullable_string($body['nombre'] ?? null)) cp_json_error('El nombre es obligatorio.', 422);

        $codigo = cp_generate_code($db, 'prospectos', 'CLI');
        $stmt = $db->prepare(
            'INSERT INTO prospectos (codigo, usuario_id, nombre, telefono, whatsapp, correo, documento, nacionalidad, estado, fuente, observaciones)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $codigo,
            (int) $user['id'],
            cp_nullable_string($body['nombre'] ?? null),
            cp_nullable_string($body['telefono'] ?? null),
            cp_nullable_string($body['whatsapp'] ?? null),
            cp_nullable_string($body['correo'] ?? null),
            cp_nullable_string($body['documento'] ?? null),
            cp_nullable_string($body['nacionalidad'] ?? null),
            cp_nullable_string($body['estado'] ?? 'Nuevo') ?? 'Nuevo',
            cp_nullable_string($body['fuente'] ?? null),
            cp_nullable_string($body['observaciones'] ?? null),
        ]);
        cp_json(['ok' => true, 'id' => (int) $db->lastInsertId(), 'codigo' => $codigo]);
    }

    if (preg_match('#^/prospectos/(\d+)$#', $route, $m) && $method === 'GET') {
        $user = cp_require_auth();
        $db   = cp_db();
        $id   = (int) $m[1];

        $stmt = $db->prepare('SELECT * FROM prospectos WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) cp_json_error('Prospecto no encontrado.', 404);

        if ($user['rol'] === 'corredor' && (int) $row['usuario_id'] !== (int) $user['id']) {
            cp_json_error('Sin permiso.', 403);
        }

        cp_json(['ok' => true, 'item' => $row]);
    }

    if (preg_match('#^/prospectos/(\d+)$#', $route, $m) && $method === 'PUT') {
        $user = cp_require_auth();
        $db   = cp_db();
        $body = cp_request_body();
        $id   = (int) $m[1];

        $allowed = ['nombre', 'telefono', 'whatsapp', 'correo', 'documento', 'nacionalidad', 'estado', 'fuente', 'observaciones'];
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
        $db   = cp_db();
        $stmt = $db->prepare('SELECT * FROM requerimientos_prospecto WHERE prospecto_id = ? ORDER BY id DESC');
        $stmt->execute([(int) $m[1]]);
        cp_json(['ok' => true, 'items' => $stmt->fetchAll()]);
    }

    if (preg_match('#^/prospectos/(\d+)/requerimientos$#', $route, $m) && $method === 'POST') {
        cp_require_auth();
        $db   = cp_db();
        $body = cp_request_body();

        $stmt = $db->prepare(
            'INSERT INTO requerimientos_prospecto
            (prospecto_id, operacion, tipo_inmueble, presupuesto_min, presupuesto_max, moneda, zonas, habitaciones_min, banos_min, cochera, tipo_vehiculo, mascotas, extranjero, estado)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            (int) $m[1],
            cp_nullable_string($body['operacion'] ?? null),
            cp_nullable_string($body['tipo_inmueble'] ?? null),
            cp_nullable_float($body['presupuesto_min'] ?? null),
            cp_nullable_float($body['presupuesto_max'] ?? null),
            cp_nullable_string($body['moneda'] ?? 'S/') ?? 'S/',
            cp_nullable_string($body['zonas'] ?? null),
            cp_nullable_int($body['habitaciones_min'] ?? null),
            cp_nullable_int($body['banos_min'] ?? null),
            cp_nullable_string($body['cochera'] ?? null),
            cp_nullable_string($body['tipo_vehiculo'] ?? null),
            cp_nullable_string($body['mascotas'] ?? null),
            cp_nullable_string($body['extranjero'] ?? null),
            cp_nullable_string($body['estado'] ?? 'Activo') ?? 'Activo',
        ]);
        cp_json(['ok' => true, 'id' => (int) $db->lastInsertId()]);
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
        cp_require_auth();
        $db   = cp_db();
        $stmt = $db->query(
            'SELECT c.*, p.nombre AS prospecto_nombre, pr.titulo AS propiedad_titulo
             FROM citas c
             LEFT JOIN prospectos p ON p.id = c.prospecto_id
             LEFT JOIN propiedades pr ON pr.id = c.propiedad_id
             ORDER BY c.fecha ASC, c.hora ASC'
        );
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
        cp_require_auth();
        $db   = cp_db();
        $body = cp_request_body();
        $id   = (int) $m[1];

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
        cp_require_auth();
        $min = isset($_GET['min']) ? max(0, (int) $_GET['min']) : 40;
        cp_json(['ok' => true, 'items' => cp_match_list($min)]);
    }

    // =========================================================================
    // 404
    // =========================================================================

    cp_json_error('Ruta no encontrada.', 404);

} catch (\Throwable $e) {
    cp_write_log('api', $e->getMessage(), ['route' => $route, 'method' => $method, 'trace' => $e->getTraceAsString()]);
    cp_json_error('Error interno del servidor: ' . $e->getMessage(), 500);
}
