"""
CorredorPro · Tests del parser de anuncios inmobiliarios
Ejecutar: python -m pytest tests_parser.py -v
         python tests_parser.py          (modo rápido con los 4 ejemplos)
"""

try:
    import pytest
    HAS_PYTEST = True
except ImportError:
    HAS_PYTEST = False
    # Sin pytest: las clases de test se ejecutan manualmente al final
    class _PytestStub:
        @staticmethod
        def mark(): pass
    pytest = _PytestStub()  # type: ignore

from parser_inmuebles import extract_parser

# ─── Textos de prueba reales ──────────────────────────────────────────────────

EJEMPLO_1 = """
¡𝗔𝗹𝗾𝘂𝗶𝗹𝗲𝗿 𝗱𝗲 𝗛𝗲𝗿𝗺𝗼𝘀𝗼 𝗠𝗶𝗻𝗶 𝗱𝗲𝗽𝗮𝗿𝘁𝗮𝗺𝗲𝗻𝘁𝗼 𝗲𝗻 𝘀𝗲𝗴𝘂𝗻𝗱𝗼 𝗽𝗶𝘀𝗼, 𝗲𝗻 𝟳𝟱𝟬 𝘀𝗼𝗹𝗲𝘀 𝗰𝗼𝗻 𝗮𝗺𝗽𝗹𝗶𝗮 𝗰𝗼𝗰𝗵𝗲𝗿𝗮 𝗽𝗮𝗿𝗮 𝗰𝗮𝗺𝗶𝗼𝗻𝗲𝘁𝗮 𝗼 𝗺𝗼𝘁𝗼 𝗹𝗶́𝗻𝗲𝗮𝗹❗

Ubicado en Av. Lloque Yupanqui, entre el colegio shapajita y la posta 9 de octubre, a unos minutos de la plaza de armas de PUCALLPA, este departamento te ofrece comodidad y seguridad:

Caracteristicas:
Sala luminosa con ventilador de techo.
Cocina funcional.
Zona para poner lavadora y lavatorio.
1 habitaciones grande con ventilador de techo y ventanas grandes
Cochera para moto o carro
1 baño completo
Tendedero de ropa (azotea)

Servicios:
Agua 20 soles las 24 horas
internet wifi y cochera incluye.
Luz: medidor propio, a consumo.

Precio: 750 soles mensual.
Cochera para carro, adicional 100 soles mas.

Condiciones:
Contrato minimo de 1 año
1 mes de adelanto + 1 mes de garantia
No se aceptan mascotas.
"""

EJEMPLO_2 = """
Alquiler de Hermoso Departamento de estreno con finos acabados en tercer piso en Pucallpa!

Ubicado en Jr. Aguaytia, a una cuadra de la Notaria Vargas Ugarte, a 3 cuadras de la municipalidad de Manantay y a 5 minutos de la plaza de armas de Pucallpa.

Características:
- Sala amplia y luminosa
- Cocina amplia
- Zona de lavandería
- 3 habitaciones
- 1 habitación con baño
- 1 baño completo compartido
- Azotea para tender ropa o zona de parrillas o reuniones

Servicios:
- Agua: 40 soles
- Luz: a consumo

Precio: 1000 soles mensual

Condiciones:
- Contrato mínimo de 1 año
- 1 mes de adelanto + 1 mes de garantía
"""

EJEMPLO_3 = """
En Alquiler - Casa elegante dentro de un condominio exclusivo y ecologico.

Ubicada en el km 4.800, Condominio Manish - Pucallpa.

- 3 habitaciones amplias (principal con baño propio)
- Aire acondicionado en las 3 habitaciones
- Closets empotrados en todas las habitaciones
- Amplio patio
- Cochera amplia y segura
- Lavandería independiente
- Terraza

PRECIO: 2,800 soles
Incluyen servicio de agua, desagüe, mantenimiento de áreas verdes, recojo de basura, vigilancia privada las 24 horas.

Condición: 1 mes adelantado + uno de garantía.
"""

