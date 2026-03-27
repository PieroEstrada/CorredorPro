"""
CorredorPro · Parser de anuncios inmobiliarios
Entrada : JSON via stdin  → { "text": "..." }
Salida  : JSON via stdout → { campos extraídos + confianza + faltantes + advertencias }
"""

import json
import re
import sys
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_CITY = "Pucallpa"

NUMBER_WORDS = {
    "cero": 0, "un": 1, "uno": 1, "una": 1, "dos": 2, "tres": 3,
    "cuatro": 4, "cinco": 5, "seis": 6, "siete": 7, "ocho": 8,
    "nueve": 9, "diez": 10, "once": 11, "doce": 12,
}

# Orden importa: Minidepartamento antes de Departamento para evitar match parcial
PROPERTY_TYPES: Dict[str, List[str]] = {
    "Minidepartamento": ["minidepartamento", "mini departamento", "mini-departamento"],
    "Departamento":     ["departamento", "depa", "dpto"],
    "Casa":             ["casa"],
    "Cuarto":           ["cuarto"],
    "Terreno":          ["terreno", "lote"],
    "Local":            ["local comercial", "local"],
    "Oficina":          ["oficina"],
    "Almacén":          ["almacen", "almacén", "deposito en venta", "deposito en alquiler"],
}

USE_IDEAL_KEYWORDS = [
    "vivienda", "oficina", "consultorio", "tienda", "restaurante", "hotel",
    "minimarket", "salon de belleza", "inversion", "inversión", "hospedaje",
]

DISTRICTS = {
    "calleria": "Callería",
    "manantay": "Manantay",
    "yarinacocha": "Yarinacocha",
}

# ─── Normalización de texto ────────────────────────────────────────────────────

def normalize_text(text: str) -> str:
    """NFKC + quita emojis decorativos + normaliza saltos/espacios."""
    text = text or ""
    # NFKC convierte caracteres matemáticos bold/italic (𝗔𝗹𝗾𝘂𝗶𝗹𝗲𝗿) a ASCII
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\xa0", " ")
    text = text.replace("–", "-").replace("—", "-")
    # Elimina emojis y símbolos decorativos frecuentes en anuncios
    text = re.sub(
        r"[•▪◦●○◆◇■□►▶🔹✅✔️✨🏠🏡📍💡📄📋📐🌿😍🚀❗🔑💰🏘️🏢🏗️🛏️🚿🚗🔒🌳]",
        " ", text
    )
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def strip_accents(text: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFKD", text)
        if not unicodedata.combining(ch)
    )


def simple_text(text: str) -> str:
    """Normaliza, quita tildes y pone en minúsculas para comparaciones."""
    text = normalize_text(text)
    text = strip_accents(text).lower()
    text = text.replace("s/.", "s/")
    text = re.sub(r"[ ]{2,}", " ", text)
    return text.strip()


# ─── Secciones ────────────────────────────────────────────────────────────────

def split_sections(text: str) -> Dict[str, str]:
    raw   = normalize_text(text)
    lines = [ln.strip() for ln in raw.split("\n") if ln.strip()]
    sections: Dict[str, List[str]] = {"general": []}
    current = "general"

    for line in lines:
        sline = simple_text(line)

        if re.search(r"\b(caracteristicas|distribucion|distribucion del departamento)\b", sline):
            current = "caracteristicas"
            sections.setdefault(current, [])
            continue
        if re.search(r"\bservicios\b", sline):
            current = "servicios"
            sections.setdefault(current, [])
            continue
        if re.search(r"\b(precio|tarifa)\b", sline):
            current = "precio"
            sections.setdefault(current, [])
        if re.search(r"\bcondicion(es)?\b", sline):
            current = "condiciones"
            sections.setdefault(current, [])
            continue
        if re.search(r"\bdocumentacion\b|\bdocumentos\b", sline):
            current = "documentacion"
            sections.setdefault(current, [])
            continue
        if re.search(r"\b(ubicacion|ubicada|ubicado)\b", sline):
            current = "ubicacion"
            sections.setdefault(current, [])

        sections.setdefault(current, []).append(line)

    return {key: "\n".join(value).strip() for key, value in sections.items()}


# ─── Parseo numérico ──────────────────────────────────────────────────────────

