# CorredorPro — CRM Inmobiliario
**Plataforma web para corredores inmobiliarios en Pucallpa, Perú**

---

## Requisitos del servidor
- PHP 8.1 o superior
- Extensiones PHP: `pdo_sqlite`, `sqlite3`, `session`
- Apache o Nginx con mod_rewrite activado
- No requiere MySQL ni otro servidor de base de datos

---

## Instalación rápida (hosting compartido / cPanel)

1. Sube todos los archivos a tu hosting (por ejemplo, a `public_html/`)
2. Asegúrate de que la carpeta `data/` exista y tenga permisos de escritura:
   ```
   chmod 755 data/
   chmod 755 uploads/
   ```
3. Si la carpeta `data/` no existe, créala manualmente y dale permisos.
4. La base de datos SQLite se crea automáticamente en el primer acceso.
5. Accede a `https://tudominio.com/` y listo.

---

## Instalación en servidor local (XAMPP / WAMP / Laragon)

1. Copia la carpeta `corredor_pro` a `htdocs/` o `www/`
2. Accede a `http://localhost/corredor_pro/`
3. La BD se crea sola en la carpeta `data/`

---

## Usuarios demo incluidos

| Correo                  | Contraseña  | Rol          |
|-------------------------|-------------|--------------|
| admin@corredor.pro      | admin123    | Administrador|
| carlos@corredor.pro     | carlos123   | Corredor     |
| lucia@corredor.pro      | lucia123    | Corredor     |

---

## Estructura de archivos

```
corredor_pro/
├── index.php          ← Toda la aplicación (backend + frontend)
├── .htaccess          ← Routing Apache
├── data/              ← Base de datos SQLite (se crea sola)
│   └── corredor_pro.db
├── uploads/           ← Fotos de propiedades (crear con permisos 755)
└── README.md
```

---

## Módulos incluidos en esta versión (v1.0 MVP)

✅ Login multiusuario con roles (admin / corredor)  
✅ Dashboard con estadísticas en tiempo real  
✅ Gestión de propiedades (manual + extracción con IA desde anuncio)  
✅ Gestión de prospectos con requerimientos de búsqueda  
✅ Módulo de matching inteligente (score 0-100)  
✅ Agenda de citas y visitas  
✅ Seguimientos comerciales con timeline  
✅ Integración WhatsApp (abre con mensaje prellenado)  
✅ Plantillas de mensajes WhatsApp  
✅ Filtros avanzados en propiedades y prospectos  
✅ Multitenancy básico (aislamiento por corredor)  
✅ Panel de administración de usuarios  
✅ Datos demo en español basados en Pucallpa  

---

## Configuración de la IA (extracción de anuncios)

La función de extracción automática desde texto utiliza la API de Anthropic (Claude).

**Para que funcione:**
- La API key debe estar configurada en el servidor donde se sirve la app
- Si usas el archivo directamente, la clave se inyecta automáticamente por el entorno de Claude
- En producción propia, añade al archivo `.env` o directamente en el servidor:
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ```
  Y modifica la función `extractWithAI()` en el JS para incluir el header:
  ```javascript
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'TU_API_KEY',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  }
  ```

---

## Seguridad en producción

1. **Cambia el `SECRET_KEY`** en el archivo `index.php` (línea: `define('SECRET_KEY', ...)`)
2. **Activa HTTPS** descomentando las líneas en `.htaccess`
3. **Verifica que `data/` no sea accesible** desde el navegador
4. **Cambia las contraseñas** de los usuarios demo desde el panel de administración

---

## Funcionalidades próximas (v2.0)

- [ ] Subida de fotos de propiedades
- [ ] Exportación a PDF / Excel
- [ ] Notificaciones push y por correo
- [ ] Integración completa con API de WhatsApp Business
- [ ] Mapas con geolocalización (Google Maps / OpenStreetMap)
- [ ] Reportes de cierre y comisiones
- [ ] App móvil PWA con modo offline
- [ ] Integración con portales (Urbania, A dónde vivir)
- [ ] Módulo de contratos y documentos
- [ ] Multi-empresa SaaS con facturación

---

## Soporte

Desarrollado para corredores inmobiliarios de Pucallpa, Perú.  
Compatible con cualquier hosting PHP 8.1+ sin dependencias adicionales.