EJEMPLO_4 = """
VENTA DE TERRENO EN YARINACOCHA - PUCALLPA

Se vende amplio terreno urbano de 546.6 m², ubicado en el Jr. 16 de Octubre, Mz. 100 Lote 35, distrito de Yarinacocha.

Características del terreno:
- Área total: 546.6 m²
- Frente: 12.50 ml
- Derecha: 40.00 ml
- Izquierda: 46.00 ml
- Fondo: 14.50 ml
- Pozo tubular de 100 metros

Documentación:
- Título de propiedad inscrito en Registros Públicos
- Sin cargas ni gravámenes
- Listo para transferir

Precio de venta: S/ 260,000 soles
Oportunidad ideal para inversión o desarrollo de hospedaje o vivienda familiar.
"""


# ─── Tests Ejemplo 1: Minidepartamento en alquiler ────────────────────────────

class TestEjemplo1Minidepartamento:
    def setup_method(self):
        self.r = extract_parser(EJEMPLO_1)

    def test_tipo_minidepartamento(self):
        assert self.r["tipo"] == "Minidepartamento"

    def test_operacion_alquiler(self):
        assert self.r["operacion"] == "Alquiler"

    def test_precio(self):
        assert self.r["precio"] == 750.0

    def test_moneda_soles(self):
        assert self.r["moneda"] == "S/"

    def test_piso_segundo(self):
        assert self.r["piso"] == 2

    def test_habitaciones(self):
        assert self.r["habitaciones"] == 1

    def test_banos(self):
        assert self.r["banos"] is not None and self.r["banos"] >= 1

    def test_sala(self):
        assert self.r["sala"] is True

    def test_cocina(self):
        assert self.r["cocina"] is True

    def test_tendedero(self):
        assert self.r["tendedero"] is True

    def test_azotea(self):
        assert self.r["azotea"] is True

    def test_cochera(self):
        assert self.r["cochera"] is True

    def test_ventilador_techo(self):
        assert self.r["ventilador_techo"] is True

    def test_agua_monto(self):
        assert self.r["agua_monto"] == 20.0

    def test_agua_24h(self):
        assert self.r["agua_24h"] is True

    def test_internet_incluido(self):
        assert self.r["internet_incluido"] is True

    def test_luz_a_consumo(self):
        assert self.r["luz"] == "a consumo"

    def test_mascotas_no(self):
        assert self.r["mascotas"] == "No"

    def test_condiciones_adelanto(self):
        assert self.r["condiciones"]["mes_adelantado"] == 1

    def test_condiciones_garantia(self):
        assert self.r["condiciones"]["mes_garantia"] == 1

    def test_condiciones_contrato_minimo(self):
        ct = self.r["condiciones"]["contrato_minimo"]
        assert ct is not None and "1" in str(ct)

    def test_ciudad_pucallpa(self):
        assert self.r["ciudad"] == "Pucallpa"


# ─── Tests Ejemplo 2: Departamento tercer piso ───────────────────────────────

class TestEjemplo2Departamento:
    def setup_method(self):
        self.r = extract_parser(EJEMPLO_2)

    def test_tipo_departamento(self):
        assert self.r["tipo"] == "Departamento"

    def test_operacion_alquiler(self):
        assert self.r["operacion"] == "Alquiler"

    def test_precio(self):
        assert self.r["precio"] == 1000.0

    def test_piso_tercero(self):
        assert self.r["piso"] == 3

    def test_habitaciones(self):
        assert self.r["habitaciones"] == 3

    def test_banos(self):
        assert self.r["banos"] is not None and self.r["banos"] >= 1

    def test_lavanderia(self):
        assert self.r["lavanderia"] is True

    def test_azotea(self):
        assert self.r["azotea"] is True

    def test_tendedero_tender_ropa(self):
        assert self.r["tendedero"] is True

    def test_agua_monto(self):
        assert self.r["agua_monto"] == 40.0

    def test_luz_a_consumo(self):
        assert self.r["luz"] == "a consumo"

    def test_condiciones_adelanto(self):
        assert self.r["condiciones"]["mes_adelantado"] == 1

    def test_condiciones_garantia(self):
        assert self.r["condiciones"]["mes_garantia"] == 1

    def test_condiciones_contrato(self):
        assert self.r["condiciones"]["contrato_minimo"] is not None

    def test_manantay(self):
        refs_text = " ".join(self.r.get("referencias", []))
        distrito  = self.r.get("distrito", "") or ""
        assert "Manantay" in refs_text or "Manantay" in distrito


# ─── Tests Ejemplo 3: Casa en alquiler con servicios incluidos ────────────────