def parse_count_token(token: Optional[str]) -> Optional[int]:
    if token is None:
        return None
    token = simple_text(token).strip(" .,:;")
    if token in NUMBER_WORDS:
        return NUMBER_WORDS[token]
    match = re.search(r"(\d+)", token)
    return int(match.group(1)) if match else None


def parse_amount(token: Optional[str]) -> Optional[float]:
    if token is None:
        return None
    token_simple = simple_text(token)
    multiplier = 1000 if "mil" in token_simple else 1

    token_simple = token_simple.replace("mil", " ")
    token_simple = re.sub(r"\b(s/|soles|mensual|mensuales|usd|dolares)\b", " ", token_simple)
    token_simple = token_simple.replace("$", " ")

    match = re.search(r"(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)", token_simple)
    if not match:
        return None
    number = match.group(1)

    if "." in number and "," in number:
        if number.rfind(".") > number.rfind(","):
            number = number.replace(",", "")
        else:
            number = number.replace(".", "").replace(",", ".")
    elif number.count(".") >= 1 and len(number.split(".")[-1]) == 3:
        number = number.replace(".", "")
    elif number.count(",") >= 1 and len(number.split(",")[-1]) == 3:
        number = number.replace(",", "")
    else:
        number = number.replace(",", ".")

    try:
        return round(float(number) * multiplier, 2)
    except ValueError:
        return None


# ─── Resultado vacío ──────────────────────────────────────────────────────────

def empty_result() -> Dict[str, Any]:
    return {
        "titulo": None, "tipo": None, "operacion": None,
        "precio": None, "moneda": "S/",
        "piso": None, "area": None, "area_construida": None,
        "frente": None, "fondo": None, "izquierda": None, "derecha": None,
        "habitaciones": None, "banos": None, "medios_banos": None,
        "sala": None, "comedor": None, "cocina": None, "kitchenette": None,
        "patio": None, "jardin": None, "balcon": None, "terraza": None,
        "lavanderia": None, "tendedero": None, "azotea": None,
        "deposito": None, "oficina": None,
        "aire_acondicionado": None, "ventilador_techo": None,
        "amoblado": None, "closets": None,
        "reservorio_agua": None, "agua_24h": None,
        "cochera": None, "tipo_cochera": None, "cantidad_vehiculos": None,
        "seguridad": None, "rejas": None, "porton": None,
        "internet_incluido": None, "mantenimiento_incluido": None,
        "agua_incluida": None, "agua_monto": None,
        "luz": None, "luz_monto": None,
        "mascotas": "No especificado", "extranjeros": False,
        "nacionalidades_aceptadas": [], "ninos_permitidos": "No especificado",
        "ubicacion": None, "referencias": [], "distrito": None,
        "ciudad": DEFAULT_CITY,
        "condiciones": {
            "mes_adelantado": None, "mes_garantia": None, "contrato_minimo": None,
        },
        "documentacion": [], "uso_ideal": [],
        "confianza": {}, "evidencia": {}, "faltantes": [], "advertencias": [],
    }


def set_field(result: Dict[str, Any], field: str, value: Any,
              evidence: Optional[str], confidence: str) -> None:
    result[field] = value
    if evidence:
        result["evidencia"][field] = evidence
    result["confianza"][field] = confidence


# ─── Extractores ──────────────────────────────────────────────────────────────

def extract_title(raw: str, result: Dict[str, Any]) -> None:
    lines = [ln.strip(" -:!¡") for ln in normalize_text(raw).split("\n") if ln.strip()]
    if not lines:
        return
    first = lines[0]
    if len(first) <= 150:
        set_field(result, "titulo", first, first, "media")


def extract_tipo(simple: str, result: Dict[str, Any]) -> None:
    for final_value, keywords in PROPERTY_TYPES.items():
        for keyword in keywords:
            # word boundary flexible: acepta plurales
            pat = r"\b" + re.escape(keyword) + r"s?\b"
            match = re.search(pat, simple)
            if match:
                set_field(result, "tipo", final_value, match.group(0), "alta")
                return


def extract_operacion(simple: str, result: Dict[str, Any]) -> None:
    if re.search(r"\b(remata|se vende|vendo|venta|precio de venta|en venta)\b", simple):
        set_field(result, "operacion", "Venta", "venta", "alta")
        return
    if re.search(r"\b(se alquila|alquilo|alquiler|en alquiler|renta)\b", simple):
        set_field(result, "operacion", "Alquiler", "alquiler", "alta")


