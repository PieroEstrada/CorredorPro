<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

/**
 * Extrae datos de un anuncio inmobiliario.
 * Estrategia: intenta Python primero; si no está disponible usa el extractor PHP interno.
 */
function cp_extract_from_announcement(string $text): array
{
    $text = trim($text);
    if ($text === '') {
        throw new RuntimeException('El texto del anuncio está vacío.');
    }

    $payload = json_encode(['text' => $text], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($payload === false) {
        throw new RuntimeException('No se pudo serializar la entrada del parser.');
    }

    // ── Intentar con Python ───────────────────────────────────────────────────
    if (function_exists('proc_open')) {
        $commands = cp_python_candidate_commands();
        foreach ($commands as $command) {
            try {
                $result = cp_run_process($command, $payload, CP_PYTHON_TIMEOUT);
            } catch (\RuntimeException $e) {
                cp_write_log('parser', 'proc_open falló: ' . $e->getMessage(), ['cmd' => $command]);
                continue;
            }

            if ($result['exit_code'] !== 0 || $result['stdout'] === '') {
                cp_write_log('parser', 'Python salió con error o sin salida', [
                    'cmd'  => $command,
                    'exit' => $result['exit_code'],
                    'err'  => $result['stderr'],
                ]);
                continue;
            }

            $decoded = json_decode($result['stdout'], true);
            if (!is_array($decoded)) {
                cp_write_log('parser', 'Salida Python no es JSON válido', [
                    'stdout' => mb_substr($result['stdout'], 0, 200),
                ]);
                continue;
            }

            if (!empty($decoded['error'])) {
                cp_write_log('parser', 'Python devolvió error en JSON', ['error' => $decoded['error']]);
                break; // No reintentar si el script corrió pero devolvió error lógico
            }

            cp_write_log('parser', 'Python OK', ['cmd' => $command]);
            return $decoded;
        }

        cp_write_log('parser', 'Python no disponible, usando extractor PHP');
    }

    // ── Fallback: extractor PHP interno ──────────────────────────────────────
    return cp_extract_php($text);
}

// ─── Comandos candidatos Python ────────────────────────────────────────────────

function cp_python_candidate_commands(): array
{
    $script   = CP_PYTHON_SCRIPT;
    $commands = [];

    $configured = trim(CP_PYTHON_BIN);
    if ($configured !== '') {
        $commands[] = escapeshellarg($configured) . ' ' . escapeshellarg($script);
    }

    // Rutas comunes en Windows donde XAMPP/Laragon/usuarios instalan Python
    $windows_paths = [
        'C:\\Python314\\python.exe',
        'C:\\Python313\\python.exe',
        'C:\\Python312\\python.exe',
        'C:\\Python311\\python.exe',
        'C:\\Python310\\python.exe',
        'C:\\Python39\\python.exe',
        'C:\\Users\\' . (getenv('USERNAME') ?: 'user') . '\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
        'C:\\Users\\' . (getenv('USERNAME') ?: 'user') . '\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
        'C:\\Users\\' . (getenv('USERNAME') ?: 'user') . '\\AppData\\Local\\Programs\\Python\\Python310\\python.exe',
    ];

    foreach ($windows_paths as $pyPath) {
        if (is_file($pyPath)) {
            $commands[] = escapeshellarg($pyPath) . ' ' . escapeshellarg($script);
        }
    }

    // PATH estándar
    $commands[] = 'python '  . escapeshellarg($script);
    $commands[] = 'python3 ' . escapeshellarg($script);
    $commands[] = 'py -3 '   . escapeshellarg($script);

    return array_values(array_unique($commands));
}

// ─── proc_open wrapper ─────────────────────────────────────────────────────────

function cp_run_process(string $command, string $stdin, int $timeoutSeconds = 15): array
{
    $descriptorSpec = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];

    $process = proc_open($command, $descriptorSpec, $pipes, CP_ROOT);
    if (!is_resource($process)) {
        throw new RuntimeException('proc_open no pudo iniciar el proceso.');
    }

    fwrite($pipes[0], $stdin);
    fclose($pipes[0]);

    stream_set_blocking($pipes[1], false);
    stream_set_blocking($pipes[2], false);

    $stdout = '';
    $stderr = '';
    $start  = microtime(true);

    while (true) {
        $stdout .= (string) stream_get_contents($pipes[1]);
        $stderr .= (string) stream_get_contents($pipes[2]);

        $status = proc_get_status($process);
        if (!$status['running']) {
            break;
        }

        if ((microtime(true) - $start) > $timeoutSeconds) {
            proc_terminate($process, 9);
            throw new RuntimeException("Timeout ({$timeoutSeconds}s) al ejecutar el parser.");
        }

        usleep(80000); // 80ms
    }

    // Leer lo que quede en buffers
    $stdout .= (string) stream_get_contents($pipes[1]);
    $stderr .= (string) stream_get_contents($pipes[2]);

    fclose($pipes[1]);
    fclose($pipes[2]);

    $exitCode = proc_close($process);

    return [
        'command'   => $command,
        'stdout'    => trim($stdout),
        'stderr'    => trim($stderr),
        'exit_code' => $exitCode,
    ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACTOR PHP INTERNO (fallback cuando Python no está disponible)
// ═══════════════════════════════════════════════════════════════════════════════

function cp_extract_php(string $raw): array
{
    $result  = cp_php_empty_result();
    $norm    = cp_php_normalize($raw);
    $simple  = cp_php_simple($norm);

    cp_php_extract_titulo($norm, $result);
    cp_php_extract_tipo($simple, $result);
    cp_php_extract_operacion($simple, $result);
    cp_php_extract_moneda($simple, $result);
    cp_php_extract_precio($simple, $result);
    cp_php_extract_piso($simple, $result);
    cp_php_extract_dimensiones($simple, $result);
    cp_php_extract_conteos($simple, $result);
    cp_php_extract_amenities($simple, $result);
    cp_php_extract_cochera($simple, $result);
    cp_php_extract_servicios($simple, $result);
    cp_php_extract_politicas($simple, $result);
    cp_php_extract_ubicacion($norm, $simple, $result);
    cp_php_extract_condiciones($simple, $result);
    cp_php_extract_documentacion($simple, $result);
    cp_php_extract_uso_ideal($simple, $result);

    // Faltantes
    foreach (['tipo', 'operacion', 'precio'] as $f) {
        if (empty($result[$f])) {
            $result['faltantes'][] = $f;
        }
    }
    foreach (['ubicacion', 'habitaciones', 'banos', 'agua_incluida', 'luz'] as $f) {
        if ($result[$f] === null) {
            $result['faltantes'][] = $f;
        }
    }

    $result['advertencias'][] = 'Extraído con el parser PHP interno (Python no disponible). Revisa los campos manualmente.';
    return $result;
}

// ─── Normalización PHP ─────────────────────────────────────────────────────────

function cp_php_normalize(string $text): string
{
    // Quitar emojis y símbolos decorativos frecuentes
    $text = preg_replace('/[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{FE00}-\x{FE0F}]/u', ' ', $text);
    $text = preg_replace('/[•▪◦●○◆◇■□►▶]/u', ' ', $text);
    // Normalizar saltos de línea y espacios
    $text = preg_replace('/\r\n?/', "\n", $text);
    $text = preg_replace('/[ \t]+/', ' ', $text);
    $text = preg_replace('/\n{3,}/', "\n\n", $text);
    return trim($text);
}

function cp_php_simple(string $text): string
{
    $text = cp_php_normalize($text);
    $text = mb_strtolower($text, 'UTF-8');
    // Quitar tildes
    $from = ['á','é','í','ó','ú','ä','ë','ï','ö','ü','ñ','Á','É','Í','Ó','Ú','Ñ'];
    $to   = ['a','e','i','o','u','a','e','i','o','u','n','a','e','i','o','u','n'];
    $text = str_replace($from, $to, $text);
    $text = str_replace('s/.', 's/', $text);
    $text = preg_replace('/ {2,}/', ' ', $text);
    return trim($text);
}

function cp_php_parse_number(string $s): ?float
{
    $s = preg_replace('/\b(mil|soles?|mensual|mensuales|s\/|usd|\$)\b/i', ' ', $s);
    $s = trim($s);
    $multiplier = 1;
    if (preg_match('/\bmil\b/i', $s)) {
        $multiplier = 1000;
        $s = str_replace('mil', '', $s);
    }
    if (!preg_match('/(\d[\d,.]*)/', $s, $m)) return null;
    $n = $m[1];
    // Formato 260,000 → 260000
    if (preg_match('/^\d{1,3}(,\d{3})+$/', $n)) {
        $n = str_replace(',', '', $n);
    } elseif (preg_match('/^\d{1,3}(\.\d{3})+$/', $n)) {
        $n = str_replace('.', '', $n);
    } else {
        $n = str_replace(',', '.', $n);
    }
    $val = (float) $n;
    return $val > 0 ? round($val * $multiplier, 2) : null;
}

function cp_php_parse_int(string $s): ?int
{
    $words = ['cero'=>0,'un'=>1,'uno'=>1,'una'=>1,'dos'=>2,'tres'=>3,'cuatro'=>4,
              'cinco'=>5,'seis'=>6,'siete'=>7,'ocho'=>8,'nueve'=>9,'diez'=>10];
    $sw = trim(mb_strtolower($s, 'UTF-8'));
    if (isset($words[$sw])) return $words[$sw];
    if (preg_match('/(\d+)/', $s, $m)) return (int) $m[1];
    return null;
}

// ─── Resultado vacío PHP ───────────────────────────────────────────────────────

function cp_php_empty_result(): array
{
    return [
        'titulo' => null, 'tipo' => null, 'operacion' => null,
        'precio' => null, 'moneda' => 'S/',
        'piso' => null, 'area' => null, 'area_construida' => null,
        'frente' => null, 'fondo' => null, 'izquierda' => null, 'derecha' => null,
        'habitaciones' => null, 'banos' => null, 'medios_banos' => null,
        'sala' => null, 'comedor' => null, 'cocina' => null, 'kitchenette' => null,
        'patio' => null, 'jardin' => null, 'balcon' => null, 'terraza' => null,
        'lavanderia' => null, 'tendedero' => null, 'azotea' => null,
        'deposito' => null, 'oficina' => null,
        'aire_acondicionado' => null, 'ventilador_techo' => null,
        'amoblado' => null, 'closets' => null,
        'reservorio_agua' => null, 'agua_24h' => null,
        'cochera' => null, 'tipo_cochera' => null, 'cantidad_vehiculos' => null,
        'seguridad' => null, 'rejas' => null, 'porton' => null,
        'internet_incluido' => null, 'mantenimiento_incluido' => null,
        'agua_incluida' => null, 'agua_monto' => null,
        'luz' => null, 'luz_monto' => null,
        'mascotas' => 'No especificado', 'extranjeros' => false,
        'nacionalidades_aceptadas' => [], 'ninos_permitidos' => 'No especificado',
        'ubicacion' => null, 'referencias' => [], 'distrito' => null,
        'ciudad' => 'Pucallpa',
        'condiciones' => ['mes_adelantado' => null, 'mes_garantia' => null, 'contrato_minimo' => null],
        'documentacion' => [], 'uso_ideal' => [],
        'confianza' => [], 'evidencia' => [], 'faltantes' => [], 'advertencias' => [],
    ];
}

// ─── Extractores PHP individuales ──────────────────────────────────────────────

function cp_php_set(array &$result, string $field, mixed $value, string $evidence, string $confidence = 'alta'): void
{
    $result[$field] = $value;
    $result['evidencia'][$field] = $evidence;
    $result['confianza'][$field] = $confidence;
}

function cp_php_extract_titulo(string $norm, array &$result): void
{
    $lines = array_filter(array_map('trim', explode("\n", $norm)));
    if (!$lines) return;
    $first = trim(reset($lines), ' -:!¡');
    if (mb_strlen($first) <= 150) {
        cp_php_set($result, 'titulo', $first, $first, 'media');
    }
}

function cp_php_extract_tipo(string $s, array &$result): void
{
    $types = [
        'Minidepartamento' => ['minidepartamento', 'mini departamento', 'mini-departamento'],
        'Departamento'     => ['departamento', ' depa ', ' dpto '],
        'Casa'             => ['casa'],
        'Cuarto'           => ['cuarto'],
        'Terreno'          => ['terreno', 'lote'],
        'Local'            => ['local comercial', 'local'],
        'Oficina'          => ['oficina'],
        'Almacén'          => ['almacen', 'almacén'],
    ];
    foreach ($types as $tipo => $keywords) {
        foreach ($keywords as $kw) {
            if (strpos($s, $kw) !== false) {
                cp_php_set($result, 'tipo', $tipo, $kw);
                return;
            }
        }
    }
}

function cp_php_extract_operacion(string $s, array &$result): void
{
    if (preg_match('/\b(se vende|vendo|venta|precio de venta|en venta)\b/i', $s)) {
        cp_php_set($result, 'operacion', 'Venta', 'venta');
        return;
    }
    if (preg_match('/\b(se alquila|alquilo|alquiler|en alquiler|renta)\b/i', $s)) {
        cp_php_set($result, 'operacion', 'Alquiler', 'alquiler');
    }
}

function cp_php_extract_moneda(string $s, array &$result): void
{
    if (preg_match('/\b(usd|dolares|dólares)\b|\$/i', $s)) {
        cp_php_set($result, 'moneda', 'USD', '$ / usd');
    } else {
        cp_php_set($result, 'moneda', 'S/', 'soles', 'media');
    }
}

function cp_php_extract_precio(string $s, array &$result): void
{
    // Etiquetado (mayor prioridad)
    if (preg_match('/(?:precio(?:\s+de\s+(?:venta|alquiler))?|tarifa\s+mensual)\s*[:\-]?\s*(?:s\/|\$)?\s*([\d.,]+(?:\s*mil)?)/i', $s, $m)) {
        $v = cp_php_parse_number($m[1]);
        if ($v && $v >= 100) {
            cp_php_set($result, 'precio', $v, $m[0]);
            return;
        }
    }
    // S/ o $ seguido de número
    if (preg_match('/(?:s\/|\$)\s*([\d.,]+(?:\s*mil)?)\s*(?:soles?|mensuales?)?/i', $s, $m)) {
        $v = cp_php_parse_number($m[1]);
        if ($v && $v >= 100) {
            cp_php_set($result, 'precio', $v, $m[0], 'media');
            return;
        }
    }
    // Número soles
    if (preg_match_all('/([\d.,]+(?:\s*mil)?)\s*soles?\b/i', $s, $matches, PREG_SET_ORDER)) {
        $best = null;
        foreach ($matches as $match) {
            // Ignorar montos de servicios
            $ctx = mb_substr($s, max(0, strpos($s, $match[0]) - 40), 80);
            if (preg_match('/\b(agua|luz|mantenimiento|cochera adicional)\b/i', $ctx)) continue;
            $v = cp_php_parse_number($match[1]);
            if ($v && $v >= 100 && ($best === null || $v > $best)) {
                $best = $v;
            }
        }
        if ($best !== null) {
            cp_php_set($result, 'precio', $best, "$best soles", 'media');
        }
    }
}

function cp_php_extract_piso(string $s, array &$result): void
{
    $floors = [
        ['/(primer|1er|1ro|1)\s+piso/i', 1],
        ['/(segundo|2do|2ndo|2)\s+piso/i', 2],
        ['/(tercer|tercero|3er|3)\s+piso/i', 3],
        ['/(cuarto|4to|4)\s+piso/i', 4],
        ['/(quinto|5to|5)\s+piso/i', 5],
    ];
    foreach ($floors as [$pat, $val]) {
        if (preg_match($pat, $s, $m)) {
            cp_php_set($result, 'piso', $val, $m[0]);
            return;
        }
    }
}

function cp_php_extract_dimensiones(string $s, array &$result): void
{
    $patterns = [
        'area'          => ['/(?:area total|área total)\s*[:\-]?\s*(?:de\s*)?([\d.,]+)\s*(?:m2|m²|metros cuadrados)?/i',
                            '/([\d.,]+)\s*(?:m2|m²)\b/i'],
        'area_construida'=> ['/(?:area construida|área construida)\s*[:\-]?\s*([\d.,]+)\s*(?:m2|m²)?/i'],
        'frente'        => ['/frente\s*[:\-]?\s*([\d.,]+)\s*(?:ml|m|metros)?/i'],
        'fondo'         => ['/fondo\s*[:\-]?\s*([\d.,]+)\s*(?:ml|m|metros)?/i'],
        'izquierda'     => ['/izquierda\s*[:\-]?\s*([\d.,]+)\s*(?:ml|m|metros)?/i'],
        'derecha'       => ['/derecha\s*[:\-]?\s*([\d.,]+)\s*(?:ml|m|metros)?/i'],
    ];
    foreach ($patterns as $field => $pats) {
        foreach ($pats as $pat) {
            if (preg_match($pat, $s, $m)) {
                $v = cp_php_parse_number($m[1]);
                if ($v !== null) {
                    cp_php_set($result, $field, $v, $m[0]);
                    break;
                }
            }
        }
    }
}

function cp_php_extract_conteos(string $s, array &$result): void
{
    $num = '(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)';
    // Habitaciones
    if (preg_match("/{$num}\s+(?:habitaciones?|dormitorios?|cuartos?)\b/i", $s, $m)) {
        $v = cp_php_parse_int($m[1]);
        if ($v !== null) cp_php_set($result, 'habitaciones', $v, $m[0]);
    }
    // Baños
    if (preg_match_all("/{$num}\s+ba[nñ]os?\b/i", $s, $matches, PREG_SET_ORDER)) {
        $best = null;
        foreach ($matches as $m) {
            $v = cp_php_parse_int($m[1]);
            if ($v !== null && ($best === null || $v > $best)) $best = $v;
        }
        if ($best !== null) cp_php_set($result, 'banos', $best, "$best baños");
    }
    // Fallback baño completo
    if ($result['banos'] === null && preg_match('/ba[nñ]o completo/i', $s)) {
        cp_php_set($result, 'banos', 1, 'baño completo', 'media');
    }
}

function cp_php_bool(string $s, string $field, array $patterns, array &$result): void
{
    foreach ($patterns as $pat) {
        if (preg_match($pat, $s, $m)) {
            cp_php_set($result, $field, true, $m[0]);
            return;
        }
    }
}

function cp_php_extract_amenities(string $s, array &$result): void
{
    cp_php_bool($s, 'sala',               ['/\bsala\b/i'],                          $result);
    cp_php_bool($s, 'comedor',            ['/\bcomedor\b/i'],                        $result);
    cp_php_bool($s, 'cocina',             ['/\bcocina\b/i'],                         $result);
    cp_php_bool($s, 'kitchenette',        ['/\bkitchenette\b/i'],                    $result);
    cp_php_bool($s, 'patio',              ['/\bpatio\b/i'],                          $result);
    cp_php_bool($s, 'jardin',             ['/\bjardin\b/i'],                         $result);
    cp_php_bool($s, 'balcon',             ['/\bbalcon\b/i'],                         $result);
    cp_php_bool($s, 'terraza',            ['/\bterraza\b/i'],                        $result);
    cp_php_bool($s, 'lavanderia',         ['/\blavanderia\b/i', '/\blavadora\b/i', '/zona de lavand/i'], $result);
    cp_php_bool($s, 'tendedero',          ['/\btendedero\b/i', '/tender ropa/i', '/zona para tender/i'], $result);
    cp_php_bool($s, 'azotea',             ['/\bazotea\b/i'],                         $result);
    cp_php_bool($s, 'deposito',           ['/\bdeposito\b/i'],                       $result);
    cp_php_bool($s, 'aire_acondicionado', ['/aire acondicionado/i'],                 $result);
    cp_php_bool($s, 'ventilador_techo',   ['/ventilador(?:es)? de techo/i'],         $result);
    cp_php_bool($s, 'amoblado',           ['/amoblad[oa]/i'],                        $result);
    cp_php_bool($s, 'closets',            ['/closets? empotrados?/i', '/\bclosets?\b/i', '/reposteros?/i'], $result);
    cp_php_bool($s, 'reservorio_agua',    ['/reservorio/i', '/pozo tubular/i', '/tanque de agua/i'], $result);
    cp_php_bool($s, 'seguridad',          ['/vigilancia privada/i', '/\bvigilancia\b/i', '/\bseguridad\b/i'], $result);
    cp_php_bool($s, 'rejas',              ['/\brejas?\b/i'],                         $result);
    cp_php_bool($s, 'porton',             ['/\bporton\b/i'],                         $result);
    cp_php_bool($s, 'mantenimiento_incluido', ['/mantenimiento.*incluid/i', '/incluye mantenimiento/i'], $result);

    // Agua 24h
    if (preg_match('/24\s*horas/i', $s) && preg_match('/\bagua\b/i', $s)) {
        cp_php_set($result, 'agua_24h', true, 'agua 24 horas');
    }

    // Internet / wifi flexible
    if (preg_match('/\b(?:internet|wifi)\b.*\bincluye?\b|\bincluye?\b.*\b(?:internet|wifi)\b|'
                  .'\b(?:internet|wifi)\b.*\bincluid[oa]\b/i', $s)) {
        cp_php_set($result, 'internet_incluido', true, 'internet/wifi incluido');
    }
}

function cp_php_extract_cochera(string $s, array &$result): void
{
    if (!preg_match('/\b(cochera|garage|garaje|estacionamiento|acceso vehicular)\b/i', $s)) return;
    cp_php_set($result, 'cochera', true, 'cochera / garage');

    $tipos = [];
    if (preg_match('/moto lineal/i', $s)) $tipos[] = 'moto lineal';
    if (preg_match('/\bmotocar\b/i',  $s)) $tipos[] = 'motocar';
    if (preg_match('/\bmoto\b/i', $s) && !in_array('moto lineal', $tipos) && !in_array('motocar', $tipos)) $tipos[] = 'moto';
    if (preg_match('/camioneta/i', $s)) $tipos[] = 'camioneta';
    if (preg_match('/\b(auto|carro)\b/i', $s)) $tipos[] = 'auto';
    $tipos = array_unique($tipos);

    $tipoCochera = count($tipos) === 1 ? $tipos[0] : (count($tipos) > 1 ? 'varios' : 'No especificado');
    cp_php_set($result, 'tipo_cochera', $tipoCochera, implode(', ', $tipos) ?: 'cochera', count($tipos) > 1 ? 'media' : 'alta');
}

function cp_php_extract_servicios(string $s, array &$result): void
{
    // Agua incluida
    if (preg_match('/agua.*incluid|incluye.{0,20}agua|incluyen servicio de agua/i', $s)) {
        cp_php_set($result, 'agua_incluida', true, 'agua incluida');
    } elseif (preg_match('/agua\s*[:\-]?\s*(?:s\/)?\s*([\d.,]+(?:\s*mil)?)\s*soles?/i', $s, $m)) {
        $v = cp_php_parse_number($m[1]);
        if ($v !== null) {
            cp_php_set($result, 'agua_incluida', false, $m[0]);
            cp_php_set($result, 'agua_monto', $v, $m[0]);
        }
    }

    // Luz
    if (preg_match('/luz.{0,30}a consumo|medidor propio|luz independiente|luz.{0,20}segun consumo/i', $s)) {
        cp_php_set($result, 'luz', 'a consumo', 'luz a consumo / medidor propio');
    } elseif (preg_match('/luz.*incluid|incluye luz/i', $s)) {
        cp_php_set($result, 'luz', 'incluida', 'luz incluida');
    } elseif (preg_match('/luz\s*[:\-]?\s*(?:s\/)?\s*([\d.,]+)\s*soles?/i', $s, $m)) {
        $v = cp_php_parse_number($m[1]);
        if ($v !== null) {
            cp_php_set($result, 'luz', 'monto fijo', $m[0]);
            cp_php_set($result, 'luz_monto', $v, $m[0]);
        }
    }
}

function cp_php_extract_politicas(string $s, array &$result): void
{
    if (preg_match('/no s[eé] aceptan mascotas|no aceptan mascotas|sin mascotas/i', $s)) {
        cp_php_set($result, 'mascotas', 'No', 'sin mascotas');
    } elseif (preg_match('/acepta mascotas|mascotas permitidas|pet friendly/i', $s)) {
        cp_php_set($result, 'mascotas', 'Sí', 'acepta mascotas');
    }
    if (preg_match('/acepta extranjeros|extranjeros permitidos/i', $s)) {
        cp_php_set($result, 'extranjeros', true, 'acepta extranjeros');
    }
    if (preg_match('/no ninos|sin ninos|sin niños/i', $s)) {
        cp_php_set($result, 'ninos_permitidos', 'No', 'sin niños');
    }
}

function cp_php_extract_ubicacion(string $norm, string $s, array &$result): void
{
    if (preg_match('/ubicad[oa]\s+en\s+(.{5,120}?)(?:\n|$|\.)/i', $norm, $m)) {
        cp_php_set($result, 'ubicacion', trim($m[1]), $m[0], 'media');
    }

    $refs = [];
    $patterns = [
        '/frente a\s+(.{3,80}?)(?:\.|,|\n|$)/i',
        '/cerca (?:al?|de)\s+(.{3,80}?)(?:\.|,|\n|$)/i',
        '/a una cuadra de\s+(.{3,80}?)(?:\.|,|\n|$)/i',
        '/a \d+ cuadras? de\s+(.{3,80}?)(?:\.|,|\n|$)/i',
        '/a \d+ minutos? de\s+(.{3,80}?)(?:\.|,|\n|$)/i',
        '/entre el?\s+(.{3,80}?)(?:\.|,|\n|$)/i',
    ];
    foreach ($patterns as $pat) {
        if (preg_match_all($pat, $norm, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $m) {
                if (!in_array($m[0], $refs)) $refs[] = trim($m[0]);
            }
        }
    }
    if ($refs) {
        $result['referencias'] = $refs;
        $result['evidencia']['referencias'] = implode(' | ', $refs);
    }

    // Distrito
    $distritos = ['calleria' => 'Callería', 'manantay' => 'Manantay', 'yarinacocha' => 'Yarinacocha'];
    foreach ($distritos as $key => $pretty) {
        if (strpos($s, $key) !== false) {
            cp_php_set($result, 'distrito', $pretty, $key);
            break;
        }
    }

    if (strpos($s, 'pucallpa') !== false) {
        cp_php_set($result, 'ciudad', 'Pucallpa', 'pucallpa');
    }
}

function cp_php_extract_condiciones(string $s, array &$result): void
{
    $num = '(\d+|un|uno|una|dos|tres)';
    if (preg_match("/{$num}\s+mes(?:es)?\s+(?:de\s+)?adelanto|{$num}\s+mes(?:es)?\s+adelantado/i", $s, $m)) {
        $tok = $m[1] ?: ($m[2] ?? '1');
        $result['condiciones']['mes_adelantado'] = cp_php_parse_int($tok);
        $result['evidencia']['condiciones.mes_adelantado'] = $m[0];
    }
    if (preg_match("/{$num}\s+mes(?:es)?\s+(?:de\s+)?garantia|(?:uno?|una|{$num})\s+de\s+garantia/i", $s, $m)) {
        $tok = $m[1] ?: ($m[2] ?? '1');
        $result['condiciones']['mes_garantia'] = cp_php_parse_int($tok);
        $result['evidencia']['condiciones.mes_garantia'] = $m[0];
    }
    if (preg_match('/modalidad\s+(\d+)x(\d+)/i', $s, $m)) {
        $result['condiciones']['mes_adelantado'] = (int) $m[1];
        $result['condiciones']['mes_garantia']   = (int) $m[2];
    }
    if (preg_match('/contrato\s+(?:m[ií]nimo\s+)?(?:de\s+)?(\d+\s+(?:a[nñ]os?|mes(?:es)?))/i', $s, $m)) {
        $result['condiciones']['contrato_minimo'] = $m[1];
        $result['evidencia']['condiciones.contrato_minimo'] = $m[0];
    }
}

function cp_php_extract_documentacion(string $s, array &$result): void
{
    $keywords = [
        'titulo de propiedad', 'registros publicos', 'sin cargas', 'sin gravamenes',
        'arbitrios al dia', 'listo para transferir', 'inscrito',
    ];
    $lines = preg_split('/[\n.]+/', $s);
    $docs  = [];
    foreach ($lines as $line) {
        $clean = mb_strtolower(trim($line), 'UTF-8');
        foreach ($keywords as $kw) {
            if (strpos($clean, $kw) !== false) {
                $docs[] = trim($line);
                break;
            }
        }
    }
    if ($docs) {
        $result['documentacion'] = $docs;
        $result['evidencia']['documentacion'] = implode(' | ', $docs);
    }
}

function cp_php_extract_uso_ideal(string $s, array &$result): void
{
    $keywords = [
        'vivienda', 'oficina', 'consultorio', 'tienda', 'restaurante', 'hotel',
        'minimarket', 'salon de belleza', 'inversion', 'inversion', 'hospedaje',
    ];
    $uso = [];
    foreach ($keywords as $kw) {
        if (strpos($s, $kw) !== false) {
            $pretty = str_replace(['inversion', 'salon'], ['inversión', 'salón'], $kw);
            if (!in_array($pretty, $uso)) $uso[] = $pretty;
        }
    }
    if ($uso) {
        $result['uso_ideal'] = $uso;
        $result['evidencia']['uso_ideal'] = implode(', ', $uso);
    }
}