class TestEjemplo3Casa:
    def setup_method(self):
        self.r = extract_parser(EJEMPLO_3)

    def test_tipo_casa(self):
        assert self.r["tipo"] == "Casa"

    def test_operacion_alquiler(self):
        assert self.r["operacion"] == "Alquiler"

    def test_precio(self):
        assert self.r["precio"] == 2800.0

    def test_habitaciones(self):
        assert self.r["habitaciones"] == 3

    def test_aire_acondicionado(self):
        assert self.r["aire_acondicionado"] is True

    def test_closets(self):
        assert self.r["closets"] is True

    def test_patio(self):
        assert self.r["patio"] is True

    def test_cochera(self):
        assert self.r["cochera"] is True

    def test_lavanderia(self):
        assert self.r["lavanderia"] is True

    def test_terraza(self):
        assert self.r["terraza"] is True

    def test_agua_incluida(self):
        assert self.r["agua_incluida"] is True

    def test_mantenimiento_incluido(self):
        assert self.r["mantenimiento_incluido"] is True

    def test_seguridad(self):
        assert self.r["seguridad"] is True

    def test_condiciones_adelanto(self):
        assert self.r["condiciones"]["mes_adelantado"] == 1

    def test_condiciones_garantia(self):
        assert self.r["condiciones"]["mes_garantia"] == 1

    def test_ciudad_pucallpa(self):
        assert self.r["ciudad"] == "Pucallpa"


# ─── Tests Ejemplo 4: Terreno en venta con medidas ────────────────────────────

class TestEjemplo4Terreno:
    def setup_method(self):
        self.r = extract_parser(EJEMPLO_4)

    def test_tipo_terreno(self):
        assert self.r["tipo"] == "Terreno"

    def test_operacion_venta(self):
        assert self.r["operacion"] == "Venta"

    def test_precio(self):
        assert self.r["precio"] == 260000.0

    def test_moneda_soles(self):
        assert self.r["moneda"] == "S/"

    def test_area(self):
        assert self.r["area"] == 546.6

    def test_frente(self):
        assert self.r["frente"] == 12.5

    def test_fondo(self):
        assert self.r["fondo"] == 14.5

    def test_izquierda(self):
        assert self.r["izquierda"] == 46.0

    def test_derecha(self):
        assert self.r["derecha"] == 40.0

    def test_distrito_yarinacocha(self):
        assert self.r["distrito"] == "Yarinacocha"

    def test_documentacion_no_vacia(self):
        assert len(self.r.get("documentacion", [])) > 0

    def test_uso_ideal_inversion(self):
        uso = self.r.get("uso_ideal", [])
        assert any("invers" in u.lower() for u in uso)

    def test_uso_ideal_hospedaje(self):
        uso = self.r.get("uso_ideal", [])
        assert any("hospedaje" in u for u in uso)

    def test_reservorio(self):
        assert self.r["reservorio_agua"] is True

    def test_ciudad_pucallpa(self):
        assert self.r["ciudad"] == "Pucallpa"

    def test_advertencia_terreno(self):
        assert any("terreno" in a.lower() for a in self.r["advertencias"])


# ─── Tests de robustez general ────────────────────────────────────────────────

class TestRobustez:
    def test_texto_vacio(self):
        r = extract_parser("")
        assert "tipo" in r["faltantes"]
        assert "operacion" in r["faltantes"]

    def test_precio_formato_miles(self):
        r = extract_parser("Se vende terreno S/ 50,000")
        assert r["precio"] == 50000.0

    def test_precio_en_miles_palabra(self):
        r = extract_parser("Precio de venta: 260 mil soles")
        assert r["precio"] == 260000.0

    def test_modalidad_1x1(self):
        r = extract_parser("Modalidad 1x1. Alquiler departamento 800 soles.")
        assert r["condiciones"]["mes_adelantado"] == 1
        assert r["condiciones"]["mes_garantia"]   == 1

    def test_minidepartamento_variante_1(self):
        r = extract_parser("Mini departamento en alquiler 500 soles")
        assert r["tipo"] == "Minidepartamento"

    def test_minidepartamento_variante_2(self):
        r = extract_parser("Mini-departamento disponible segundo piso 600 soles alquiler")
        assert r["tipo"] == "Minidepartamento"

    def test_no_mascotas_typo(self):
        r = extract_parser("No se aceptan mascotas. Alquiler departamento 600 soles.")
        assert r["mascotas"] == "No"

    def test_agua_24h_con_monto(self):
        r = extract_parser("Agua 25 soles las 24 horas. Alquiler departamento 700 soles.")
        assert r["agua_monto"] == 25.0
        assert r["agua_24h"] is True

    def test_internet_flexible(self):
        r = extract_parser("internet wifi y cochera incluye. Departamento 800 soles alquiler.")
        assert r["internet_incluido"] is True

    def test_tender_ropa(self):
        r = extract_parser("Azotea para tender ropa. Departamento alquiler 900 soles.")
        assert r["tendedero"] is True

    def test_luz_medidor_propio(self):
        r = extract_parser("Luz: medidor propio, a consumo. Alquiler 700 soles.")
        assert r["luz"] == "a consumo"

    def test_uno_de_garantia(self):
        r = extract_parser("1 mes adelantado + uno de garantia. Alquiler 800 soles.")
        assert r["condiciones"]["mes_adelantado"] == 1
        assert r["condiciones"]["mes_garantia"]   == 1