def extract_moneda(simple: str, result: Dict[str, Any]) -> None:
    if re.search(r"\b(usd|dolares|dólares)\b|\$", simple):
        set_field(result, "moneda", "USD", "$ / usd", "alta")
    else:
        set_field(result, "moneda", "S/", "soles", "media")


def extract_main_price(simple: str, result: Dict[str, Any]) -> None:
    # Prioridades: 3=etiquetado (precio:), 2=S//$, 1=N soles
    # Ante empate de prioridad elegimos el mayor monto (mayor=más probable precio principal)
    candidates: List[Tuple[int, float, str]] = []
    patterns = [
        (3, r"(?:precio(?:\s+de\s+venta|\s+de\s+alquiler)?|tarifa\s+mensual)"
            r"\s*[:\-]?\s*(?:s/|\$)?\s*([\d.,]+(?:\s*mil)?)"),
        (2, r"(?:s/|\$)\s*([\d.,]+(?:\s*mil)?)\s*(?:soles?|mensuales?|mensual)?"),
        (1, r"([\d.,]+(?:\s*mil)?)\s*soles?\b"),
    ]
    for base_priority, pattern in patterns:
        for match in re.finditer(pattern, simple):
            full   = match.group(0)
            # Solo miramos el contexto ANTES del número para filtrar servicios
            before = simple[max(0, match.start() - 30): match.start()]
            around = simple[max(0, match.start() - 50): min(len(simple), match.end() + 50)]
            # Filtrar solo cuando la palabra de servicio aparece ANTES del monto
            service_words = ["agua ", "luz ", "cochera adicional", "adicional", "mantenimiento"]
            if any(w in before for w in service_words):
                if not re.search(r"\bprecio\b|\btarifa\b", around):
                    continue
            amount = parse_amount(match.group(1))
            if amount is None or amount < 100:
                continue
            # Si la coincidencia incluye la palabra precio/tarifa sube a prioridad máxima
            p = 3 if re.search(r"\bprecio\b|\btarifa\b", full) else base_priority
            candidates.append((p, amount, full))

    if not candidates:
        return
    # Ordena: mayor prioridad primero; ante empate, mayor monto primero
    candidates.sort(key=lambda x: (-x[0], -x[1]))
    p, amount, evidence = candidates[0]
    set_field(result, "precio", amount, evidence, "alta" if p == 3 else "media")


def extract_floor(simple: str, result: Dict[str, Any]) -> None:
    floor_patterns = [
        (r"\b(primer|1er|1ro|1)\s+piso\b",      1),
        (r"\b(segundo|2do|2ndo|2)\s+piso\b",    2),
        (r"\b(tercer|tercero|3er|3)\s+piso\b",  3),
        (r"\b(cuarto|4to|4)\s+piso\b",          4),
        (r"\b(quinto|5to|5)\s+piso\b",          5),
        (r"\b(sexto|6to|6)\s+piso\b",           6),
    ]
    for pattern, value in floor_patterns:
        match = re.search(pattern, simple)
        if match:
            set_field(result, "piso", value, match.group(0), "alta")
            return


def extract_numeric_feature(
    simple: str, field: str, label_pattern: str,
    result: Dict[str, Any], confidence: str = "alta", pick_max: bool = True,
) -> None:
    candidates: List[Tuple[int, str]] = []
    num_pat = r"(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)"
    pattern = rf"\b{num_pat}\s+(?:{label_pattern})\b"
    for match in re.finditer(pattern, simple):
        value = parse_count_token(match.group(1))
        if value is not None:
            candidates.append((value, match.group(0)))
    if not candidates:
        return
    key_fn = (lambda x: (-x[0], x[1])) if pick_max else (lambda x: (x[0], x[1]))
    candidates.sort(key=key_fn)
    value, evidence = candidates[0]
    set_field(result, field, value, evidence, confidence)