# ─── Tests cochera: tipo de vehículo y cochera adicional ─────────────────────

class TestCochera:
    def test_cochera_moto(self):
        r = extract_parser("Se alquila cuarto con cochera para moto. 400 soles.")
        assert r["cochera"] is True
        assert r["tipo_cochera"] == "moto"

    def test_cochera_camioneta(self):
        r = extract_parser("Departamento en alquiler con cochera para camioneta. 1200 soles.")
        assert r["cochera"] is True
        assert "camioneta" in (r["tipo_cochera"] or "")

    def test_cochera_moto_o_carro(self):
        r = extract_parser("Minidepartamento alquiler 750 soles. Cochera para moto o carro incluye.")
        assert r["cochera"] is True
        tc = r["tipo_cochera"] or ""
        assert "moto" in tc or "carro" in tc

    def test_cochera_moto_lineal(self):
        r = extract_parser("Casa alquiler 900 soles. Cochera para moto lineal.")
        assert r["cochera"] is True
        assert "moto lineal" in (r["tipo_cochera"] or "")

    def test_cochera_adicional_con_monto(self):
        r = extract_parser(
            "Departamento alquiler 800 soles. Cochera adicional 100 soles más."
        )
        assert r["cochera"] is True
        advertencias = " ".join(r["advertencias"])
        assert "100" in advertencias and "adicional" in advertencias.lower()

    def test_cochera_adicional_sin_monto(self):
        r = extract_parser(
            "Alquiler departamento 900 soles. Cochera adicional disponible."
        )
        advertencias = " ".join(r["advertencias"])
        assert "adicional" in advertencias.lower()

    def test_no_cochera_falso_positivo(self):
        # "moto" en texto sin cochera no debe activar cochera
        r = extract_parser("Alquiler casa 600 soles. Cerca al mercado de motos.")
        assert not r["cochera"]


# ─── Tests habitaciones: variantes y robustez ─────────────────────────────────

class TestHabitaciones:
    def test_cero_inicial(self):
        r = extract_parser("Se alquila 01 habitacion. Precio 500 soles.")
        assert r["habitaciones"] == 1
        assert r["confianza"].get("habitaciones") == "alta"

    def test_numero_texto(self):
        r = extract_parser("Departamento alquiler 700 soles. Una habitacion amplia.")
        assert r["habitaciones"] == 1
        assert r["confianza"].get("habitaciones") == "alta"

    def test_habitacion_con_adjetivo(self):
        r = extract_parser("Minidepartamento alquiler 650 soles. 1 habitacion grande.")
        assert r["habitaciones"] == 1

    def test_max_de_multiples_menciones(self):
        # "3 habitaciones ... 1 habitación con baño" → 3
        r = extract_parser(
            "Departamento alquiler 1000 soles. 3 habitaciones, 1 habitacion con baño propio."
        )
        assert r["habitaciones"] == 3

    def test_habitacion_principal_inferencia(self):
        r = extract_parser("Cuarto en alquiler 350 soles. Habitacion principal con closet.")
        assert r["habitaciones"] == 1
        assert r["confianza"].get("habitaciones") == "baja"

    def test_cuarto_amplio_inferencia(self):
        r = extract_parser("Cuarto amplio en alquiler 300 soles.")
        assert r["habitaciones"] == 1
        assert r["confianza"].get("habitaciones") == "baja"

    def test_dormitorio_sinonimo(self):
        r = extract_parser("Casa alquiler 1500 soles. 4 dormitorios.")
        assert r["habitaciones"] == 4


# ─── Tests agua: incluida, monto, aparte, todo incluido ───────────────────────

class TestAgua:
    def test_agua_incluye(self):
        r = extract_parser("Departamento alquiler 800 soles. Agua incluye.")
        assert r["agua_incluida"] is True

    def test_agua_y_cochera_incluye(self):
        r = extract_parser("Casa alquiler 1200 soles. Agua y cochera incluye.")
        assert r["agua_incluida"] is True

    def test_agua_incluida_clasico(self):
        r = extract_parser("Alquiler departamento 900 soles. Agua incluida en el precio.")
        assert r["agua_incluida"] is True

    def test_todo_incluido_agua(self):
        r = extract_parser("Casa alquiler 2000 soles. Todo incluido.")
        assert r["agua_incluida"] is True
        assert r["confianza"].get("agua_incluida") == "baja"

    def test_todo_incluido_internet(self):
        r = extract_parser("Casa alquiler 2000 soles. Todo incluido.")
        assert r["internet_incluido"] is True

    def test_todo_incluido_mantenimiento(self):
        r = extract_parser("Casa alquiler 2000 soles. Todo incluido.")
        assert r["mantenimiento_incluido"] is True

    def test_agua_aparte(self):
        r = extract_parser("Departamento alquiler 700 soles. Agua aparte.")
        assert r["agua_incluida"] is False

    def test_agua_monto_fijo(self):
        r = extract_parser("Alquiler 600 soles. Agua 30 soles.")
        assert r["agua_monto"] == 30.0
        assert r["agua_incluida"] is False

    def test_agua_monto_no_falso_positivo_incluida(self):
        # precio del departamento no debe confundirse con agua_monto
        r = extract_parser("Departamento alquiler. Precio 800 soles. Sin agua incluida.")
        assert r["agua_monto"] is None

    def test_agua_e_internet_incluidos(self):
        r = extract_parser("Departamento 1100 soles alquiler. Agua e internet incluidos.")
        assert r["agua_incluida"] is True


# =============================================================================
# CASOS DE PRUEBA v2 — Los 5 anuncios reales del enunciado
# =============================================================================

CASO_1 = """
Casa amplia, cómoda y segura, perfecta para quienes buscan tranquilidad, espacio y una excelente ubicación, sin pagar de más.

🔑 ¿QUÉ LA HACE IDEAL PARA TI?
✔️ Precio económico (más espacio por menos dinero)
✔️ Hermoso jardín y patio amplio 🌿
✔️ Cochera grande para 2 camionetas 🚗🚙
✔️ Aire acondicionado para tu máximo confort ❄️
✔️ 2 habitaciones + oficina (ideal para Oficina en Casa)
✔️ Cocina moderna y funcional
✔️ 1 Baño completo.
✔️ Zona de lavandería
✔️ Ubicación estratégica, cerca al mercado minorista y mayorista.
✔️ Zona libre de ruidos, perfecta para descansar 😌

💡 Vive cómodo, seguro y sin estrés, en una casa pensada para tu bienestar y el de tu familia.

✅Ubicación:
Frente a Planta de la Coca Cola, cerca al mercado minorista y mayorista, terminal terrestre - km 6, Pucallpa

✅Servicios:
🔹Agua y mantenimiento del césped esta incluido en el alquiler.
🔹Luz: medidor propio, a consumo.

✅Condiciones: 1 mes adelantado y 1 mes de garantía, contrato por 1 año.

✅ Tarifa Mensual: 1,200 soles.
"""

CASO_2 = """
Hermosa casa en alquiler en Pucallpa, perfecta para quienes buscan tranquilidad, comodidad y un entorno natural, sin pagar de más.

📍 Ubicada en el km 5, junto al Hotel Manish Ecology – Pucallpa.
😍 Zona libre de ruidos, con 100% contacto con la naturaleza 🐦🌿
Ideal para vivir con paz, privacidad y aire puro.

🌿 ¿POR QUÉ ESTA CASA ES IDEAL PARA TI?
✔️ Precio accesible 💰
✔️ 3 habitaciones amplias (principal con baño propio)
✔️ Aire acondicionado en las 3 habitaciones ❄️
✔️ Closets empotrados en todas las habitaciones
✔️ Amplio patio para disfrutar al aire libre 🌳
✔️ Cochera amplia y segura 🚗
✔️ Lavandería independiente
✔️ Terraza perfecta para descansar ☕

PRECIO: 3,000 soles
incluyen servicio de agua, desagüe, mantenimiento de áreas verdes, recojo de basura, vigilancia privada las 24 horas, teléfono en garita.

📋 Condición: 1 mes adelantado + uno de garantía.

📲 Escríbenos ahora y agenda tu visita
"""