def extract_habitaciones(simple: str, result: Dict[str, Any]) -> None:
    """Detecta habitaciones con robustez: ceros iniciales, palabras numéricas, adjetivos, inferencia."""
    LABEL = r"(?:habitacion(?:es)?|dormitorios?|cuartos?)"
    candidates: List[Tuple[int, str]] = []

    # Dígitos, acepta ceros iniciales ("01 habitación")
    for m in re.finditer(r"\b0*([1-9]\d*)\s+" + LABEL + r"\b", simple):
        candidates.append((int(m.group(1)), m.group(0)))

    # Número en texto: "una habitacion", "dos dormitorios"
    WORDS = r"(?:un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)"
    for m in re.finditer(r"\b(" + WORDS + r")\s+" + LABEL + r"\b", simple):
        val = NUMBER_WORDS.get(m.group(1))
        if val is not None:
            candidates.append((val, m.group(0)))

    if candidates:
        # Si hay varias menciones tomamos la mayor ("3 habitaciones 1 con baño" → 3)
        candidates.sort(key=lambda x: -x[0])
        set_field(result, "habitaciones", candidates[0][0], candidates[0][1], "alta")
        return

    # Inferencia de baja confianza: "habitación principal/master/grande"
    m_principal = re.search(
        r"\bhabitacion\s+(?:principal|master|grande|amplia|comoda|privada)\b", simple
    )
    if m_principal:
        set_field(result, "habitaciones", 1, m_principal.group(0) + " (inferido)", "baja")
        return

    # Inferencia baja: "cuarto amplio/grande/independiente" cuando tipo es Cuarto
    if result.get("tipo") in (None, "Cuarto"):
        m_cuarto = re.search(
            r"\bcuarto\s+(?:amplio|grande|comodo|independiente|privado)\b", simple
        )
        if m_cuarto:
            set_field(result, "habitaciones", 1, m_cuarto.group(0) + " (inferido)", "baja")


def extract_dimensions(simple: str, result: Dict[str, Any]) -> None:
    mapping = {
        "area": [
            r"area total\s*[:\-]?\s*(?:de\s*)?([\d.,]+)\s*(?:m2|m²|metros cuadrados)?",
            r"([\d.,]+)\s*(?:m2|m²)\b",
        ],
        "area_construida": [
            r"area construida\s*[:\-]?\s*([\d.,]+)\s*(?:m2|m²)?",
        ],
        "frente": [r"frente\s*[:\-]?\s*([\d.,]+)\s*(?:ml|m|metros)?"],
        "fondo":  [r"fondo\s*[:\-]?\s*([\d.,]+)\s*(?:ml|m|metros)?"],
        "izquierda": [r"izquierda\s*[:\-]?\s*([\d.,]+)\s*(?:ml|m|metros)?"],
        "derecha":   [r"derecha\s*[:\-]?\s*([\d.,]+)\s*(?:ml|m|metros)?"],
    }
    for field, patterns in mapping.items():
        for pattern in patterns:
            match = re.search(pattern, simple)
            if match:
                value = parse_amount(match.group(1))
                if value is not None:
                    set_field(result, field, value, match.group(0), "alta")
                    break


def extract_features(simple: str, result: Dict[str, Any]) -> None:
    _bool(result, simple, "sala",           [r"\bsala\b"])
    _bool(result, simple, "comedor",        [r"\bcomedor\b"])
    _bool(result, simple, "cocina",         [r"\bcocina\b"])
    _bool(result, simple, "kitchenette",    [r"\bkitchenette\b"])
    _bool(result, simple, "patio",          [r"\bpatio\b"])
    _bool(result, simple, "jardin",         [r"\bjardin\b"])
    _bool(result, simple, "balcon",         [r"\bbalcon\b"])
    _bool(result, simple, "terraza",        [r"\bterraza\b"])
    _bool(result, simple, "lavanderia",     [r"\blavanderia\b", r"lavadora", r"zona de lavand"])
    _bool(result, simple, "tendedero",      [r"\btendedero\b", r"\btendal\b", r"tender ropa", r"zona para tender", r"para tender ropa"])
    _bool(result, simple, "azotea",         [r"\bazotea\b"])
    _bool(result, simple, "deposito",       [r"\bdeposito\b"])
    _bool(result, simple, "oficina",        [r"\boficina\b", r"\bestudio\b"])
    _bool(result, simple, "aire_acondicionado",  [r"aire acondicionado"])
    _bool(result, simple, "ventilador_techo",    [r"ventiladores? de techo", r"ventilador de techo"])
    _bool(result, simple, "amoblado",            [r"amoblad[oa]", r"full amoblad[oa]"])
    _bool(result, simple, "closets",             [r"closets? empotrados?", r"\bclosets?\b", r"reposteros?"])
    _bool(result, simple, "reservorio_agua",     [r"reservorio", r"pozo tubular", r"tanque de agua"])
    _bool(result, simple, "seguridad",           [r"vigilancia privada", r"\bvigilancia\b", r"\bseguridad\b"])
    _bool(result, simple, "rejas",               [r"\breja\b", r"\brejas\b"])
    _bool(result, simple, "porton",              [r"\bporton\b"])
    _bool(result, simple, "mantenimiento_incluido", [r"mantenimiento.*incluid", r"incluye mantenimiento", r"mantenimiento de areas verdes"])

    # agua_24h: "agua 24 horas", "agua las 24 horas", "agua 20 soles las 24 horas"
    if re.search(r"24\s*horas", simple) and re.search(r"\bagua\b", simple):
        set_field(result, "agua_24h", True, "agua 24 horas", "alta")

    # internet / wifi: incluye / incluido (flexible)
    if re.search(r"\b(?:internet|wifi)\b.*\bincluye?\b|\bincluye?\b.*\b(?:internet|wifi)\b|"
                 r"\b(?:internet|wifi)\b.*\bincluid[oa]\b|\bincluid[oa]\b.*\b(?:internet|wifi)\b", simple):
        set_field(result, "internet_incluido", True, "internet / wifi incluido", "alta")