CASO_3 = """
🏡 DEPARTAMENTO DE ESTRENO EN ALQUILER POR AV. CENTENARIO.

Se alquila moderno departamento en segundo piso, totalmente de estreno, ideal para quienes buscan comodidad, buena ubicación y un espacio funcional.

📍 Ubicación estratégica: Sector mercado Micaela
• A dos cuadras del Mercado Micaela
• Detrás de la planta de Petroperú
• A una cuadra de la Av. Centenario
• A 3 cuadras del Real Plaza

🛏 Distribución del departamento:
• 2 habitaciones
• Área de sala comedor con ventana con vista a la calle
• Área de cocina
• 1 baño completo
• Espacio para conectar lavadora
• Área de tendal
• Cochera para moto

💡 Servicios:
• Luz: según consumo del inquilino
• Agua: S/ 30 mensuales
• Otros servicios: aparte

💰 Precio: S/ 1,200 mensuales
📌 Condiciones:
• 1 mes de adelanto
• 1 mes de garantía
• Contrato mínimo por 1 año

Una excelente opción para vivir en una zona accesible y comercial, con la tranquilidad de un departamento nuevo y listo para estrenar.
"""

CASO_4 = """
¡𝗢𝗣𝗢𝗥𝗧𝗨𝗡𝗜𝗗𝗔𝗗 𝗗𝗘 𝗟𝗢𝗖𝗔𝗟 𝗖𝗢𝗠𝗘𝗥𝗖𝗜𝗔𝗟 𝗘𝗡 𝗔𝗟𝗤𝗨𝗜𝗟𝗘𝗥 𝗘𝗡 𝗭𝗢𝗡𝗔 𝗘𝗦𝗧𝗥𝗔𝗧𝗘́𝗚𝗜𝗖𝗔❗ ✨

Se alquila amplio local comercial de 32 m² (4x8), ideal para emprender o hacer crecer tu negocio en una zona con buen tránsito y fácil acceso.

📍 𝗨𝗯𝗶𝗰𝗮𝗰𝗶𝗼́𝗻 𝗽𝗿𝗶𝘃𝗶𝗹𝗲𝗴𝗶𝗮𝗱𝗮:
Av. 5 Esquinas – Asentamiento Humano Micaela Bastidas, a pocas cuadras de Essalud.

🔹 𝗖𝗮𝗿𝗮𝗰𝘁𝗲𝗿𝗶́𝘀𝘁𝗶𝗰𝗮𝘀 𝗱𝗲𝗹 𝗹𝗼𝗰𝗮𝗹:
✔️ Área total de 32 m² (4x8)
✔️ Pozo a tierra (seguridad eléctrica)
✔️ 2 ventiladores de techo
✔️ 1 baño.
✔️ Puerta con reja de fierro reforzado (mayor seguridad)

💡 𝗦𝗲𝗿𝘃𝗶𝗰𝗶𝗼𝘀:
✔️ Agua incluida
✔️ Luz independiente (pago según consumo)
💰 Precio: S/ 900 mensuales

📄 𝗖𝗼𝗻𝗱𝗶𝗰𝗶𝗼𝗻𝗲𝘀:
✔️ Contrato mínimo de 1 año
✔️ Modalidad 1x1 (1 mes de adelanto + 1 mes de garantía)
"""