def _bool(result: Dict[str, Any], simple: str, field: str, patterns: List[str]) -> None:
    """Helper: setea un campo booleano si algún patrón hace match."""
    for pattern in patterns:
        match = re.search(pattern, simple)
        if match:
            set_field(result, field, True, match.group(0), "alta")
            return


def extract_garage(simple: str, result: Dict[str, Any]) -> None:
    GARAGE_KW = r"(?:cochera|garage|garaje|estacionamiento|acceso vehicular)"
    if not re.search(GARAGE_KW, simple):
        return

    set_field(result, "cochera", True, "cochera / garage", "alta")

    # Construir contexto limitado alrededor de cada mención de cochera/garage
    # (evita contaminar tipo_cochera con "moto" mencionada en otro contexto)
    ctx_parts: List[str] = []
    for m in re.finditer(GARAGE_KW, simple):
        s = max(0, m.start() - 60)
        e = min(len(simple), m.end() + 120)
        ctx_parts.append(simple[s:e])
    ctx = " ".join(ctx_parts)

    # Cochera adicional → advertencia separada, no contamina tipo_cochera
    es_adicional = bool(re.search(
        r"cochera.{0,25}adicional|adicional.{0,10}cochera", ctx
    ))
    if es_adicional:
        extra_m = re.search(
            r"cochera.{0,25}adicional\s+(?:por\s+)?([\d.,]+)\s*soles?", ctx
        )
        if extra_m:
            result["advertencias"].append(
                f"Cochera adicional disponible por {extra_m.group(1)} soles extra."
            )
        else:
            result["advertencias"].append(
                "Cochera adicional disponible (ver precio en descripción)."
            )

    # Tipo de cochera — buscar vehículos DENTRO del contexto de cochera
    tipos: List[str] = []
    if re.search(r"moto lineal",           ctx): tipos.append("moto lineal")
    if re.search(r"\bmotocar\b",            ctx): tipos.append("motocar")
    if re.search(r"\bmoto\b",               ctx) and not {"moto lineal","motocar"} & set(tipos):
        tipos.append("moto")
    if re.search(r"camioneta",              ctx): tipos.append("camioneta")
    if re.search(r"\b(?:auto|carro)\b",     ctx): tipos.append("carro/auto")
    if re.search(r"\bvehiculo\b",           ctx): tipos.append("vehículo")
    if re.search(r"cochera lineal",         ctx) and not tipos: tipos.append("lineal")
    tipos = list(dict.fromkeys(tipos))

    evidencia = ctx[:80].strip()
    if tipos:
        label = tipos[0] if len(tipos) == 1 else ", ".join(tipos)
        conf  = "alta" if len(tipos) == 1 else "media"
        set_field(result, "tipo_cochera", label, evidencia, conf)
    elif not es_adicional:
        set_field(result, "tipo_cochera", "No especificado", evidencia, "baja")

    # Cantidad de vehículos
    m2 = re.search(
        r"para\s+(\d+|un|uno|una|dos|tres|cuatro)\s+(?:camionetas?|autos?|carros?|motos?|vehiculos?)",
        ctx,
    )
    if m2:
        count = parse_count_token(m2.group(1))
        if count is not None:
            set_field(result, "cantidad_vehiculos", count, m2.group(0), "alta")


def extract_services(simple: str, result: Dict[str, Any]) -> None:
    # ── Agua ──────────────────────────────────────────────────────────────────
    # "agua aparte" / "agua no incluye" → explícitamente NO incluida
    agua_aparte = re.search(
        r"agua\s+(?:no\s+)?(?:aparte|por\s+separado|no\s+incluye[n]?|no\s+incluid)",
        simple,
    )
    # Patrones de agua incluida (variantes frecuentes en anuncios locales)
    agua_incluida_m = re.search(
        r"agua.*incluid|incluid.*agua|incluye[n]?.{0,20}agua|"
        r"agua.{0,30}incluye[n]?\b|"
        r"agua\s+e\s+(?:internet|luz|mantenimiento).{0,20}incluid",
        simple,
    )
    # "todo incluido" / "todo incluye" → agua + internet + mantenimiento (baja)
    todo_incluido = re.search(
        r"\btodo\s+(?:esta?\s+)?incluido\b|\btodo\s+incluye\b", simple
    )

    if agua_incluida_m or (todo_incluido and not agua_aparte):
        ev   = (agua_incluida_m or todo_incluido).group(0)  # type: ignore[union-attr]
        conf = "alta" if agua_incluida_m else "baja"
        set_field(result, "agua_incluida", True, ev, conf)
        if todo_incluido:
            if not result.get("internet_incluido"):
                set_field(result, "internet_incluido", True, ev, "baja")
            if not result.get("mantenimiento_incluido"):
                set_field(result, "mantenimiento_incluido", True, ev, "baja")
    elif agua_aparte:
        set_field(result, "agua_incluida", False, agua_aparte.group(0), "alta")
        # Intenta capturar monto aunque venga indicado como "aparte"
        water_amount = re.search(
            r"agua\s*[:\-]?\s*(?:s/)?\s*([\d.,]+(?:\s*mil)?)\s*soles?", simple
        )
        if water_amount:
            set_field(result, "agua_monto", parse_amount(water_amount.group(1)), water_amount.group(0), "alta")
    else:
        # Agua a un monto fijo (implica NO incluida)
        water_amount = re.search(
            r"agua\s*[:\-]?\s*(?:s/)?\s*([\d.,]+(?:\s*mil)?)\s*soles?",
            simple,
        )
        if water_amount:
            set_field(result, "agua_incluida", False, water_amount.group(0), "alta")
            set_field(result, "agua_monto", parse_amount(water_amount.group(1)), water_amount.group(0), "alta")

    # ── Luz ───────────────────────────────────────────────────────────────────
    if re.search(
        r"luz.{0,30}a consumo|medidor propio|luz independiente|"
        r"luz.{0,20}segun consumo|pago segun consumo",
        simple,
    ):
        set_field(result, "luz", "a consumo", "luz a consumo / medidor propio", "alta")
    elif re.search(r"luz.*incluid|incluye luz", simple):
        set_field(result, "luz", "incluida", "luz incluida", "alta")
    else:
        fixed_light = re.search(r"luz\s*[:\-]?\s*(?:s/)?\s*([\d.,]+(?:\s*mil)?)\s*soles?", simple)
        if fixed_light:
            set_field(result, "luz", "monto fijo", fixed_light.group(0), "alta")
            set_field(result, "luz_monto", parse_amount(fixed_light.group(1)), fixed_light.group(0), "alta")


def extract_policy(simple: str, result: Dict[str, Any]) -> None:
    # Mascotas — también maneja typos como "no sé aceptan"
    if re.search(r"no s[eé] aceptan mascotas|no aceptan mascotas|sin mascotas|no mascotas", simple):
        set_field(result, "mascotas", "No", "sin mascotas", "alta")
    elif re.search(r"acepta mascotas|mascotas permitidas|pet friendly", simple):
        set_field(result, "mascotas", "Sí", "acepta mascotas / pet friendly", "alta")

    # Extranjeros
    if re.search(r"acepta extranjeros|se aceptan extranjeros|extranjeros permitidos", simple):
        set_field(result, "extranjeros", True, "acepta extranjeros", "alta")
    elif re.search(r"solo peruanos|no se aceptan extranjeros", simple):
        set_field(result, "extranjeros", False, "solo peruanos", "alta")
    else:
        result["extranjeros"] = False

    # Niños
    if re.search(r"no ninos|sin ninos|sin niños", simple):
        set_field(result, "ninos_permitidos", "No", "sin niños", "alta")
    elif re.search(r"ninos permitidos|niños permitidos|se aceptan ninos", simple):
        set_field(result, "ninos_permitidos", "Sí", "niños permitidos", "alta")