CASO_5 = """
🌴🏠 HERMOSO DEPARTAMENTO AMOBLADO CON PISCINA EN PUCALLPA! 🚨

Vive con comodidad y estilo en una zona estratégica de la ciudad, ubicado a solo 5 minutos de los principales centros comerciales, zonas de entretenimiento y diversión; el departamento se encuentra en un segundo piso, ubicado cerca al cruce de Jr. Iparia con arborización.

✨ Características del departamento:

✅ 2 habitaciones con cama 🛏️ y clóset.
✅ Sala kitchenette totalmente equipada 🛋️ (cocina, refrigerador, horno microondas y mesa de comedor).
✅ 2 terrazas ideales para descansar o compartir.
✅ 1 baño completo 🚽🚿
✅ Aire acondicionado en 1 habitación y en la sala.

🌊 Áreas comunes:
🏊 Piscina
🌲 Terraza
🚗 Cochera para carro con portón automático

💰 Costo mensual: S/ 2,100
🔐 Condiciones: 1 mes de adelanto + 1 mes de garantía
📄 Contrato mínimo por 1 año
💧 Incluye servicio de agua
🚨 Demás servicios por cuenta del inquilino.

📋 El departamento se encuentra dentro de una casa tipo condominio, en un ambiente tranquilo, privado y seguro.
"""


class TestCaso1:
    """Casa con cochera 2 camionetas, agua incluida, 1x1, precio 1200."""

    def setup_method(self):
        self.r = extract_parser(CASO_1)

    def test_tipo(self):
        assert self.r["tipo"] == "Casa"

    def test_operacion(self):
        assert self.r["operacion"] == "Alquiler"

    def test_precio(self):
        assert self.r["precio"] == 1200.0

    def test_cochera(self):
        assert self.r["cochera"] is True

    def test_tipo_cochera_contiene_camioneta(self):
        tc = (self.r["tipo_cochera"] or "").lower()
        assert "camioneta" in tc

    def test_cantidad_vehiculos(self):
        assert self.r["cantidad_vehiculos"] == 2

    def test_agua_incluida(self):
        assert self.r["agua_incluida"] is True

    def test_agua_monto_nulo(self):
        assert self.r["agua_monto"] is None

    def test_luz_consumo(self):
        assert self.r["luz"] == "a consumo"

    def test_adelanto(self):
        assert self.r["condiciones"]["mes_adelantado"] == 1

    def test_garantia(self):
        assert self.r["condiciones"]["mes_garantia"] == 1

    def test_mascotas_default(self):
        # No se menciona mascotas → No especificado
        assert self.r["mascotas"] == "No especificado"

    def test_habitaciones(self):
        assert self.r["habitaciones"] == 2


class TestCaso2:
    """Casa con cochera genérica, agua+servicios incluidos, 1+uno de garantía, 3000."""

    def setup_method(self):
        self.r = extract_parser(CASO_2)

    def test_tipo(self):
        assert self.r["tipo"] == "Casa"

    def test_operacion(self):
        assert self.r["operacion"] == "Alquiler"

    def test_precio(self):
        assert self.r["precio"] == 3000.0

    def test_cochera(self):
        assert self.r["cochera"] is True

    def test_agua_incluida(self):
        assert self.r["agua_incluida"] is True

    def test_servicios_incluidos_tiene_agua(self):
        svcs = " ".join(self.r.get("servicios_incluidos", [])).lower()
        assert "agua" in svcs

    def test_adelanto(self):
        assert self.r["condiciones"]["mes_adelantado"] == 1

    def test_garantia(self):
        assert self.r["condiciones"]["mes_garantia"] == 1

    def test_mascotas_default(self):
        assert self.r["mascotas"] == "No especificado"

    def test_habitaciones(self):
        assert self.r["habitaciones"] == 3


class TestCaso3:
    """Departamento 2do piso, cochera moto, agua S/30, 1x1, 1200."""

    def setup_method(self):
        self.r = extract_parser(CASO_3)

    def test_tipo(self):
        assert self.r["tipo"] == "Departamento"

    def test_piso(self):
        assert self.r["piso"] == 2

    def test_precio(self):
        assert self.r["precio"] == 1200.0

    def test_cochera(self):
        assert self.r["cochera"] is True

    def test_tipo_cochera_moto(self):
        tc = (self.r["tipo_cochera"] or "").lower()
        assert "moto" in tc

    def test_agua_no_incluida(self):
        assert self.r["agua_incluida"] is False

    def test_agua_monto(self):
        assert self.r["agua_monto"] == 30.0

    def test_luz_consumo(self):
        assert self.r["luz"] == "a consumo"

    def test_adelanto(self):
        assert self.r["condiciones"]["mes_adelantado"] == 1

    def test_garantia(self):
        assert self.r["condiciones"]["mes_garantia"] == 1

    def test_habitaciones(self):
        assert self.r["habitaciones"] == 2