def extract_location(raw: str, simple: str, result: Dict[str, Any]) -> None:
    location_patterns = [
        r"ubicad[oa]\s+en\s+(.{5,120}?)(?:\n|$|\.\s)",
        r"ubicacion(?:\s+privilegiada)?\s*[:\-]?\s*(.{5,120}?)(?:\n|$|\.\s)",
        r"(?:km\s*[\d.,]+.{0,60}?)(?:\n|$|\.\s)",
    ]
    for pattern in location_patterns:
        match = re.search(pattern, raw, re.I)
        if match:
            text = match.group(1) if match.lastindex else match.group(0)
            set_field(result, "ubicacion", text.strip(), match.group(0).strip(), "media")
            break

    # Referencias de proximidad
    refs: List[str] = []
    ref_patterns = [
        r"frente a\s+(.{3,80}?)(?:\.|\n|,|$)",
        r"cerca (?:al?|de)\s+(.{3,80}?)(?:\.|\n|,|$)",
        r"a una cuadra de\s+(.{3,80}?)(?:\.|\n|,|$)",
        r"a (?:dos|tres|\d+)\s+cuadras?\s+de\s+(.{3,80}?)(?:\.|\n|,|$)",
        r"a\s+\d+\s+minutos?\s+de\s+(.{3,80}?)(?:\.|\n|,|$)",
        r"entre el?\s+(.{3,80}?)(?:\.|\n|,|$)",
        r"junto al?\s+(.{3,80}?)(?:\.|\n|,|$)",
    ]
    for pattern in ref_patterns:
        for match in re.finditer(pattern, raw, re.I):
            text = match.group(0).strip()
            if text and text not in refs:
                refs.append(text)
    if refs:
        result["referencias"] = refs
        result["evidencia"]["referencias"] = " | ".join(refs)
        result["confianza"]["referencias"] = "media"

    # Distrito
    for key, pretty in DISTRICTS.items():
        if key in simple:
            set_field(result, "distrito", pretty, key, "alta")
            break

    # Ciudad
    if "pucallpa" in simple:
        set_field(result, "ciudad", DEFAULT_CITY, "Pucallpa", "alta")


def extract_conditions(simple: str, result: Dict[str, Any]) -> None:
    # Adelanto
    adelanto = re.search(
        r"(\d+|un|uno|una)\s+mes(?:es)?\s+(?:de\s+)?adelanto|"
        r"(\d+|un|uno|una)\s+mes(?:es)?\s+adelantado",
        simple,
    )
    if adelanto:
        token = next(g for g in adelanto.groups() if g)
        result["condiciones"]["mes_adelantado"] = parse_count_token(token)
        result["evidencia"]["condiciones.mes_adelantado"] = adelanto.group(0)
        result["confianza"]["condiciones.mes_adelantado"] = "alta"

    # Garantía — admite "uno de garantía", "1 mes garantía", "1x1"
    garantia = re.search(
        r"(\d+|un|uno|una)\s+mes(?:es)?\s+(?:de\s+)?garantia|"
        r"(?:uno?|una|\d+)\s+de\s+garantia|"
        r"modalidad\s+(\d+)x(\d+)",
        simple,
    )
    if garantia:
        if garantia.group(2) and garantia.group(3):
            result["condiciones"]["mes_adelantado"] = int(garantia.group(2))
            result["condiciones"]["mes_garantia"]   = int(garantia.group(3))
            result["evidencia"]["condiciones.mes_adelantado"] = garantia.group(0)
            result["evidencia"]["condiciones.mes_garantia"]   = garantia.group(0)
            result["confianza"]["condiciones.mes_adelantado"] = "alta"
            result["confianza"]["condiciones.mes_garantia"]   = "alta"
        else:
            token = next((g for g in garantia.groups() if g), "1")
            result["condiciones"]["mes_garantia"] = parse_count_token(token)
            result["evidencia"]["condiciones.mes_garantia"] = garantia.group(0)
            result["confianza"]["condiciones.mes_garantia"] = "alta"

    # Contrato mínimo
    contract = re.search(
        r"contrato(?:\s+m[ií]nimo)?(?:\s+por)?\s+(?:de\s+)?(\d+\s+(?:a[nñ]os?|mes(?:es)?))",
        simple,
    )
    if contract:
        result["condiciones"]["contrato_minimo"] = contract.group(1)
        result["evidencia"]["condiciones.contrato_minimo"] = contract.group(0)
        result["confianza"]["condiciones.contrato_minimo"] = "alta"


def extract_documentation_and_usage(
    raw: str, simple: str, sections: Dict[str, str], result: Dict[str, Any]
) -> None:
    doc_text = sections.get("documentacion", "") or raw
    document_lines: List[str] = []
    DOC_KEYWORDS = [
        "titulo de propiedad", "registros publicos", "registros públicos",
        "sin cargas", "sin gravamenes", "arbitrios al dia",
        "listo para transferir", "inscrito", "notaria",
    ]
    for sentence in re.split(r"[\n.]+", doc_text):
        clean       = sentence.strip(" -")
        clean_simple = simple_text(clean)
        if any(kw in clean_simple for kw in DOC_KEYWORDS):
            document_lines.append(clean)
    if document_lines:
        result["documentacion"] = document_lines
        result["evidencia"]["documentacion"] = " | ".join(document_lines)
        result["confianza"]["documentacion"] = "alta"

    # Uso ideal
    usage: List[str] = []
    for keyword in USE_IDEAL_KEYWORDS:
        if keyword in simple:
            normalized = (keyword
                .replace("salon", "salón")
                .replace("inversion", "inversión"))
            if normalized not in usage:
                usage.append(normalized)
    if usage:
        result["uso_ideal"] = usage
        result["evidencia"]["uso_ideal"] = ", ".join(usage)
        result["confianza"]["uso_ideal"] = "media"


# ─── Orquestador principal ─────────────────────────────────────────────────────

def extract_parser(raw_text: str) -> Dict[str, Any]:
    raw      = normalize_text(raw_text)
    simple   = simple_text(raw_text)
    sections = split_sections(raw_text)
    result   = empty_result()

    extract_title(raw, result)
    extract_tipo(simple, result)
    extract_operacion(simple, result)
    extract_moneda(simple, result)
    extract_main_price(simple, result)
    extract_floor(simple, result)
    extract_dimensions(simple, result)
    extract_habitaciones(simple, result)
    extract_numeric_feature(simple, "banos",        r"banos?|baños?", result)
    extract_numeric_feature(simple, "medios_banos", r"medios? banos?|medios? baños?|medio bano|medio baño", result)
    extract_features(simple, result)
    extract_garage(simple, result)
    extract_services(simple, result)
    extract_policy(simple, result)
    extract_location(raw, simple, result)
    extract_conditions(simple, result)
    extract_documentation_and_usage(raw, simple, sections, result)

    # Fallback baño completo
    if result["banos"] is None and re.search(r"bano completo|baño completo", simple):
        set_field(result, "banos", 1, "baño completo", "media")

    # Advertencias contextuales
    if result["tipo"] == "Terreno":
        result["advertencias"].append(
            "Terreno detectado: comodidades internas pueden no aplicar."
        )
    if result["tipo"] == "Local" and not result["uso_ideal"]:
        result["advertencias"].append(
            "Local sin uso ideal explícito; revisar manualmente."
        )

    # Faltantes requeridos
    for field in ["tipo", "operacion", "precio"]:
        if result.get(field) in (None, "", []):
            result["faltantes"].append(field)

    # Faltantes opcionales de revisión
    for field in ["ubicacion", "habitaciones", "banos", "agua_incluida", "luz"]:
        if result.get(field) in (None, "", []):
            result["faltantes"].append(field)

    return result


# ─── Punto de entrada ──────────────────────────────────────────────────────────

def main() -> None:
    payload = sys.stdin.read()
    if not payload.strip():
        print(json.dumps({"error": "No se recibió entrada"}, ensure_ascii=False))
        return
    try:
        data = json.loads(payload)
        text = data.get("text", "")
    except json.JSONDecodeError:
        text = payload

    try:
        result = extract_parser(text)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": f"Parser failure: {exc}"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