class TestCaso4:
    """Local comercial, sin cochera, agua incluida, modalidad 1x1, 900."""

    def setup_method(self):
        self.r = extract_parser(CASO_4)

    def test_tipo(self):
        assert self.r["tipo"] == "Local"

    def test_operacion(self):
        assert self.r["operacion"] == "Alquiler"

    def test_precio(self):
        assert self.r["precio"] == 900.0

    def test_cochera_no_mencionada(self):
        # No se menciona cochera en este caso
        assert not self.r["cochera"]

    def test_agua_incluida(self):
        assert self.r["agua_incluida"] is True

    def test_luz_consumo(self):
        assert self.r["luz"] == "a consumo"

    def test_adelanto(self):
        assert self.r["condiciones"]["mes_adelantado"] == 1

    def test_garantia(self):
        assert self.r["condiciones"]["mes_garantia"] == 1

    def test_area(self):
        assert self.r["area"] == 32.0


class TestCaso5:
    """Departamento 2do piso amoblado, cochera carro portón, agua incluida, 1x1, 2100."""

    def setup_method(self):
        self.r = extract_parser(CASO_5)

    def test_tipo(self):
        assert self.r["tipo"] == "Departamento"

    def test_piso(self):
        assert self.r["piso"] == 2

    def test_precio(self):
        assert self.r["precio"] == 2100.0

    def test_cochera(self):
        assert self.r["cochera"] is True

    def test_tipo_cochera_carro(self):
        tc = (self.r["tipo_cochera"] or "").lower()
        assert "carro" in tc or "auto" in tc

    def test_porton(self):
        assert self.r["porton"] is True

    def test_agua_incluida(self):
        assert self.r["agua_incluida"] is True

    def test_adelanto(self):
        assert self.r["condiciones"]["mes_adelantado"] == 1

    def test_garantia(self):
        assert self.r["condiciones"]["mes_garantia"] == 1

    def test_mascotas_default(self):
        assert self.r["mascotas"] == "No especificado"

    def test_amoblado(self):
        assert self.r["amoblado"] is True

    def test_habitaciones(self):
        assert self.r["habitaciones"] == 2


# ─── Ejecución directa (sin pytest) ──────────────────────────────────────────

def _print_result(nombre: str, r: dict) -> None:
    print(f"\n{'='*60}")
    print(f"{nombre}")
    print(f"  tipo              : {r['tipo']}")
    print(f"  operacion         : {r['operacion']}")
    print(f"  precio            : {r['precio']} {r['moneda']}")
    print(f"  piso              : {r['piso']}")
    print(f"  habitaciones      : {r['habitaciones']}  banos: {r['banos']}")
    print(f"  agua              : incluida={r['agua_incluida']}  monto={r['agua_monto']}  consumo={r['agua_a_consumo']}  24h={r['agua_24h']}")
    print(f"  luz               : {r['luz']}")
    print(f"  cochera           : {r['cochera']} tipo={r['tipo_cochera']} cant={r['cantidad_vehiculos']}")
    print(f"  internet          : {r['internet_incluido']}")
    print(f"  mascotas          : {r['mascotas']}")
    print(f"  servicios_inc     : {r.get('servicios_incluidos', [])}")
    print(f"  condicion         : adelanto={r['condiciones']['mes_adelantado']}  "
          f"garantia={r['condiciones']['mes_garantia']}  "
          f"contrato={r['condiciones']['contrato_minimo']}")
    print(f"  faltantes         : {r['faltantes']}")
    print(f"  advertencias      : {r['advertencias']}")


if __name__ == "__main__":
    ejemplos = [
        ("Ejemplo 1 - Minidepartamento", EJEMPLO_1),
        ("Ejemplo 2 - Departamento 3er piso", EJEMPLO_2),
        ("Ejemplo 3 - Casa condominio", EJEMPLO_3),
        ("Ejemplo 4 - Terreno Yarinacocha", EJEMPLO_4),
        ("CASO 1 - Casa cochera 2 camionetas", CASO_1),
        ("CASO 2 - Casa servicios incluidos", CASO_2),
        ("CASO 3 - Depto 2do piso cochera moto", CASO_3),
        ("CASO 4 - Local comercial 1x1", CASO_4),
        ("CASO 5 - Depto amoblado cochera carro", CASO_5),
    ]
    for nombre, texto in ejemplos:
        r = extract_parser(texto)
        _print_result(nombre, r)
