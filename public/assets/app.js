/* CorredorPro - SPA Frontend
   Vanilla JS, sin frameworks. Compatible con todos los navegadores modernos. */

const App = (() => {
  // ─── Estado global ────────────────────────────────────────────────────────
  // ─── Hash routing ─────────────────────────────────────────────────────────
  const VALID_PAGES = ['dashboard', 'properties', 'prospects', 'citas', 'comisiones', 'usuarios'];

  function getPageFromHash() {
    const hash = window.location.hash.replace(/^#/, '').trim();
    return VALID_PAGES.includes(hash) ? hash : 'dashboard';
  }

  function setHash(page) {
    if (window.location.hash.replace(/^#/, '') !== page) {
      history.pushState(null, '', '#' + page);
    }
  }

  const state = {
    user:        null,
    page:        'dashboard',
    properties:  [],
    prospects:   [],
    matches:     [],
    citas:       [],
    users:       [],
    comisiones:   [],
    dashboard:    {},
    propFilters:  { tipo: '', cochera: '', piso: '', precio_max: '' },
    prospFilters: { tipo_inmueble: '', cochera: '', mascota: '', primer_piso: '', presupuesto_max: '' },
    propSearch:   '',
    prospSearch:  '',
  };

  // ─── Debounce ─────────────────────────────────────────────────────────────
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ─── Búsqueda local en propiedades ────────────────────────────────────────
  function matchPropSearch(item, q) {
    if (!q) return true;
    const norm = q.toLowerCase().trim();

    // Precio normalizado para búsqueda numérica: "2,100" → "2100", "S/ 2100" → "2100"
    const numQ = parseFloat(norm.replace(/[,\s]/g, '').replace(/^s\/\s*/i, ''));

    const refs = Array.isArray(item.referencias)
      ? item.referencias.join(' ')
      : String(item.referencias ?? '');

    const haystack = [
      item.codigo,
      item.titulo,
      item.tipo,
      item.operacion,
      item.estado,
      item.ubicacion,
      item.distrito,
      item.ciudad,
      String(item.piso ?? ''),
      String(item.precio ?? ''),
      item.descripcion_original,
      refs,
    ].map(v => String(v ?? '').toLowerCase()).join(' ');

    if (haystack.includes(norm)) return true;

    // Coincidencia numérica de precio (ej: "2100" == 2100.00)
    if (!isNaN(numQ) && numQ > 0 && item.precio !== null && item.precio !== undefined) {
      if (Math.abs(parseFloat(item.precio) - numQ) < 0.5) return true;
      // También coincidencia parcial de precio como string sin coma
      if (String(item.precio).replace('.00','').includes(norm.replace(/,/g,''))) return true;
    }

    return false;
  }

  function getFilteredProperties() {
    const q = state.propSearch.trim();
    if (!q) return state.properties;
    return state.properties.filter(p => matchPropSearch(p, q));
  }

  // ─── Búsqueda local en prospectos ─────────────────────────────────────────
  function matchProspSearch(item, q) {
    if (!q) return true;
    const norm = q.toLowerCase().trim();
    // Número de teléfono: ignorar espacios y guiones
    const normPhone = norm.replace(/[\s\-\(\)]/g, '');

    const haystack = [
      item.nombre,
      item.dni,
      item.celular,
      item.whatsapp,
      item.nacionalidad,
      item.observaciones,
    ].map(v => String(v ?? '').toLowerCase()).join(' ');

    if (haystack.includes(norm)) return true;

    // Búsqueda de teléfono normalizado
    if (normPhone.length >= 3) {
      const celN = String(item.celular  ?? '').replace(/[\s\-\(\)]/g,'');
      const waN  = String(item.whatsapp ?? '').replace(/[\s\-\(\)]/g,'');
      if (celN.includes(normPhone) || waN.includes(normPhone)) return true;
    }

    return false;
  }

  function getFilteredProspects() {
    const q = state.prospSearch.trim();
    if (!q) return state.prospects;
    return state.prospects.filter(p => matchProspSearch(p, q));
  }

  const apiBase     = window.CORREDORPRO?.apiBase     || 'api';
  const uploadsBase = window.CORREDORPRO?.uploadsBase || '../uploads';
  let leafletMap    = null;

  // ─── API helper ───────────────────────────────────────────────────────────

  async function request(path, options = {}) {
    const headers = {};
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    Object.assign(headers, options.headers || {});

    const res  = await fetch(`${apiBase}${path.startsWith('/') ? path : '/' + path}`, {
      credentials: 'same-origin',
      ...options,
      headers,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Error ${res.status}`);
    }
    return data;
  }

  // ─── HTML template literal (no escapa, usar escapeHtml para datos) ────────

  function h(strings, ...values) {
    return strings.reduce((acc, part, i) => acc + part + (values[i] ?? ''), '');
  }

  // ─── Montaje principal ────────────────────────────────────────────────────

  function mount() {
    // Destruir mapa si salimos del dashboard
    if (leafletMap && state.page !== 'dashboard') {
      leafletMap.remove();
      leafletMap = null;
    }

    const app = document.getElementById('app');
    if (!state.user) {
      app.innerHTML = document.getElementById('login-template').innerHTML;
      bindLogin();
      return;
    }

    app.innerHTML = h`
      <div class="mobile-topbar">
        <button id="hamburger-btn" class="hamburger" aria-label="Menú">
          <span></span><span></span><span></span>
        </button>
        <span class="mobile-brand">CorredorPro</span>
      </div>
      <div class="layout">
        <aside class="sidebar" id="sidebar">
          <div class="brand">
            <h2>CorredorPro</h2>
            <small>${escapeHtml(state.user.nombre)}</small>
            <span class="rol-badge">${state.user.rol}</span>
          </div>
          <nav>
            ${navBtn('dashboard',   'Dashboard')}
            ${navBtn('properties',  'Propiedades')}
            ${navBtn('prospects',   'Prospectos')}
            ${navBtn('citas',       'Citas')}
            ${navBtn('comisiones',  'Comisiones')}
            ${state.user.rol === 'admin' ? navBtn('usuarios', 'Usuarios') : ''}
          </nav>
          <button id="logout-btn" class="ghost">Cerrar sesión</button>
        </aside>
        <main class="content" id="main-content">
          ${renderPage()}
        </main>
      </div>
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <div id="modal-root"></div>
      <div id="toast-root"></div>
    `;

    bindLayoutEvents();

    // Mapa: iniciar en dashboard después de que el DOM esté listo
    if (state.page === 'dashboard') {
      requestAnimationFrame(initMapa);
    }
  }

  function navBtn(page, label) {
    return h`<button data-page="${page}" class="${state.page === page ? 'active' : ''}">${label}</button>`;
  }

  function renderPage() {
    switch (state.page) {
      case 'dashboard':   return renderDashboard();
      case 'properties':  return renderProperties();
      case 'prospects':   return renderProspects();
      case 'citas':       return renderCitas();
      case 'comisiones':  return renderComisiones();
      case 'usuarios':    return state.user.rol === 'admin' ? renderUsuarios() : '<p>Sin acceso.</p>';
      default:            return '<section class="card"><p>Página no disponible.</p></section>';
    }
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  function renderDashboard() {
    const d        = state.dashboard || {};
    const resumen  = d.resumen || {};
    const citasHoy = d.citas_hoy || [];
    const proximas = d.citas_proximas || [];

    const citasHoyHtml = citasHoy.length
      ? citasHoy.map(c => h`
          <div class="cita-dash-item">
            <div class="cita-dash-hora">${escapeHtml(c.hora ? c.hora.slice(0,5) : '--:--')}</div>
            <div>
              <b>${escapeHtml(c.titulo || c.tipo || 'Cita')}</b>
              ${c.prospecto_nombre ? h`<span class="muted"> · ${escapeHtml(c.prospecto_nombre)}</span>` : ''}
              ${c.propiedad_titulo ? h`<br><small class="muted">${escapeHtml(c.propiedad_titulo)}</small>` : ''}
            </div>
            <span class="pill ${c.estado === 'Completada' ? 'pill-green' : c.estado === 'Cancelada' ? 'pill-red' : 'pill-orange'}" style="font-size:11px">${escapeHtml(c.estado || 'Pendiente')}</span>
          </div>`).join('')
      : '<p class="muted">Sin citas hoy.</p>';

    const proximasHtml = proximas.length
      ? proximas.map(c => h`
          <div class="cita-dash-item">
            <div class="cita-dash-hora">${escapeHtml(c.fecha)}<br><small>${escapeHtml(c.hora ? c.hora.slice(0,5) : '')}</small></div>
            <div>
              <b>${escapeHtml(c.titulo || c.tipo || 'Cita')}</b>
              ${c.prospecto_nombre ? h`<span class="muted"> · ${escapeHtml(c.prospecto_nombre)}</span>` : ''}
            </div>
          </div>`).join('')
      : '<p class="muted">Sin citas próximas.</p>';

    return h`
      <section class="toolbar">
        <div>
          <h1>Dashboard</h1>
          <p>Acciones rápidas y resumen del CRM.</p>
        </div>
        <div class="actions">
          <button id="btn-open-parser">Pegar anuncio</button>
          <button class="secondary" id="btn-open-manual">Nueva propiedad</button>
        </div>
      </section>
      <section class="stats-grid">
        <article class="card stat stat-green">
          <span>${resumen.propiedades_disponibles ?? state.properties.filter(p=>p.estado==='Disponible').length}</span><small>Disponibles</small>
        </article>
        <article class="card stat">
          <span>${resumen.prospectos ?? state.prospects.length}</span><small>Prospectos</small>
        </article>
        <article class="card stat">
          <span>${citasHoy.length}</span><small>Citas hoy</small>
        </article>
      </section>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <section class="card">
          <h3 style="margin:0 0 10px">Citas de hoy</h3>
          ${citasHoyHtml}
        </section>
        <section class="card">
          <h3 style="margin:0 0 10px">Próximas citas (7 días)</h3>
          ${proximasHtml}
        </section>
      </div>
      <div class="dashboard-map-header">
        <h2>Mapa de propiedades</h2>
        <p>Solo muestra propiedades con coordenadas registradas.</p>
      </div>
      <div id="mapa-container"></div>
    `;
  }

  // ─── Propiedades ──────────────────────────────────────────────────────────

  function renderPropList(items) {
    if (!items.length) {
      const empty = state.propSearch
        ? `No hay propiedades que coincidan con "<b>${escapeHtml(state.propSearch)}</b>".`
        : 'No hay propiedades que coincidan con los filtros.';
      return `<article class="card"><p>${empty}</p></article>`;
    }
    return items.map(renderPropertyCard).join('');
  }

  function renderProperties() {
    const f    = state.propFilters;
    const visible = getFilteredProperties();
    const tipoOpts = [['', 'Todos los tipos'], ['Cuarto', 'Cuarto'], ['Minidepartamento', 'Minidepartamento'],
      ['Departamento', 'Departamento'], ['Casa', 'Casa'], ['Terreno', 'Terreno'],
      ['Local', 'Local comercial'], ['Oficina', 'Oficina'], ['Almacén', 'Almacén']]
      .map(([v, l]) => `<option value="${v}" ${f.tipo === v ? 'selected' : ''}>${l}</option>`).join('');

    const countLabel = state.propSearch
      ? `${visible.length} de ${state.properties.length} propiedades`
      : `${state.properties.length} propiedades`;

    return h`
      <section class="toolbar">
        <div>
          <h1>Propiedades</h1>
          <p>${countLabel}</p>
        </div>
        <div class="actions">
          <button id="btn-open-parser">Pegar anuncio</button>
          <button class="secondary" id="btn-open-manual">Nueva propiedad</button>
        </div>
      </section>
      <div class="search-bar">
        <input type="search" id="fp-search" placeholder="Buscar por título, dirección, precio, descripción..." value="${escapeAttr(state.propSearch)}" autocomplete="off">
        ${state.propSearch ? '<button id="btn-clear-prop-search" class="search-clear" title="Limpiar búsqueda">×</button>' : ''}
      </div>
      <section class="filters-bar">
        <select id="fp-tipo">${tipoOpts}</select>
        <select id="fp-cochera">
          <option value="" ${f.cochera === '' ? 'selected' : ''}>Cochera: todas</option>
          <option value="CARRO" ${f.cochera === 'CARRO' ? 'selected' : ''}>Con cochera (carro)</option>
          <option value="MOTO" ${f.cochera === 'MOTO' ? 'selected' : ''}>Cochera moto</option>
          <option value="NO_TIENE" ${f.cochera === 'NO_TIENE' ? 'selected' : ''}>Sin cochera</option>
        </select>
        <select id="fp-piso">
          <option value="" ${f.piso === '' ? 'selected' : ''}>Todos los pisos</option>
          <option value="1" ${f.piso === '1' ? 'selected' : ''}>1er piso</option>
          <option value="2" ${f.piso === '2' ? 'selected' : ''}>2do piso</option>
          <option value="3" ${f.piso === '3' ? 'selected' : ''}>3er piso</option>
          <option value="4" ${f.piso === '4' ? 'selected' : ''}>4to piso</option>
          <option value="5" ${f.piso === '5' ? 'selected' : ''}>5to piso</option>
        </select>
        <input type="number" id="fp-precio-max" placeholder="Precio máx. (S/)" min="0" step="50" value="${f.precio_max || ''}">
        <button id="btn-apply-prop-filters">Filtrar</button>
        <button class="secondary" id="btn-clear-prop-filters">Limpiar</button>
      </section>
      <section class="list-grid" id="prop-list">
        ${renderPropList(visible)}
      </section>
    `;
  }

  function estadoPill(estado) {
    const cls = estado === 'Disponible' ? 'pill-green'
              : estado === 'Alquilado'  ? 'pill-orange'
              : estado === 'Vendido'    ? 'pill-red'
              : 'pill-gray';
    return h`<span class="pill ${cls}">${escapeHtml(estado || 'Desconocido')}</span>`;
  }

  function renderPropertyCard(item) {
    const isAdmin = state.user?.rol === 'admin';
    const img = item.foto_principal
      ? h`<div class="card-foto"><img src="${uploadsBase}/propiedades/${item.id}/${escapeAttr(item.foto_principal)}" alt="Foto"></div>`
      : h`<div class="card-foto card-foto-empty"><span>Sin foto</span></div>`;

    const limpieza = item.limpieza_programada
      ? h`<p class="limpieza-aviso">Limpieza de fotos programada: ${escapeHtml(item.limpieza_programada)}</p>`
      : '';

    // Menú de 3 puntos — acciones según rol
    const menuItems = [
      `<button class="card-menu-item" data-action="ver-detalle-prop" data-id="${item.id}">Ver detalle</button>`,
      `<button class="card-menu-item" data-action="compartir-prop" data-id="${item.id}">Compartir</button>`,
      `<button class="card-menu-item" data-action="ver-fotos" data-id="${item.id}">Ver fotos</button>`,
      `<button class="card-menu-item" data-action="clientes-recomendados-prop" data-id="${item.id}">Clientes recomendados</button>`,
    ];
    if (isAdmin) {
      menuItems.push('<hr class="card-menu-sep">');
      menuItems.push(`<button class="card-menu-item" data-action="edit-prop" data-id="${item.id}">Editar propiedad</button>`);
      if (item.estado !== 'Disponible') {
        menuItems.push(`<button class="card-menu-item" data-action="estado-disponible" data-id="${item.id}">Marcar disponible</button>`);
      }
      if (item.estado === 'Disponible' && item.operacion === 'Alquiler') {
        menuItems.push(`<button class="card-menu-item" data-action="estado-alquilado" data-id="${item.id}" data-titulo="${escapeAttr(item.titulo||'')}">Registrar alquiler</button>`);
      }
      if (item.estado === 'Disponible' && item.operacion === 'Venta') {
        menuItems.push(`<button class="card-menu-item" data-action="estado-vendido" data-id="${item.id}" data-titulo="${escapeAttr(item.titulo||'')}">Registrar venta</button>`);
      }
      menuItems.push('<hr class="card-menu-sep">');
      menuItems.push(`<button class="card-menu-item danger" data-action="delete-prop" data-id="${item.id}">Eliminar</button>`);
    }

    return h`
      <article class="card property-card" data-prop-id="${item.id}">
        ${img}
        <div class="property-top">
          <div>
            <small class="code-label">${escapeHtml(item.codigo)}</small>
            <h3>${escapeHtml(item.titulo || 'Sin título')}</h3>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            ${estadoPill(item.estado)}
            <div class="card-menu-wrap">
              <button class="icon-btn card-menu-btn" data-action="open-prop-menu" data-id="${item.id}" title="Más opciones">&#8942;</button>
              <div class="card-menu-dropdown" id="prop-menu-${item.id}">
                ${menuItems.join('')}
              </div>
            </div>
          </div>
        </div>
        <p>${escapeHtml(item.tipo || '-')} · ${escapeHtml(item.operacion || '-')}</p>
        <p class="precio">${escapeHtml(item.moneda || 'S/')} ${formatMoney(item.precio)}</p>
        <p class="ubicacion">${escapeHtml(item.ubicacion || item.distrito || 'Sin ubicación')}</p>
        <div class="meta-row">
          <span>${item.habitaciones ?? '-'} hab.</span>
          <span>${item.banos ?? '-'} baños</span>
          <span>${item.area ?? '-'} m²</span>
          ${item.latitud ? '<span class="has-pin">Pin</span>' : ''}
        </div>
        ${limpieza}
      </article>
    `;
  }

  // ─── Mapa ─────────────────────────────────────────────────────────────────

  function renderMapa() {
    return h`
      <section class="toolbar">
        <div>
          <h1>Mapa de Propiedades</h1>
          <p>Pucallpa · Solo muestra propiedades con coordenadas registradas.</p>
        </div>
      </section>
      <div id="mapa-container"></div>
    `;
  }

  async function initMapa() {
    const container = document.getElementById('mapa-container');
    if (!container) return;

    if (leafletMap) {
      leafletMap.remove();
      leafletMap = null;
    }

    // Centro: Plaza de Armas de Pucallpa
    leafletMap = L.map('mapa-container').setView([-8.3791, -74.5539], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(leafletMap);

    try {
      const res = await request('/mapa/pins');
      const items = res.items || [];

      if (items.length === 0) {
        toast('No hay propiedades con coordenadas registradas aún.');
        return;
      }

      // Agrupar propiedades que comparten las mismas coordenadas
      const grupos = {};
      items.forEach(pin => {
        const lat = parseFloat(pin.latitud).toFixed(6);
        const lng = parseFloat(pin.longitud).toFixed(6);
        const key = `${lat},${lng}`;
        if (!grupos[key]) grupos[key] = [];
        grupos[key].push(pin);
      });

      Object.entries(grupos).forEach(([key, pins]) => {
        const [lat, lng] = key.split(',').map(Number);

        if (pins.length === 1) {
          // ── Marcador simple ──────────────────────────────────────────
          const pin = pins[0];
          const imgHtml = pin.foto_principal
            ? `<img src="${uploadsBase}/propiedades/${pin.id}/${pin.foto_principal}" style="width:100%;max-height:110px;object-fit:cover;border-radius:6px;margin-bottom:6px">`
            : '';
          const popup = `
            <div style="min-width:190px;font-family:system-ui">
              ${imgHtml}
              <b style="color:#1a7a4a">${escapeHtml(pin.codigo)}</b><br>
              <span style="font-size:13px">${escapeHtml(pin.titulo || 'Sin título')}</span><br>
              <span style="font-size:12px;color:#6b7280">${escapeHtml(pin.tipo || '-')} · ${escapeHtml(pin.operacion || '-')}</span><br>
              <b>${escapeHtml(pin.moneda || 'S/')} ${formatMoney(pin.precio)}</b><br>
              ${pin.estado === 'Disponible'
                ? '<span style="color:#16a34a;font-weight:600">Disponible</span>'
                : `<span style="color:#ea580c;font-weight:600">${escapeHtml(pin.estado)}</span>`}
              <br><button onclick="window._cpVerPropiedad(${pin.id})" class="popup-ver-btn">Ver detalle</button>
            </div>`;
          const color = pin.estado === 'Disponible' ? '#16a34a'
                      : pin.estado === 'Alquilado'  ? '#ea580c'
                      : '#dc2626';
          const icon = L.divIcon({
            html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.4)"></div>`,
            className: '',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
          L.marker([lat, lng], { icon }).addTo(leafletMap).bindPopup(popup);

        } else {
          // ── Marcador agrupado: varias propiedades en el mismo punto ──
          const hayDisponible = pins.some(p => p.estado === 'Disponible');
          const clusterColor  = hayDisponible ? '#16a34a' : '#ea580c';

          const icon = L.divIcon({
            html: `<div class="map-cluster" style="background:${clusterColor}">${pins.length}</div>`,
            className: '',
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          });

          const filas = pins.map((p, i) => {
            const img = p.foto_principal
              ? `<img src="${uploadsBase}/propiedades/${p.id}/${p.foto_principal}" style="width:100%;max-height:80px;object-fit:cover;border-radius:4px;margin-bottom:6px">`
              : '';
            const sep = i < pins.length - 1 ? '<hr style="margin:10px 0;border:none;border-top:1px solid #e5e7eb">' : '';
            return `
              <div style="padding:2px 0">
                ${img}
                <b style="color:#1a7a4a;font-size:12px">${escapeHtml(p.codigo)}</b><br>
                <span style="font-size:13px;font-weight:600">${escapeHtml(p.titulo || 'Sin título')}</span><br>
                <span style="font-size:11px;color:#6b7280">${escapeHtml(p.tipo || '-')} · ${escapeHtml(p.operacion || '-')}</span><br>
                <b style="font-size:13px">${escapeHtml(p.moneda || 'S/')} ${formatMoney(p.precio)}</b>
                ${p.estado === 'Disponible'
                  ? ' <span style="color:#16a34a;font-size:11px;font-weight:600">● Disponible</span>'
                  : ` <span style="color:#ea580c;font-size:11px;font-weight:600">● ${escapeHtml(p.estado)}</span>`}
                <br><button onclick="window._cpVerPropiedad(${p.id})" class="popup-ver-btn" style="margin-top:6px">Ver detalle</button>
              </div>${sep}`;
          }).join('');

          const popup = `
            <div style="min-width:230px;max-width:270px;font-family:system-ui">
              <div style="font-weight:700;font-size:13px;padding:0 0 8px;color:#1e293b;border-bottom:2px solid #e5e7eb">
                ${pins.length} propiedades en este punto
              </div>
              <div style="max-height:280px;overflow-y:auto;padding:10px 0 14px">
                ${filas}
              </div>
            </div>`;

          L.marker([lat, lng], { icon })
            .addTo(leafletMap)
            .bindPopup(popup, { maxWidth: 270, maxHeight: 400 });
        }
      });

      toast(`${items.length} propiedad(es) en el mapa.`);
    } catch (e) {
      toast('Error cargando pines: ' + e.message);
    }
  }

  // ─── Prospectos ───────────────────────────────────────────────────────────

  function renderProspList(items) {
    if (!items.length) {
      const empty = state.prospSearch
        ? `No hay prospectos que coincidan con "<b>${escapeHtml(state.prospSearch)}</b>".`
        : 'No hay prospectos que coincidan con los filtros.';
      return `<article class="card"><p>${empty}</p></article>`;
    }
    return items.map(renderProspectCard).join('');
  }

  function renderProspects() {
    const f       = state.prospFilters;
    const visible = getFilteredProspects();
    const tipoOpts = [['', 'Todos los tipos'], ['Cuarto', 'Cuarto'], ['Minidepartamento', 'Minidepartamento'],
      ['Departamento', 'Departamento'], ['Casa', 'Casa'], ['Terreno', 'Terreno'], ['Local', 'Local comercial']]
      .map(([v, l]) => `<option value="${v}" ${f.tipo_inmueble === v ? 'selected' : ''}>${l}</option>`).join('');

    const countLabel = state.prospSearch
      ? `${visible.length} de ${state.prospects.length} prospectos`
      : `${state.prospects.length} prospectos`;

    return h`
      <section class="toolbar">
        <div>
          <h1>Prospectos</h1>
          <p>${countLabel}</p>
        </div>
        <div class="actions">
          <button id="btn-new-prospect">Nuevo prospecto</button>
        </div>
      </section>
      <div class="search-bar">
        <input type="search" id="fpr-search" placeholder="Buscar por nombre, celular, DNI, observaciones..." value="${escapeAttr(state.prospSearch)}" autocomplete="off">
        ${state.prospSearch ? '<button id="btn-clear-prosp-search" class="search-clear" title="Limpiar búsqueda">×</button>' : ''}
      </div>
      <section class="filters-bar">
        <select id="fpr-tipo">${tipoOpts}</select>
        <select id="fpr-cochera">
          <option value="" ${f.cochera === '' ? 'selected' : ''}>Cochera: cualquiera</option>
          <option value="CARRO" ${f.cochera === 'CARRO' ? 'selected' : ''}>Necesita para carro</option>
          <option value="MOTO" ${f.cochera === 'MOTO' ? 'selected' : ''}>Necesita para moto</option>
          <option value="NO_TIENE" ${f.cochera === 'NO_TIENE' ? 'selected' : ''}>No necesita</option>
        </select>
        <select id="fpr-mascota">
          <option value="" ${f.mascota === '' ? 'selected' : ''}>Mascota: todos</option>
          <option value="1" ${f.mascota === '1' ? 'selected' : ''}>Necesita que acepte mascotas</option>
        </select>
        <select id="fpr-primer-piso">
          <option value="" ${f.primer_piso === '' ? 'selected' : ''}>Piso: cualquiera</option>
          <option value="1" ${f.primer_piso === '1' ? 'selected' : ''}>Busca 1er piso</option>
        </select>
        <input type="number" id="fpr-presupuesto-max" placeholder="Presupuesto máx. (S/)" min="0" step="50" value="${f.presupuesto_max || ''}">
        <button id="btn-apply-prosp-filters">Filtrar</button>
        <button class="secondary" id="btn-clear-prosp-filters">Limpiar</button>
      </section>
      <section class="list-grid" id="prosp-list">
        ${renderProspList(visible)}
      </section>
    `;
  }

  function renderProspectCard(item) {
    const reqs = item.requerimientos || [];
    let reqHtml = '';
    if (reqs.length > 0) {
      const r    = reqs[0];
      const tags = [
        (r.tipos_inmueble || []).join(', '),
        r.presupuesto_max ? `Hasta S/ ${formatMoney(r.presupuesto_max)}` : '',
        r.cochera && r.cochera !== 'NO_TIENE' ? 'Cochera: ' + r.cochera.toLowerCase() : '',
        parseInt(r.requiere_propiedad_con_mascota) ? 'Acepta mascotas' : '',
        parseInt(r.primer_piso) ? '1er piso' : '',
      ].filter(Boolean);
      const extra = reqs.length > 1 ? ` <span class="req-extra">+${reqs.length - 1} más</span>` : '';
      reqHtml = `<div class="req-summary">${tags.map(t => `<span class="req-tag">${escapeHtml(t)}</span>`).join('')}${extra}</div>`;
    } else {
      reqHtml = '<p class="req-none muted">Sin requerimientos registrados</p>';
    }

    return h`
      <article class="card">
        <div class="property-top">
          <div>
            <h3>${escapeHtml(item.nombre)}</h3>
          </div>
          ${item.nacionalidad ? h`<span class="pill pill-gray" style="font-size:11px">${escapeHtml(item.nacionalidad)}</span>` : ''}
        </div>
        ${item.celular ? h`<p>${escapeHtml(item.celular)}${item.whatsapp && item.whatsapp !== item.celular ? ` · WA: ${escapeHtml(item.whatsapp)}` : ''}</p>` : '<p class="muted">Sin teléfono</p>'}
        ${item.dni ? h`<p class="muted" style="font-size:12px">DNI: ${escapeHtml(item.dni)}</p>` : ''}
        ${reqHtml}
        <div class="card-btns">
          <button class="btn-sm btn-outline" data-action="inmuebles-recomendados-prosp" data-id="${item.id}" data-nombre="${escapeAttr(item.nombre)}">Inmuebles rec.</button>
          <button class="btn-sm btn-outline" data-action="ver-requerimientos" data-id="${item.id}" data-nombre="${escapeAttr(item.nombre)}">Requerimientos</button>
          <button class="btn-sm btn-outline" data-action="edit-prospect" data-id="${item.id}">Editar</button>
          <button class="btn-sm btn-outline" data-action="ver-citas-prospecto" data-id="${item.id}" data-nombre="${escapeAttr(item.nombre)}">Citas</button>
          <button class="btn-sm btn-outline" data-action="ver-comentarios" data-id="${item.id}" data-nombre="${escapeAttr(item.nombre)}">Notas</button>
        </div>
      </article>
    `;
  }

  // ─── Matches ──────────────────────────────────────────────────────────────

  function nivelColor(nivel) {
    if (!nivel) return 'pill-gray';
    if (nivel.includes('Alto'))   return 'pill-green';
    if (nivel.includes('Medio'))  return 'pill-orange';
    if (nivel.includes('Bajo'))   return 'pill-gray';
    return 'pill-red';
  }

  function renderMatchCard(m) {
    const razones  = (m.razones || []).filter(r => !r.startsWith('—'));
    const rechazos = (m.razones || []).filter(r => r.startsWith('—'));
    return h`
      <article class="card match-card">
        <div class="property-top">
          <div>
            <span class="code-label">${escapeHtml(m.propiedad_codigo || '')}</span>
            <h3>${escapeHtml(m.prospecto_nombre || m.propiedad_titulo || '')}</h3>
          </div>
          <div style="text-align:right">
            <span class="pill ${nivelColor(m.nivel)}">${m.score}%</span>
            <br><small class="muted" style="font-size:11px">${escapeHtml(m.nivel || '')}</small>
          </div>
        </div>
        <p class="muted" style="font-size:13px">${escapeHtml(m.propiedad_titulo || m.prospecto_nombre || '')}</p>
        <div class="match-bar-wrap"><div class="match-bar" style="width:${m.score}%"></div></div>
        ${razones.length ? h`<ul class="reason-list">${razones.map(r => `<li class="reason-ok">${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
        ${rechazos.length ? h`<ul class="reason-list">${rechazos.map(r => `<li class="reason-no">${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
        ${m.prospecto_whatsapp ? h`<p style="font-size:12px;margin-top:6px">WhatsApp: ${escapeHtml(m.prospecto_whatsapp)}</p>` : ''}
      </article>`;
  }

  function renderMatches() {
    return h`
      <section class="toolbar">
        <div>
          <h1>Matches</h1>
          <p>Compatibilidades entre propiedades y tus prospectos según sus requerimientos.</p>
        </div>
      </section>
      <section class="list-grid">
        ${state.matches.length
          ? state.matches.map(renderMatchCard).join('')
          : '<article class="card"><p>No hay matches generados. Agrega requerimientos a tus prospectos para ver compatibilidades. También puedes usar "Clientes recomendados" desde cualquier propiedad.</p></article>'}
      </section>
    `;
  }

  async function openMatchesPropModal(propId) {
    try {
      const res   = await request(`/propiedades/${propId}/matches`);
      const items = res.items || [];
      openModal(h`
        <div class="modal-header">
          <h3>Prospectos compatibles · Propiedad #${propId}</h3>
          <button class="icon-btn" id="close-modal">×</button>
        </div>
        <div class="modal-body">
          ${items.length
            ? items.map(m => h`
                <div style="border-bottom:1px solid var(--border);padding:10px 0">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <b>${escapeHtml(m.prospecto_nombre)}</b>
                    <span class="pill ${nivelColor(m.nivel)}">${m.score}% · ${escapeHtml(m.nivel || '')}</span>
                  </div>
                  <div class="match-bar-wrap"><div class="match-bar" style="width:${m.score}%"></div></div>
                  <ul class="reason-list" style="margin-top:4px">
                    ${(m.razones || []).map(r => `<li class="${r.startsWith('—') ? 'reason-no' : 'reason-ok'}">${escapeHtml(r)}</li>`).join('')}
                  </ul>
                  ${m.prospecto_celular ? `<small>Cel: ${escapeHtml(m.prospecto_celular)}</small>` : ''}
                </div>`).join('')
            : '<p class="muted">No hay prospectos compatibles para esta propiedad. Verifica que tus prospectos tengan requerimientos registrados.</p>'}
          <div class="actions" style="margin-top:14px">
            <button id="close-matches-modal">Cerrar</button>
          </div>
        </div>
      `);
      document.getElementById('close-modal').onclick         = closeModal;
      document.getElementById('close-matches-modal').onclick  = closeModal;
    } catch (e) {
      toast(e.message);
    }
  }

  // ─── Clientes recomendados para una propiedad ─────────────────────────────

  async function openClientesRecomendadosModal(propId) {
    try {
      const res   = await request(`/propiedades/${propId}/clientes-recomendados`);
      const items = res.items || [];
      const prop  = state.properties.find(p => p.id === propId);
      const titulo = prop ? escapeHtml(prop.titulo || prop.codigo || '#' + propId) : '#' + propId;
      openModal(h`
        <div class="modal-header">
          <h3>Clientes recomendados · ${titulo}</h3>
          <button class="icon-btn" id="close-modal">×</button>
        </div>
        <div class="modal-body">
          ${items.length
            ? items.map(m => h`
                <div class="match-prospect-row">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <b>${escapeHtml(m.prospecto_nombre)}</b>
                    <span class="pill ${nivelColor(m.nivel)}">${m.score}% &middot; ${escapeHtml(m.nivel || '')}</span>
                  </div>
                  <div class="match-bar-wrap"><div class="match-bar" style="width:${m.score}%"></div></div>
                  <ul class="reason-list" style="margin-top:4px">
                    ${(m.razones || []).map(r => `<li class="${r.startsWith('—') ? 'reason-no' : 'reason-ok'}">${escapeHtml(r)}</li>`).join('')}
                  </ul>
                  ${m.prospecto_celular ? h`<p style="font-size:12px;margin-top:4px">Cel: ${escapeHtml(m.prospecto_celular)}${m.prospecto_whatsapp ? ' · WA: ' + escapeHtml(m.prospecto_whatsapp) : ''}</p>` : ''}
                </div>`).join('')
            : '<p class="muted">Ninguno de tus prospectos tiene requerimientos compatibles con esta propiedad. Agrega requerimientos a tus prospectos para habilitar el matching.</p>'}
          <div class="actions" style="margin-top:14px">
            <button id="close-cli-modal">Cerrar</button>
          </div>
        </div>
      `);
      document.getElementById('close-modal').onclick   = closeModal;
      document.getElementById('close-cli-modal').onclick = closeModal;
    } catch (e) {
      toast(e.message);
    }
  }

  // ─── Inmuebles recomendados para un prospecto ─────────────────────────────

  async function openInmueblesRecomendadosModal(prospId, nombre) {
    try {
      const res   = await request(`/prospectos/${prospId}/inmuebles-recomendados`);
      const items = res.items || [];
      const sinReqs = res.sin_requerimientos || false;
      openModal(h`
        <div class="modal-header">
          <h3>Inmuebles recomendados · ${escapeHtml(nombre || '#' + prospId)}</h3>
          <button class="icon-btn" id="close-modal">×</button>
        </div>
        <div class="modal-body">
          ${sinReqs
            ? '<p class="muted">Este prospecto no tiene requerimientos registrados. Agrégalos desde el botón "Requerimientos" para ver propiedades compatibles.</p>'
            : items.length
              ? items.map(m => h`
                  <div class="match-prospect-row">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                      <div>
                        <span class="code-label">${escapeHtml(m.propiedad_codigo || '')}</span>
                        <b style="display:block;font-size:14px">${escapeHtml(m.propiedad_titulo || 'Sin título')}</b>
                        <span style="font-size:12px;color:var(--muted)">${escapeHtml(m.propiedad_tipo||'')} · ${escapeHtml(m.propiedad_operacion||'')} · ${escapeHtml(m.propiedad_ubicacion||'')}</span>
                        <b style="display:block;color:var(--primary);font-size:13px">${escapeHtml(m.propiedad_moneda||'S/')} ${formatMoney(m.propiedad_precio)}</b>
                      </div>
                      <span class="pill ${nivelColor(m.nivel)}" style="white-space:nowrap">${m.score}%</span>
                    </div>
                    <div class="match-bar-wrap" style="margin:6px 0 4px"><div class="match-bar" style="width:${m.score}%"></div></div>
                    <ul class="reason-list">
                      ${(m.razones||[]).map(r=>`<li class="${r.startsWith('—')?'reason-no':'reason-ok'}">${escapeHtml(r)}</li>`).join('')}
                    </ul>
                    <button class="btn-sm btn-outline" style="margin-top:6px" data-action="ver-detalle-prop" data-id="${m.propiedad_id}">Ver propiedad</button>
                  </div>`).join('')
              : '<p class="muted">No hay propiedades disponibles compatibles con los requerimientos de este prospecto.</p>'}
          <div class="actions" style="margin-top:14px">
            <button id="close-inm-modal">Cerrar</button>
          </div>
        </div>
      `);
      document.getElementById('close-modal').onclick   = closeModal;
      document.getElementById('close-inm-modal').onclick = closeModal;
      // "Ver propiedad" buttons inside the modal (modal-root is outside main-content)
      document.getElementById('modal-root')?.addEventListener('click', async ev => {
        const b = ev.target.closest('[data-action="ver-detalle-prop"]');
        if (!b) return;
        closeModal();
        await openPropertyDetailModal(parseInt(b.dataset.id));
      }, { once: true });
    } catch (e) {
      toast(e.message);
    }
  }

  // ─── Compartir propiedad ───────────────────────────────────────────────────

  function buildShareText(item) {
    if (item.descripcion_original && item.descripcion_original.trim()) {
      return item.descripcion_original.trim();
    }
    const partes = [];
    const tipo  = [item.tipo, item.operacion].filter(Boolean).join(' en ');
    if (tipo)  partes.push(tipo);
    if (item.titulo) partes.push(item.titulo);
    partes.push('');
    if (item.precio)   partes.push(`Precio: ${item.moneda || 'S/'} ${formatMoney(item.precio)}`);
    if (item.ubicacion || item.distrito) partes.push(`Ubicación: ${item.ubicacion || item.distrito}`);
    const detalles = [
      item.habitaciones ? item.habitaciones + ' hab.' : '',
      item.banos ? item.banos + ' baños' : '',
      item.area  ? item.area + ' m²' : '',
    ].filter(Boolean).join(' · ');
    if (detalles) partes.push(detalles);
    if (item.cochera && item.cochera !== 'NO_TIENE') partes.push('Cochera: Sí');
    if (item.mascotas === 'sí' || item.mascotas === 'si') partes.push('Acepta mascotas');
    const refs = Array.isArray(item.referencias) ? item.referencias : [];
    if (refs.length) partes.push('Referencias: ' + refs.join(', '));
    if (item.link_maps) partes.push(item.link_maps);
    return partes.join('\n').trim();
  }

  function openCompartirPropModal(item) {
    const texto = buildShareText(item);
    const waUrl = 'https://wa.me/?text=' + encodeURIComponent(texto);
    openModal(h`
      <div class="modal-header">
        <h3>Compartir · ${escapeHtml(item.titulo || item.codigo || '')}</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <label style="font-size:13px;color:var(--muted)">Texto a compartir</label>
        <textarea id="share-text" rows="9" style="margin-top:6px;font-size:13px;line-height:1.5">${escapeHtml(texto)}</textarea>
        <div class="actions" style="margin-top:12px;gap:8px;flex-wrap:wrap">
          <button id="btn-share-copy" class="secondary">Copiar texto</button>
          <button id="btn-share-wa" data-wa-url="${escapeAttr(waUrl)}">WhatsApp</button>
          <button class="secondary" id="close-share-modal">Cerrar</button>
        </div>
      </div>
    `);
    document.getElementById('close-modal').onclick      = closeModal;
    document.getElementById('close-share-modal').onclick = closeModal;
    document.getElementById('btn-share-copy').onclick = () => {
      const ta = document.getElementById('share-text');
      navigator.clipboard?.writeText(ta.value).then(() => toast('Texto copiado.')).catch(() => {
        ta.select();
        document.execCommand('copy');
        toast('Texto copiado.');
      });
    };
    document.getElementById('btn-share-wa').onclick = () => {
      const ta = document.getElementById('share-text');
      window.open('https://wa.me/?text=' + encodeURIComponent(ta?.value || texto), '_blank', 'noopener');
    };
  }

  // ─── Usuarios (admin) ─────────────────────────────────────────────────────

  function renderUsuarios() {
    return h`
      <section class="toolbar">
        <div>
          <h1>Usuarios</h1>
          <p>Administración de accesos al sistema.</p>
        </div>
        <div class="actions">
          <button id="btn-new-user">Nuevo usuario</button>
        </div>
      </section>
      <section class="list-grid">
        ${state.users.length
          ? state.users.map(renderUserCard).join('')
          : '<article class="card"><p>No hay usuarios.</p></article>'}
      </section>
    `;
  }

  function renderUserCard(u) {
    return h`
      <article class="card">
        <div class="property-top">
          <div>
            <small class="code-label">${escapeHtml(u.codigo)}</small>
            <h3>${escapeHtml(u.nombre)}</h3>
          </div>
          <span class="pill ${u.activo ? 'pill-green' : 'pill-gray'}">${u.activo ? 'Activo' : 'Inactivo'}</span>
        </div>
        <p>${escapeHtml(u.correo)}</p>
        <p class="muted">Rol: ${escapeHtml(u.rol)}</p>
        <div class="card-btns">
          <button class="btn-sm btn-outline" data-action="edit-user" data-id="${u.id}">Editar</button>
          <button class="btn-sm btn-outline" data-action="change-password" data-id="${u.id}" data-nombre="${escapeAttr(u.nombre)}">Contraseña</button>
          <button class="btn-sm ${u.activo ? 'btn-danger' : 'btn-green'}" data-action="toggle-user" data-id="${u.id}" data-activo="${u.activo}">
            ${u.activo ? 'Inactivar' : 'Activar'}
          </button>
        </div>
      </article>
    `;
  }

  // ─── Eventos de layout ────────────────────────────────────────────────────

  function bindLayoutEvents() {
    // Hamburger menu (mobile)
    const hamburgerBtn  = document.getElementById('hamburger-btn');
    const sidebar       = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    function openSidebar() {
      sidebar?.classList.add('is-open');
      sidebarOverlay?.classList.add('is-visible');
      hamburgerBtn?.classList.add('is-open');
    }
    function closeSidebar() {
      sidebar?.classList.remove('is-open');
      sidebarOverlay?.classList.remove('is-visible');
      hamburgerBtn?.classList.remove('is-open');
    }

    hamburgerBtn?.addEventListener('click', () => {
      sidebar?.classList.contains('is-open') ? closeSidebar() : openSidebar();
    });
    sidebarOverlay?.addEventListener('click', closeSidebar);

    // Navegación
    document.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', async () => {
        closeSidebar();
        state.page = btn.dataset.page;
        setHash(state.page);   // persiste en URL para que F5 restaure el módulo
        if (state.page === 'usuarios' && state.users.length === 0) {
          await loadUsers();
        }
        if (state.page === 'comisiones') {
          await loadComisiones();
        }
        if (state.page === 'citas') {
          await loadCitas();
        }
        mount();
      });
    });

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await request('/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
      state.user        = null;
      state.properties  = [];
      state.prospects   = [];
      state.matches     = [];
      state.citas       = [];
      state.users       = [];
      state.comisiones  = [];
      state._comResumen = {};
      state.dashboard   = {};
      history.replaceState(null, '', window.location.pathname); // limpia el hash al salir
      mount();
    });

    // Botones globales
    document.getElementById('btn-open-parser')?.addEventListener('click', openParserModal);
    document.getElementById('btn-open-manual')?.addEventListener('click', () => openPropertyForm({}));
    document.getElementById('btn-new-prospect')?.addEventListener('click', () => openProspectForm());
    document.getElementById('btn-new-cita')?.addEventListener('click', () => openCitaForm());
    document.getElementById('btn-parse-cita')?.addEventListener('click', openParseCitaModal);
    document.getElementById('btn-new-user')?.addEventListener('click', openUserForm);
    document.getElementById('btn-new-comision')?.addEventListener('click', () => openComisionForm({}));

    // Delegación de eventos en cards
    document.getElementById('main-content')?.addEventListener('click', handleCardAction);

    // Cierra menús flotantes al hacer scroll (position:fixed no se mueve con scroll)
    document.getElementById('main-content')?.addEventListener('scroll', () => {
      document.querySelectorAll('.card-menu-dropdown.open').forEach(m => m.classList.remove('open'));
    }, { passive: true });

    // ─── Buscador propiedades (tiempo real, sin llamada API) ─────────────────
    const fpSearch = document.getElementById('fp-search');
    if (fpSearch) {
      fpSearch.addEventListener('input', debounce(() => {
        state.propSearch = fpSearch.value;
        const listEl = document.getElementById('prop-list');
        if (listEl) listEl.innerHTML = renderPropList(getFilteredProperties());
        // Actualizar contador en toolbar
        const cnt = document.querySelector('#main-content .toolbar p');
        if (cnt) {
          const v = getFilteredProperties().length;
          cnt.textContent = state.propSearch
            ? `${v} de ${state.properties.length} propiedades`
            : `${state.properties.length} propiedades`;
        }
      }, 200));
      // Limpiar con × inline
      document.getElementById('btn-clear-prop-search')?.addEventListener('click', () => {
        state.propSearch = '';
        mount();
      });
    }

    // ─── Buscador prospectos (tiempo real, sin llamada API) ───────────────────
    const fprSearch = document.getElementById('fpr-search');
    if (fprSearch) {
      fprSearch.addEventListener('input', debounce(() => {
        state.prospSearch = fprSearch.value;
        const listEl = document.getElementById('prosp-list');
        if (listEl) listEl.innerHTML = renderProspList(getFilteredProspects());
        const cnt = document.querySelector('#main-content .toolbar p');
        if (cnt) {
          const v = getFilteredProspects().length;
          cnt.textContent = state.prospSearch
            ? `${v} de ${state.prospects.length} prospectos`
            : `${state.prospects.length} prospectos`;
        }
      }, 200));
      document.getElementById('btn-clear-prosp-search')?.addEventListener('click', () => {
        state.prospSearch = '';
        mount();
      });
    }

    // ─── Filtros propiedades ─────────────────────────────────────────────────
    document.getElementById('btn-apply-prop-filters')?.addEventListener('click', async () => {
      state.propFilters = {
        tipo:       document.getElementById('fp-tipo')?.value       || '',
        cochera:    document.getElementById('fp-cochera')?.value    || '',
        piso:       document.getElementById('fp-piso')?.value       || '',
        precio_max: document.getElementById('fp-precio-max')?.value || '',
      };
      await loadProperties();
      mount();
    });
    document.getElementById('btn-clear-prop-filters')?.addEventListener('click', async () => {
      state.propFilters = { tipo: '', cochera: '', piso: '', precio_max: '' };
      state.propSearch  = '';
      await loadProperties();
      mount();
    });

    // ─── Filtros prospectos ──────────────────────────────────────────────────
    document.getElementById('btn-apply-prosp-filters')?.addEventListener('click', async () => {
      state.prospFilters = {
        tipo_inmueble:   document.getElementById('fpr-tipo')?.value            || '',
        cochera:         document.getElementById('fpr-cochera')?.value         || '',
        mascota:         document.getElementById('fpr-mascota')?.value         || '',
        primer_piso:     document.getElementById('fpr-primer-piso')?.value     || '',
        presupuesto_max: document.getElementById('fpr-presupuesto-max')?.value || '',
      };
      await loadProspects();
      mount();
    });
    document.getElementById('btn-clear-prosp-filters')?.addEventListener('click', async () => {
      state.prospFilters = { tipo_inmueble: '', cochera: '', mascota: '', primer_piso: '', presupuesto_max: '' };
      state.prospSearch  = '';
      await loadProspects();
      mount();
    });
  }

  async function handleCardAction(e) {
    // Cierra todos los menús desplegables si el clic es fuera de un card-menu-wrap
    if (!e.target.closest('.card-menu-wrap')) {
      document.querySelectorAll('.card-menu-dropdown.open').forEach(m => m.classList.remove('open'));
    }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, nombre, activo } = btn.dataset;

    if (action === 'open-prop-menu') {
      const menuEl = document.getElementById(`prop-menu-${id}`);
      if (!menuEl) return;
      const isOpen = menuEl.classList.contains('open');
      // Cierra todos los demás
      document.querySelectorAll('.card-menu-dropdown.open').forEach(m => m.classList.remove('open'));
      if (!isOpen) {
        menuEl.classList.add('open');
        // Posicionar con fixed relativo al viewport, para escapar de overflow:hidden
        requestAnimationFrame(() => {
          const btnRect   = btn.getBoundingClientRect();
          const menuW     = menuEl.offsetWidth  || 200;
          const menuH     = menuEl.offsetHeight || 200;
          const vpW       = window.innerWidth;
          const vpH       = window.innerHeight;
          // Horizontal: alinear borde derecho con el botón, pero sin salir del viewport
          let left = btnRect.right - menuW;
          if (left < 8)           left = 8;
          if (left + menuW > vpW - 8) left = vpW - menuW - 8;
          // Vertical: abajo por defecto, arriba si no hay espacio
          let top = btnRect.bottom + 4;
          if (top + menuH > vpH - 8) top = btnRect.top - menuH - 4;
          if (top < 8) top = 8;
          menuEl.style.left = left + 'px';
          menuEl.style.top  = top  + 'px';
        });
      }
      return;
    }

    // Cierra el menú abierto al ejecutar cualquier acción
    document.querySelectorAll('.card-menu-dropdown.open').forEach(m => m.classList.remove('open'));

    if (action === 'ver-detalle-prop') {
      await openPropertyDetailModal(parseInt(id));
    } else if (action === 'compartir-prop') {
      const item = state.properties.find(p => p.id === parseInt(id));
      if (item) openCompartirPropModal(item);
    } else if (action === 'clientes-recomendados-prop') {
      await openClientesRecomendadosModal(parseInt(id));
    } else if (action === 'edit-prop') {
      await openPropertyEdit(parseInt(id));
    } else if (action === 'ver-fotos') {
      await openFotosModal(parseInt(id));
    } else if (action === 'estado-disponible') {
      await cambiarEstadoPropiedad(parseInt(id), 'Disponible');
    } else if (action === 'estado-alquilado') {
      await openCierreModal(parseInt(id), 'Alquilado', btn.dataset.titulo || '');
    } else if (action === 'estado-vendido') {
      await openCierreModal(parseInt(id), 'Vendido', btn.dataset.titulo || '');
    } else if (action === 'delete-prop') {
      if (!confirm(`¿Eliminar definitivamente la propiedad #${id}? Se borrarán también sus fotos. Esta acción no se puede deshacer.`)) return;
      await eliminarPropiedad(parseInt(id));
    } else if (action === 'inmuebles-recomendados-prosp') {
      await openInmueblesRecomendadosModal(parseInt(id), nombre);
    } else if (action === 'edit-prospect') {
      await openProspectEdit(parseInt(id));
    } else if (action === 'ver-requerimientos') {
      await openRequerimientosModal(parseInt(id), nombre);
    } else if (action === 'ver-citas-prospecto') {
      await openCitasProspectoModal(parseInt(id), nombre);
    } else if (action === 'ver-comentarios') {
      await openComentariosModal(parseInt(id), nombre);
    } else if (action === 'edit-cita') {
      await openCitaForm(parseInt(id));
    } else if (action === 'compartir-cita') {
      const cita = state.citas.find(c => c.id === parseInt(id));
      if (cita) openCompartirCitaModal(cita);
    } else if (action === 'delete-cita') {
      if (!confirm('¿Eliminar esta cita?')) return;
      try {
        await request(`/citas/${id}`, { method: 'DELETE', body: '{}' });
        toast('Cita eliminada.');
        await loadCitas();
        await loadDashboard();
        mount();
      } catch (e) { toast(e.message); }
    } else if (action === 'ver-matches-prop') {
      await openMatchesPropModal(parseInt(id));
    } else if (action === 'edit-comision') {
      await openComisionEdit(parseInt(id));
    } else if (action === 'edit-user') {
      await openUserEdit(parseInt(id));
    } else if (action === 'change-password') {
      openPasswordModal(parseInt(id), nombre);
    } else if (action === 'toggle-user') {
      await toggleUser(parseInt(id), activo === '1' ? 0 : 1);
    }
  }

  // ─── Carga de datos ───────────────────────────────────────────────────────

  async function loadProperties() {
    const f = state.propFilters;
    const p = new URLSearchParams();
    if (f.tipo)       p.set('tipo', f.tipo);
    if (f.cochera)    p.set('cochera', f.cochera);
    if (f.piso)       p.set('piso', f.piso);
    if (f.precio_max) p.set('precio_max', f.precio_max);
    const qs = p.toString();
    const res = await request('/propiedades' + (qs ? '?' + qs : ''));
    state.properties = res.items || [];
  }

  async function loadProspects() {
    const f = state.prospFilters;
    const p = new URLSearchParams();
    if (f.tipo_inmueble)   p.set('tipo_inmueble', f.tipo_inmueble);
    if (f.cochera)         p.set('cochera', f.cochera);
    if (f.mascota)         p.set('mascota', f.mascota);
    if (f.primer_piso)     p.set('primer_piso', f.primer_piso);
    if (f.presupuesto_max) p.set('presupuesto_max', f.presupuesto_max);
    const qs = p.toString();
    const res = await request('/prospectos' + (qs ? '?' + qs : ''));
    state.prospects = res.items || [];
  }

  async function loadCitas(params = '') {
    const res    = await request('/citas' + (params ? '?' + params : ''));
    state.citas  = res.items || [];
  }

  async function loadDashboard() {
    const res      = await request('/dashboard');
    state.dashboard = res;
  }

  async function loadData() {
    await Promise.all([
      loadProperties(),
      loadProspects(),
      loadCitas(),
      loadDashboard(),
    ]);
  }

  async function loadUsers() {
    const res    = await request('/usuarios');
    state.users  = res.items || [];
  }

  async function loadComisiones(params = '') {
    const res        = await request('/comisiones' + (params ? '?' + params : ''));
    state.comisiones = res.items   || [];
    state._comResumen = res.resumen || {};
  }

  // ─── Modales ──────────────────────────────────────────────────────────────

  function openModal(content) {
    const root = document.getElementById('modal-root');
    root.innerHTML = h`<div class="modal-backdrop"><div class="modal-card">${content}</div></div>`;
    root.querySelector('.modal-backdrop').addEventListener('click', e => {
      if (e.target.classList.contains('modal-backdrop')) closeModal();
    });
  }

  function closeModal() {
    const root = document.getElementById('modal-root');
    if (root) root.innerHTML = '';
  }

  // ─── Modal: pegar anuncio ─────────────────────────────────────────────────

  function openParserModal() {
    openModal(h`
      <div class="modal-header">
        <h3>Pegar anuncio</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <label>Texto del anuncio
          <textarea id="announcement-text" rows="14" placeholder="Pega aquí el anuncio inmobiliario..."></textarea>
        </label>
        <div class="actions">
          <button class="secondary" id="cancel-modal">Cancelar</button>
          <button id="run-parser">Extraer datos</button>
        </div>
      </div>
    `);

    document.getElementById('close-modal').onclick  = closeModal;
    document.getElementById('cancel-modal').onclick = closeModal;
    document.getElementById('run-parser').onclick   = async () => {
      const text = document.getElementById('announcement-text').value.trim();
      if (!text) { toast('Debes pegar un anuncio.'); return; }
      try {
        const res     = await request('/extract/anuncio', { method: 'POST', body: JSON.stringify({ text }) });
        const payload = res.data;
        payload.descripcion_original = text;
        closeModal();
        openPropertyForm(payload);
      } catch (e) {
        toast(e.message);
      }
    };
  }

  // ─── Modal: formulario de propiedad ──────────────────────────────────────

  function openPropertyForm(data, editId = null) {
    const conditions = data.condiciones || {};
    const isEdit     = editId !== null;
    const title      = isEdit ? `Editar propiedad #${editId}` : 'Nueva propiedad';

    openModal(h`
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <form id="property-form" class="grid-form">
          ${inputField('titulo',           'Título',           data.titulo || '')}
          ${selectField('tipo',            'Tipo',             data.tipo || '',        ['Departamento','Minidepartamento','Casa','Local','Terreno','Oficina','Almacén','Cuarto'])}
          ${selectField('operacion',       'Operación',        data.operacion || '',   ['Alquiler','Venta'])}
          ${inputField('precio',           'Precio',           data.precio ?? '')}
          ${selectField('moneda',          'Moneda',           data.moneda || 'S/',    ['S/','USD','EUR'])}
          ${inputField('piso',             'Piso',             data.piso ?? '')}
          ${inputField('area',             'Área m²',          data.area ?? '')}
          ${inputField('habitaciones',     'Habitaciones',     data.habitaciones ?? '')}
          ${inputField('banos',            'Baños',            data.banos ?? '')}
          ${inputField('ubicacion',        'Ubicación',        data.ubicacion || '')}
          ${inputField('distrito',         'Distrito',         data.distrito || '')}
          ${inputField('ciudad',           'Ciudad',           data.ciudad || 'Pucallpa')}
          ${inputField('link_maps',        'Link Google Maps', data.link_maps || '', 'url', 'Pega el link de Google Maps aquí')}
          ${selectField('mascotas',        'Mascotas',         data.mascotas || 'No especificado', ['No especificado','Sí','No'])}
          ${selectField('cochera',         'Cochera',          data.cochera || 'NO_TIENE', ['NO_TIENE','MOTO','CARRO'])}
          ${inputField('agua_monto',       'Monto agua (S/)',  data.agua_monto ?? '', 'number', 'Dejar vacío si es incluida')}
          ${isEdit ? '' : inputField('mes_adelantado', 'Meses adelantados', conditions.mes_adelantado ?? '')}
          ${isEdit ? '' : inputField('mes_garantia',   'Meses garantía',    conditions.mes_garantia ?? '')}
          ${isEdit ? '' : inputField('contrato_minimo','Contrato mínimo',   conditions.contrato_minimo || '')}
          <label class="full">Referencias
            <textarea name="referencias" rows="2">${Array.isArray(data.referencias) ? data.referencias.join('\n') : ''}</textarea>
          </label>
          <label class="full">Descripción original
            <textarea name="descripcion_original" rows="5">${escapeHtml(data.descripcion_original || '')}</textarea>
          </label>
          <div class="checkbox-row full">
            ${checkboxField('agua_incluida',        'Agua incluida',        data.agua_incluida)}
            ${checkboxField('agua_a_consumo',       'Agua a consumo',       data.agua_a_consumo)}
            ${checkboxField('internet_incluido',    'Internet',             data.internet_incluido)}
            ${checkboxField('mantenimiento_incluido','Mantenimiento',       data.mantenimiento_incluido)}
            ${checkboxField('aire_acondicionado',   'Aire acondicionado',   data.aire_acondicionado)}
            ${checkboxField('lavanderia',           'Lavandería',           data.lavanderia)}
            ${checkboxField('terraza',              'Terraza',              data.terraza)}
            ${checkboxField('patio',                'Patio',                data.patio)}
            ${checkboxField('seguridad',            'Seguridad',            data.seguridad)}
            ${checkboxField('rejas',                'Rejas',                data.rejas)}
            ${checkboxField('porton',               'Portón',               data.porton)}
            ${checkboxField('amoblado',             'Amoblado',             data.amoblado)}
          </div>
        </form>
        ${renderParserNotes(data)}
        ${!isEdit ? `
          <hr style="margin:18px 0 12px">
          <label><b>Fotos</b> <span style="font-weight:400;color:var(--muted)">(opcional · JPG, PNG, WEBP · máx. 5 MB c/u)</span>
            <input type="file" id="new-prop-fotos" accept="image/jpeg,image/png,image/webp,image/gif" multiple style="margin-top:8px">
          </label>` : ''}
        <div class="actions" style="margin-top:14px">
          <button class="secondary" id="cancel-property">Cancelar</button>
          <button id="save-property">${isEdit ? 'Guardar cambios' : 'Guardar propiedad'}</button>
        </div>
      </div>
    `);

    document.getElementById('close-modal').onclick    = closeModal;
    document.getElementById('cancel-property').onclick = closeModal;
    document.getElementById('save-property').onclick   = () => saveProperty(editId);
  }

  async function saveProperty(editId) {
    const form    = document.getElementById('property-form');
    const fd      = new FormData(form);
    const payload = {
      titulo:                  fd.get('titulo'),
      tipo:                    fd.get('tipo'),
      operacion:               fd.get('operacion'),
      precio:                  fd.get('precio'),
      moneda:                  fd.get('moneda'),
      piso:                    fd.get('piso'),
      area:                    fd.get('area'),
      habitaciones:            fd.get('habitaciones'),
      banos:                   fd.get('banos'),
      ubicacion:               fd.get('ubicacion'),
      distrito:                fd.get('distrito'),
      ciudad:                  fd.get('ciudad'),
      link_maps:               fd.get('link_maps'),
      referencias:             splitLines(fd.get('referencias')),
      descripcion_original:    fd.get('descripcion_original'),
      mascotas:                fd.get('mascotas') || 'No especificado',
      agua_monto:              fd.get('agua_monto') || null,
      cochera:                 fd.get('cochera') || 'NO_TIENE',
      agua_incluida:           fd.get('agua_incluida') === '1',
      agua_a_consumo:          fd.get('agua_a_consumo') === '1',
      internet_incluido:       fd.get('internet_incluido') === '1',
      mantenimiento_incluido:  fd.get('mantenimiento_incluido') === '1',
      aire_acondicionado:      fd.get('aire_acondicionado') === '1',
      lavanderia:              fd.get('lavanderia') === '1',
      terraza:                 fd.get('terraza') === '1',
      patio:                   fd.get('patio') === '1',
      seguridad:               fd.get('seguridad') === '1',
      rejas:                   fd.get('rejas') === '1',
      porton:                  fd.get('porton') === '1',
      amoblado:                fd.get('amoblado') === '1',
    };

    if (!editId) {
      payload.condiciones = {
        mes_adelantado:  fd.get('mes_adelantado'),
        mes_garantia:    fd.get('mes_garantia'),
        contrato_minimo: fd.get('contrato_minimo'),
      };
    }

    try {
      let res;
      if (editId) {
        res = await request(`/propiedades/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Propiedad actualizada.');
      } else {
        res = await request('/propiedades', { method: 'POST', body: JSON.stringify(payload) });
        const fotosInput = document.getElementById('new-prop-fotos');
        if (fotosInput && fotosInput.files.length > 0) {
          const fd2 = new FormData();
          for (const file of fotosInput.files) fd2.append('fotos[]', file);
          try {
            const fr = await request(`/propiedades/${res.id}/fotos`, { method: 'POST', body: fd2 });
            toast(`Propiedad guardada con ${fr.uploaded?.length || 0} foto(s).`);
          } catch (e2) {
            toast('Propiedad guardada. Error al subir fotos: ' + e2.message);
          }
        } else {
          toast('Propiedad guardada.');
        }
      }
      closeModal();
      await loadData();
      mount();
    } catch (e) {
      toast(e.message);
    }
  }

  async function openPropertyEdit(id) {
    try {
      const res = await request(`/propiedades/${id}`);
      openPropertyForm(res.item, id);
    } catch (e) {
      toast(e.message);
    }
  }

  // ─── Modal: fotos de propiedad ────────────────────────────────────────────

  async function openFotosModal(propId) {
    try {
      const res   = await request(`/propiedades/${propId}/fotos`);
      const fotos = res.items || [];
      renderFotosModal(propId, fotos);
    } catch (e) {
      toast(e.message);
    }
  }

  // Renderiza solo la galería interna (sin abrir/cerrar el modal)
  function _renderFotosGrid(propId, fotos) {
    const isAdmin = state.user?.rol === 'admin';
    if (!fotos.length) {
      return '<p class="muted fotos-empty">Aún no hay fotos para esta propiedad.</p>';
    }
    return fotos.map(f => h`
      <div class="foto-item">
        <img src="${uploadsBase}/propiedades/${propId}/${escapeAttr(f.filename)}" alt="" loading="lazy">
        <div class="foto-btns">
          ${f.es_principal
            ? '<span class="pill pill-green" style="font-size:11px">Principal</span>'
            : (isAdmin ? `<button class="btn-sm btn-outline" data-foto-id="${f.id}" data-action-foto="principal">Principal</button>` : '')}
          ${isAdmin ? `<button class="btn-sm btn-danger" data-foto-id="${f.id}" data-action-foto="delete">×</button>` : ''}
        </div>
      </div>`).join('');
  }

  // Recarga y repinta solo el grid interno del modal (sin cerrar el modal).
  // Devuelve el array de fotos actualizado para que el llamador pueda reusar.
  async function _refrescarFotosGrid(propId) {
    const res   = await request(`/propiedades/${propId}/fotos`);
    const fotos = res.items || [];
    const grid  = document.getElementById('fotos-grid');
    if (grid) grid.innerHTML = _renderFotosGrid(propId, fotos);
    const titulo = document.getElementById('fotos-modal-titulo');
    if (titulo) titulo.textContent = `Fotos · ${fotos.length} imagen${fotos.length !== 1 ? 'es' : ''}`;
    return fotos;
  }

  // Actualiza solo la tarjeta de la propiedad en el listado, sin recargar nada más.
  function _updatePropertyCardFoto(propId, fotos) {
    const principal = fotos.find(f => parseInt(f.es_principal) === 1);
    const newFilename = principal?.filename || null;

    const idx = state.properties.findIndex(p => p.id === propId);
    if (idx !== -1) {
      state.properties[idx] = { ...state.properties[idx], foto_principal: newFilename };
    }

    // Reemplaza solo la tarjeta afectada en el DOM
    const cardEl = document.querySelector(`[data-prop-id="${propId}"]`);
    if (cardEl && idx !== -1) {
      // outerHTML reemplaza el nodo entero; insertAdjacentHTML mantiene el flujo del grid
      const tmp = document.createElement('div');
      tmp.innerHTML = renderPropertyCard(state.properties[idx]);
      cardEl.replaceWith(tmp.firstElementChild);
    } else {
      // Si la tarjeta no está visible (filtros), refresca el listado completo
      const listEl = document.getElementById('prop-list');
      if (listEl) listEl.innerHTML = renderPropList(getFilteredProperties());
    }
  }

  function renderFotosModal(propId, fotos) {
    const isAdmin = state.user?.rol === 'admin';
    openModal(h`
      <div class="modal-header">
        <h3 id="fotos-modal-titulo">Fotos · ${fotos.length} imagen${fotos.length !== 1 ? 'es' : ''}</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body fotos-modal-body">

        <div class="fotos-grid" id="fotos-grid">${_renderFotosGrid(propId, fotos)}</div>

        ${isAdmin ? h`
        <div class="foto-dropzone" id="foto-dropzone" tabindex="0" role="button" aria-label="Zona de carga de imágenes">
          <input type="file" id="fotos-input" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
          <div class="foto-dz-icon">
            <svg width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
            </svg>
          </div>
          <p class="foto-dz-texto">Arrastra imágenes aquí o <span class="link-like">selecciona archivos</span></p>
          <p class="foto-dz-hint">JPG · PNG · WEBP · máx. 5 MB c/u · puedes seleccionar varias</p>
        </div>

        <div id="fotos-preview-wrap" style="display:none">
          <div class="fotos-preview-grid" id="fotos-preview"></div>
          <div class="fotos-upload-bar">
            <span id="fotos-count-label" class="fotos-count"></span>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="secondary" id="btn-cancel-sel">Cancelar selección</button>
              <button id="upload-fotos">Subir fotos</button>
            </div>
          </div>
        </div>
        ` : ''}

        <div class="actions" style="margin-top:16px">
          <button id="cancel-fotos">Cerrar</button>
        </div>
      </div>
    `);

    document.getElementById('close-modal').onclick  = closeModal;
    document.getElementById('cancel-fotos').onclick = closeModal;

    // ── Acciones sobre fotos existentes (actualiza solo el grid) ──────────
    document.getElementById('fotos-grid').addEventListener('click', async e => {
      const btn = e.target.closest('[data-action-foto]');
      if (!btn) return;
      const { actionFoto, fotoId } = btn.dataset;

      if (actionFoto === 'delete') {
        if (!confirm('¿Eliminar esta foto?')) return;
        btn.disabled = true;
        try {
          await request(`/fotos/${fotoId}`, { method: 'DELETE', body: '{}' });
          toast('Foto eliminada.');
          const fotos = await _refrescarFotosGrid(propId);
          _updatePropertyCardFoto(propId, fotos);
        } catch (err) { btn.disabled = false; toast(err.message); }
      }
      if (actionFoto === 'principal') {
        btn.disabled = true;
        try {
          await request(`/fotos/${fotoId}/principal`, { method: 'PUT', body: '{}' });
          toast('Foto principal actualizada.');
          const fotos = await _refrescarFotosGrid(propId);
          _updatePropertyCardFoto(propId, fotos);
        } catch (err) { btn.disabled = false; toast(err.message); }
      }
    });

    // ── Dropzone: drag-and-drop + click (solo admin) ──────────────────────
    if (!isAdmin) return;   // corredores solo ven galería

    let selectedFiles = [];

    const dropzone    = document.getElementById('foto-dropzone');
    const fileInput   = document.getElementById('fotos-input');
    const previewWrap = document.getElementById('fotos-preview-wrap');
    const previewGrid = document.getElementById('fotos-preview');
    const countLabel  = document.getElementById('fotos-count-label');

    // Abrir selector de archivos al hacer clic en la zona
    dropzone.addEventListener('click',   () => fileInput.click());
    dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

    // Drag & drop
    dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('over'); });
    dropzone.addEventListener('dragleave', ()  => dropzone.classList.remove('over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('over');
      showPreview(Array.from(e.dataTransfer.files));
    });

    // Selector de archivo normal
    fileInput.addEventListener('change', () => showPreview(Array.from(fileInput.files)));

    function showPreview(files) {
      if (!files.length) return;
      selectedFiles = files;
      previewGrid.innerHTML = '';
      for (const file of files) {
        const url = URL.createObjectURL(file);
        const div = document.createElement('div');
        div.className = 'preview-thumb';
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.addEventListener('load', () => URL.revokeObjectURL(url));
        const span = document.createElement('span');
        span.className = 'preview-name';
        span.textContent = file.name;
        div.appendChild(img);
        div.appendChild(span);
        previewGrid.appendChild(div);
      }
      countLabel.textContent = `${files.length} foto${files.length !== 1 ? 's' : ''} seleccionada${files.length !== 1 ? 's' : ''}`;
      previewWrap.style.display = '';
    }

    document.getElementById('btn-cancel-sel').addEventListener('click', () => {
      selectedFiles = [];
      fileInput.value = '';
      previewGrid.innerHTML = '';
      previewWrap.style.display = 'none';
    });

    // ── Subida ────────────────────────────────────────────────────────────
    document.getElementById('upload-fotos').addEventListener('click', async () => {
      if (!selectedFiles.length) { toast('Selecciona al menos una foto.'); return; }

      const uploadBtn = document.getElementById('upload-fotos');
      const cancelBtn = document.getElementById('btn-cancel-sel');
      uploadBtn.disabled  = true;
      cancelBtn.disabled  = true;
      uploadBtn.textContent = 'Subiendo…';
      countLabel.textContent = 'Subiendo, por favor espera…';

      const fd = new FormData();
      for (const file of selectedFiles) fd.append('fotos[]', file);

      try {
        const res      = await request(`/propiedades/${propId}/fotos`, { method: 'POST', body: fd });
        const subidas  = res.uploaded?.length || 0;
        const omitidas = res.skipped?.length  || 0;

        // Limpiar área de selección
        selectedFiles = [];
        fileInput.value = '';
        previewGrid.innerHTML = '';
        previewWrap.style.display = 'none';

        // Actualizar galería interna del modal y la tarjeta en el listado de propiedades
        const fotosActualizadas = await _refrescarFotosGrid(propId);
        _updatePropertyCardFoto(propId, fotosActualizadas);

        if (subidas > 0) {
          toast(`${subidas} foto${subidas !== 1 ? 's' : ''} subida${subidas !== 1 ? 's' : ''} correctamente.${omitidas ? ` (${omitidas} omitida${omitidas !== 1 ? 's' : ''})` : ''}`);
        } else {
          toast('No se subió ninguna foto. Revisa el formato y tamaño (máx. 5 MB).');
        }
      } catch (err) {
        uploadBtn.disabled  = false;
        cancelBtn.disabled  = false;
        uploadBtn.textContent = 'Subir fotos';
        countLabel.textContent = '';
        toast('Error al subir: ' + err.message);
      }
    });
  }

  // ─── Vista de detalle de propiedad ───────────────────────────────────────

  async function openPropertyDetailModal(propId) {
    try {
      const res = await request(`/propiedades/${propId}`);
      renderPropertyDetailModal(res.item);
    } catch (e) {
      toast(e.message || 'No se pudo cargar la propiedad.');
    }
  }

  function renderPropertyDetailModal(p) {
    const fotos = p.fotos || [];
    const uploadsUrl = uploadsBase;

    // Galería: la foto principal va primero, luego el resto
    const fotosOrdenadas = [...fotos].sort((a, b) => b.es_principal - a.es_principal);
    const galeriaHtml = fotosOrdenadas.length
      ? h`<div class="detalle-galeria" id="detalle-galeria">
          ${fotosOrdenadas.map(f => h`<img
            src="${uploadsUrl}/propiedades/${p.id}/${escapeAttr(f.filename)}"
            class="detalle-foto${f.es_principal ? ' es-principal' : ''}"
            alt=""
            loading="lazy">`).join('')}
        </div>`
      : '';

    // ── Helpers ──
    const campo = (label, val) => {
      if (val === null || val === undefined || val === '' || val === false) return '';
      return h`<div class="detalle-campo">
                 <span class="detalle-label">${escapeHtml(label)}</span>
                 <span class="detalle-valor">${escapeHtml(String(val))}</span>
               </div>`;
    };

    // Operación y estado pills
    const opCls     = p.operacion === 'Venta' ? 'pill-red' : 'pill-orange';
    const estadoCls = p.estado === 'Disponible' ? 'pill-green'
                    : p.estado === 'Alquilado'  ? 'pill-orange' : 'pill-red';

    // Amenidades (bool fields)
    const amenMap = [
      ['amoblado',              'Amoblado'],
      ['lavanderia',            'Lavandería'],
      ['terraza',               'Terraza'],
      ['patio',                 'Patio'],
      ['seguridad',             'Seguridad'],
      ['rejas',                 'Rejas'],
      ['porton',                'Portón'],
      ['aire_acondicionado',    'Aire acondicionado'],
      ['internet_incluido',     'Internet incluido'],
      ['mantenimiento_incluido','Mantenimiento incluido'],
      ['ninos_permitidos',      'Niños permitidos'],
    ];
    const amenidades = amenMap.filter(([k]) => parseInt(p[k]) === 1).map(([, v]) => v);
    const amenHtml = amenidades.length
      ? h`<div class="detalle-campo detalle-campo-full">
            <span class="detalle-label">Amenidades</span>
            <div class="detalle-pills-wrap">${amenidades.map(a => `<span class="pill pill-gray">${escapeHtml(a)}</span>`).join('')}</div>
          </div>`
      : '';

    // Referencias
    const refs = Array.isArray(p.referencias) && p.referencias.length
      ? h`<div class="detalle-campo detalle-campo-full">
            <span class="detalle-label">Referencias</span>
            <span class="detalle-valor">${escapeHtml(p.referencias.join(' · '))}</span>
          </div>`
      : '';

    // Cochera
    const cocheraVal = p.cochera === 'CARRO' ? 'Sí (carro)' : p.cochera === 'MOTO' ? 'Sí (moto)' : null;

    // Agua
    const aguaVal = parseInt(p.agua_incluida) === 1 ? 'Incluida' : parseInt(p.agua_a_consumo) === 1 ? 'A consumo' : null;

    // Maps link
    const mapsHtml = p.link_maps
      ? h`<div class="detalle-campo detalle-campo-full">
            <span class="detalle-label">Google Maps</span>
            <a href="${escapeAttr(p.link_maps)}" target="_blank" rel="noopener" class="detalle-maps-link">Abrir ubicación</a>
          </div>`
      : '';

    // Descripción
    const descHtml = p.descripcion_original
      ? h`<div class="detalle-desc">
            <div class="detalle-label" style="margin-bottom:6px">Descripción original</div>
            <div class="detalle-desc-text">${escapeHtml(p.descripcion_original)}</div>
          </div>`
      : '';

    openModal(h`
      <div class="modal-header">
        <h3>
          <small class="code-label" style="margin-right:6px">${escapeHtml(p.codigo || '')}</small>${escapeHtml(p.titulo || 'Sin título')}
        </h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body detalle-modal-body">
        ${galeriaHtml}

        <div class="detalle-pills" style="margin:4px 0 12px">
          ${p.operacion ? h`<span class="pill ${opCls}">${escapeHtml(p.operacion)}</span>` : ''}
          ${p.estado    ? h`<span class="pill ${estadoCls}">${escapeHtml(p.estado)}</span>` : ''}
          ${p.tipo      ? h`<span class="pill pill-gray">${escapeHtml(p.tipo)}</span>` : ''}
        </div>

        <div class="detalle-precio">
          ${escapeHtml(p.moneda || 'S/')} ${formatMoney(p.precio)}
        </div>

        <div class="detalle-grid">
          ${campo('Ubicación',        p.ubicacion)}
          ${campo('Distrito',         p.distrito)}
          ${campo('Ciudad',           p.ciudad)}
          ${campo('Piso',             p.piso != null ? 'Piso ' + p.piso : null)}
          ${campo('Habitaciones',     p.habitaciones != null ? p.habitaciones + ' hab.' : null)}
          ${campo('Baños',            p.banos != null ? p.banos + ' baños' : null)}
          ${campo('Medios baños',     p.medios_banos || null)}
          ${campo('Área total',       p.area ? p.area + ' m²' : null)}
          ${campo('Área construida',  p.area_construida ? p.area_construida + ' m²' : null)}
          ${campo('Cochera',          cocheraVal)}
          ${campo('Mascotas',         p.mascotas || null)}
          ${campo('Agua',             aguaVal)}
          ${p.agua_monto ? campo('Monto agua', 'S/ ' + formatMoney(p.agua_monto)) : ''}
          ${p.luz_monto  ? campo('Monto luz',  'S/ ' + formatMoney(p.luz_monto))  : ''}
          ${p.mes_adelantado  ? campo('Meses adelantado', p.mes_adelantado)  : ''}
          ${p.mes_garantia    ? campo('Meses garantía',   p.mes_garantia)    : ''}
          ${p.contrato_minimo ? campo('Contrato mínimo',  p.contrato_minimo + ' meses') : ''}
          ${amenHtml}
          ${refs}
          ${mapsHtml}
        </div>

        ${descHtml}

        <div class="detalle-acciones">
          <button class="secondary" id="btn-detalle-compartir">Compartir</button>
          <button class="secondary" id="btn-detalle-clientes">Clientes recomendados</button>
          ${state.user?.rol === 'admin' ? h`
            <button class="secondary" id="btn-detalle-fotos">Gestionar fotos</button>
            <button class="secondary" id="btn-detalle-editar">Editar</button>
          ` : ''}
        </div>
      </div>
    `);

    document.getElementById('close-modal').onclick = closeModal;
    document.getElementById('btn-detalle-compartir').onclick = () => { closeModal(); openCompartirPropModal(p); };
    document.getElementById('btn-detalle-clientes').onclick  = () => { closeModal(); openClientesRecomendadosModal(p.id); };
    if (state.user?.rol === 'admin') {
      document.getElementById('btn-detalle-fotos').onclick  = () => { closeModal(); openFotosModal(p.id); };
      document.getElementById('btn-detalle-editar').onclick = () => { closeModal(); openPropertyEdit(p.id); };
    }
  }

  // ─── Cambiar estado de propiedad ──────────────────────────────────────────

  // ─── Modal de cierre de operación (Alquilar / Vender) ────────────────────

  async function openCierreModal(propId, estadoNuevo, tituloHint) {
    if (state.user.rol === 'admin' && state.users.length === 0) {
      await loadUsers();
    }
    const tipoOp    = estadoNuevo === 'Vendido' ? 'Venta' : 'Alquiler';
    const btnLabel  = estadoNuevo === 'Vendido' ? 'Vender' : 'Alquilar';
    const today     = new Date().toISOString().slice(0, 10);
    const tituloStr = tituloHint || ('#' + propId);

    const corredorOpts = state.users
      .filter(u => u.rol === 'corredor')
      .map(u => `<option value="${u.id}">${escapeHtml(u.nombre)}</option>`)
      .join('');

    openModal(h`
      <div class="modal-header">
        <h3>${escapeHtml(btnLabel)}: ${escapeHtml(tituloStr)}</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <form id="cierre-form" class="grid-form">
          <label>Tipo de operación
            <input type="text" readonly value="${escapeAttr(tipoOp)}" style="background:var(--bg);cursor:default">
          </label>
          ${inputField('fecha', 'Fecha de cierre *', today, 'date')}

          <label class="full cierre-section-label">Responsable de la operación</label>
          <div class="full radio-group" id="rg-responsable">
            <label class="radio-opt"><input type="radio" name="responsable_tipo" value="admin" checked> Yo mismo (admin)</label>
            ${corredorOpts ? `<label class="radio-opt"><input type="radio" name="responsable_tipo" value="corredor_registrado"> Corredor registrado</label>` : ''}
            <label class="radio-opt"><input type="radio" name="responsable_tipo" value="corredor_externo"> Corredor externo (no registrado)</label>
          </div>
          <div id="sel-corredor-reg" class="full" style="display:none">
            <label>Corredor registrado *
              <select name="cerrado_por_id">
                <option value="">Seleccionar...</option>
                ${corredorOpts}
              </select>
            </label>
          </div>
          <div id="sel-corredor-ext" class="full" style="display:none">
            ${inputField('corredor_externo', 'Nombre del corredor externo *', '', 'text', 'Nombre completo')}
          </div>

          <label class="full cierre-section-label">Comisión</label>
          ${inputField('monto_total', 'Comisión base (S/)', '', 'number', 'Ej: 1500')}
          <div id="comision-corredor-section" style="display:none" class="full">
            <div class="grid-form" style="margin:0;padding:0">
              ${inputField('porcentaje_corredor', '% corredor', '', 'number', 'Ej: 50')}
              ${inputField('monto_corredor', 'Monto corredor (S/)', '', 'number', 'Auto-calculado')}
              ${inputField('monto_admin', 'Monto admin (S/)', '', 'number', 'Auto-calculado')}
            </div>
          </div>

          <label class="full cierre-section-label">Pago</label>
          ${inputField('fecha_pago', 'Fecha de pago (o prevista)', '', 'date')}
          ${selectField('estado_pago', 'Estado de pago', 'Pendiente', ['Pendiente', 'Pagado'])}

          <label class="full">Observaciones
            <textarea name="observaciones" rows="2"></textarea>
          </label>
        </form>
        <div class="actions" style="margin-top:14px">
          <button class="secondary" id="cancel-cierre">Cancelar</button>
          <button id="confirm-cierre">${escapeHtml(btnLabel)}</button>
        </div>
      </div>
    `);

    document.getElementById('close-modal').onclick   = closeModal;
    document.getElementById('cancel-cierre').onclick  = closeModal;

    // Mostrar/ocultar selectores según tipo de responsable
    document.getElementById('rg-responsable').addEventListener('change', e => {
      const val = e.target.value;
      document.getElementById('sel-corredor-reg').style.display          = val === 'corredor_registrado' ? '' : 'none';
      document.getElementById('sel-corredor-ext').style.display          = val === 'corredor_externo'    ? '' : 'none';
      document.getElementById('comision-corredor-section').style.display = val !== 'admin'               ? '' : 'none';
    });

    // Auto-calcular monto corredor / admin según porcentaje
    const recalc = () => {
      const total = parseFloat(document.querySelector('[name=monto_total]')?.value || '0');
      const pct   = parseFloat(document.querySelector('[name=porcentaje_corredor]')?.value || '0');
      if (!isNaN(total) && !isNaN(pct) && total > 0) {
        const mc = Math.round(total * pct / 100 * 100) / 100;
        const ma = Math.round((total - mc) * 100) / 100;
        const inpMc = document.querySelector('[name=monto_corredor]');
        const inpMa = document.querySelector('[name=monto_admin]');
        if (inpMc) inpMc.value = mc;
        if (inpMa) inpMa.value = ma;
      }
    };
    document.querySelector('[name=monto_total]')?.addEventListener('input', recalc);
    document.querySelector('[name=porcentaje_corredor]')?.addEventListener('input', recalc);

    document.getElementById('confirm-cierre').onclick = () => ejecutarCierre(propId, estadoNuevo);
  }

  async function ejecutarCierre(propId, estadoNuevo) {
    const fd              = new FormData(document.getElementById('cierre-form'));
    const responsableTipo = fd.get('responsable_tipo') || 'admin';
    const montoTotalRaw   = fd.get('monto_total');
    const payload = {
      estado:               estadoNuevo,
      fecha:                fd.get('fecha'),
      monto_total:          montoTotalRaw ? parseFloat(montoTotalRaw) : null,
      responsable_tipo:     responsableTipo,
      cerrado_por_id:       responsableTipo === 'corredor_registrado' ? (fd.get('cerrado_por_id') || null) : null,
      corredor_externo:     responsableTipo === 'corredor_externo'    ? (fd.get('corredor_externo') || null) : null,
      porcentaje_corredor:  parseFloat(fd.get('porcentaje_corredor') || '0'),
      monto_corredor:       fd.get('monto_corredor') ? parseFloat(fd.get('monto_corredor')) : null,
      monto_admin:          fd.get('monto_admin')    ? parseFloat(fd.get('monto_admin'))    : null,
      fecha_pago:           fd.get('fecha_pago')     || null,
      estado_pago:          fd.get('estado_pago')    || 'Pendiente',
      observaciones:        fd.get('observaciones')  || null,
    };
    try {
      const res = await request(`/propiedades/${propId}/cerrar`, {
        method: 'POST',
        body:   JSON.stringify(payload),
      });
      const label = estadoNuevo === 'Vendido' ? 'vendida' : 'alquilada';
      toast(`Propiedad marcada como ${label}.${res.comision_id ? ' Comisión registrada.' : ''}`);
      closeModal();
      await loadData();
      mount();
    } catch (err) {
      toast(err.message);
    }
  }

  async function cambiarEstadoPropiedad(id, estado) {
    const msj = estado === 'Disponible'
      ? '¿Marcar como Disponible? Se cancelará la limpieza programada si existe.'
      : `¿Marcar como ${estado}? Las fotos se eliminarán en 24 horas. Puedes revertir antes de ese plazo.`;

    if (!confirm(msj)) return;
    try {
      const res = await request(`/propiedades/${id}/estado`, {
        method: 'PATCH',
        body:   JSON.stringify({ estado }),
      });
      toast(`Estado cambiado a ${estado}.${res.limpieza_programada ? ' Limpieza programada: ' + res.limpieza_programada : ''}`);
      await loadData();
      mount();
    } catch (e) {
      toast(e.message);
    }
  }

  async function eliminarPropiedad(id) {
    try {
      await request(`/propiedades/${id}`, { method: 'DELETE', body: '{}' });
      toast('Propiedad eliminada definitivamente.');
      await loadData();
      mount();
    } catch (e) {
      toast(e.message);
    }
  }

  // ─── Modal: prospecto ────────────────────────────────────────────────────

  function openProspectForm(data = {}) {
    openModal(h`
      <div class="modal-header">
        <h3>${data.id ? 'Editar prospecto' : 'Nuevo prospecto'}</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <form id="prospect-form" class="grid-form">
          ${inputField('nombre',      'Nombre *',      data.nombre || '')}
          ${inputField('dni',         'DNI / Documento', data.dni || '')}
          ${inputField('celular',     'Celular',        data.celular || '')}
          ${inputField('whatsapp',    'WhatsApp',       data.whatsapp || data.celular || '', 'text', 'Igual que celular si no especificas')}
          ${inputField('nacionalidad','Nacionalidad',   data.nacionalidad || 'Peruana')}
          <label class="full">Observaciones
            <textarea name="observaciones" rows="3">${escapeHtml(data.observaciones || '')}</textarea>
          </label>
        </form>
        <div class="actions">
          <button class="secondary" id="cancel-prospect">Cancelar</button>
          <button id="save-prospect">Guardar</button>
        </div>
      </div>
    `);

    document.getElementById('close-modal').onclick    = closeModal;
    document.getElementById('cancel-prospect').onclick = closeModal;
    document.getElementById('save-prospect').onclick   = () => saveProspect(data.id || null);

    // Auto-fill whatsapp from celular if whatsapp is empty
    const celInput = document.querySelector('#prospect-form [name="celular"]');
    const waInput  = document.querySelector('#prospect-form [name="whatsapp"]');
    if (celInput && waInput && !data.id) {
      celInput.addEventListener('input', () => {
        if (!waInput.value || waInput.value === celInput._lastCel) {
          waInput.value = celInput.value;
        }
        celInput._lastCel = celInput.value;
      });
    }
  }

  async function saveProspect(editId) {
    const fd      = new FormData(document.getElementById('prospect-form'));
    const payload = {
      nombre:       fd.get('nombre'),
      dni:          fd.get('dni')          || null,
      celular:      fd.get('celular')      || null,
      whatsapp:     fd.get('whatsapp')     || fd.get('celular') || null,
      nacionalidad: fd.get('nacionalidad') || null,
      observaciones:fd.get('observaciones') || null,
    };
    try {
      if (editId) {
        await request(`/prospectos/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Prospecto actualizado.');
      } else {
        await request('/prospectos', { method: 'POST', body: JSON.stringify(payload) });
        toast('Prospecto guardado.');
      }
      closeModal();
      await loadData();
      mount();
    } catch (e) {
      toast(e.message);
    }
  }

  async function openProspectEdit(id) {
    try {
      const res = await request(`/prospectos/${id}`);
      openProspectForm(res.item);
    } catch (e) {
      toast(e.message);
    }
  }

  // ─── Modal: comentarios de prospecto ─────────────────────────────────────

  async function openComentariosModal(prospId, nombre) {
    try {
      const res         = await request(`/prospectos/${prospId}/comentarios`);
      const comentarios = res.items || [];
      renderComentariosModal(prospId, nombre, comentarios);
    } catch (e) {
      toast(e.message);
    }
  }

  function renderComentariosModal(prospId, nombre, comentarios) {
    const lista = comentarios.length
      ? comentarios.map(c => h`
          <div class="comentario-item">
            <div class="comentario-meta">
              <b>${escapeHtml(c.autor)}</b>
              <span class="pill pill-gray" style="font-size:11px">${escapeHtml(c.autor_rol)}</span>
              <small class="muted">${escapeHtml(c.created_at)}</small>
            </div>
            <p>${escapeHtml(c.comentario)}</p>
          </div>`).join('')
      : '<p class="muted">Sin comentarios aún.</p>';

    openModal(h`
      <div class="modal-header">
        <h3>Comentarios · ${escapeHtml(nombre)}</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <div class="comentarios-lista" id="comentarios-lista">
          ${lista}
        </div>
        <hr style="margin:16px 0">
        <label><b>Agregar comentario</b>
          <textarea id="nuevo-comentario" rows="3" placeholder="Escribe tu comentario interno aquí..."></textarea>
        </label>
        <div class="actions" style="margin-top:10px">
          <button class="secondary" id="cancel-comentario">Cerrar</button>
          <button id="save-comentario">Agregar</button>
        </div>
      </div>
    `);

    document.getElementById('close-modal').onclick       = closeModal;
    document.getElementById('cancel-comentario').onclick  = closeModal;
    document.getElementById('save-comentario').onclick    = async () => {
      const text = document.getElementById('nuevo-comentario').value.trim();
      if (!text) { toast('Escribe algo primero.'); return; }
      try {
        await request(`/prospectos/${prospId}/comentarios`, {
          method: 'POST',
          body:   JSON.stringify({ comentario: text }),
        });
        await openComentariosModal(prospId, nombre);
      } catch (err) {
        toast(err.message);
      }
    };
  }

  // ─── Modal: usuario (admin) ───────────────────────────────────────────────

  function openUserForm(data = {}) {
    openModal(h`
      <div class="modal-header">
        <h3>${data.id ? 'Editar usuario' : 'Nuevo usuario'}</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <form id="user-form" class="grid-form">
          ${inputField('nombre',   'Nombre *',               data.nombre   || '')}
          ${inputField('username', 'Usuario (login sin @)',   data.username || '')}
          ${inputField('correo',   'Correo (login con @)',    data.correo   || '', 'email')}
          <small class="full muted" style="margin-top:-8px">Al menos uno de los dos es obligatorio.</small>
          ${selectField('rol',    'Rol',        data.rol || 'corredor', ['admin', 'corredor'])}
          ${!data.id ? inputField('password', 'Contraseña * (mín. 6 caracteres)', '', 'password') : ''}
        </form>
        <div class="actions">
          <button class="secondary" id="cancel-user">Cancelar</button>
          <button id="save-user">Guardar</button>
        </div>
      </div>
    `);

    document.getElementById('close-modal').onclick = closeModal;
    document.getElementById('cancel-user').onclick  = closeModal;
    document.getElementById('save-user').onclick    = () => saveUser(data.id || null);
  }

  async function saveUser(editId) {
    const fd      = new FormData(document.getElementById('user-form'));
    const payload = Object.fromEntries(fd.entries());
    // Limpiar campos vacíos para que el backend reciba null (no string vacío)
    if (!payload.correo)   delete payload.correo;
    if (!payload.username) delete payload.username;
    if (!editId && !payload.correo && !payload.username) {
      toast('Ingresa al menos un correo o un nombre de usuario.');
      return;
    }
    console.log('[saveUser] payload →', payload);
    try {
      if (editId) {
        await request(`/usuarios/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Usuario actualizado.');
      } else {
        await request('/usuarios', { method: 'POST', body: JSON.stringify(payload) });
        toast('Usuario creado.');
      }
      closeModal();
      await loadUsers();
      mount();
    } catch (e) {
      toast(e.message);
    }
  }

  async function openUserEdit(id) {
    try {
      const res = await request(`/usuarios/${id}`);
      openUserForm(res.item);
    } catch (e) {
      toast(e.message);
    }
  }

  function openPasswordModal(userId, nombre) {
    openModal(h`
      <div class="modal-header">
        <h3>Cambiar contraseña · ${escapeHtml(nombre)}</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <form id="password-form" class="grid-form">
          <label class="full">Nueva contraseña (mín. 6 caracteres)
            <input type="password" name="password" required minlength="6">
          </label>
        </form>
        <div class="actions">
          <button class="secondary" id="cancel-pw">Cancelar</button>
          <button id="save-pw">Guardar</button>
        </div>
      </div>
    `);

    document.getElementById('close-modal').onclick = closeModal;
    document.getElementById('cancel-pw').onclick   = closeModal;
    document.getElementById('save-pw').onclick     = async () => {
      const pw = document.querySelector('#password-form [name="password"]').value;
      if (pw.length < 6) { toast('Mínimo 6 caracteres.'); return; }
      try {
        await request(`/usuarios/${userId}/password`, {
          method: 'PUT',
          body:   JSON.stringify({ password: pw }),
        });
        toast('Contraseña actualizada.');
        closeModal();
      } catch (e) {
        toast(e.message);
      }
    };
  }

  async function toggleUser(id, nuevoActivo) {
    if (!confirm(`¿${nuevoActivo ? 'Activar' : 'Inactivar'} este usuario?`)) return;
    try {
      await request(`/usuarios/${id}/estado`, {
        method: 'PATCH',
        body:   JSON.stringify({ activo: nuevoActivo }),
      });
      toast(`Usuario ${nuevoActivo ? 'activado' : 'inactivado'}.`);
      await loadUsers();
      mount();
    } catch (e) {
      toast(e.message);
    }
  }

  // ─── Helpers de formulario ────────────────────────────────────────────────

  function inputField(name, label, value, type = 'text', placeholder = '') {
    return h`
      <label>
        ${escapeHtml(label)}
        <input type="${type}" name="${name}" value="${escapeAttr(String(value))}" placeholder="${escapeAttr(placeholder)}">
      </label>`;
  }

  function selectField(name, label, value, options) {
    const opts = options.map(o => `<option value="${escapeAttr(o)}" ${o === value ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
    return h`
      <label>
        ${escapeHtml(label)}
        <select name="${name}">${opts}</select>
      </label>`;
  }

  function checkboxField(name, label, checked) {
    return h`
      <label class="check">
        <input type="checkbox" name="${name}" value="1" ${checked ? 'checked' : ''}>
        <span>${escapeHtml(label)}</span>
      </label>`;
  }

  function renderParserNotes(data) {
    const missing  = (data.faltantes   || []).map(x => `<li>${escapeHtml(x)}</li>`).join('');
    const warnings = (data.advertencias || []).map(x => `<li>${escapeHtml(x)}</li>`).join('');
    if (!missing && !warnings) return '';
    return h`
      <section class="parser-notes">
        ${missing  ? `<div><strong>Campos faltantes:</strong><ul>${missing}</ul></div>`  : ''}
        ${warnings ? `<div><strong>Advertencias:</strong><ul>${warnings}</ul></div>` : ''}
      </section>`;
  }

  // ─── Comisiones ───────────────────────────────────────────────────────────

  function renderComisiones() {
    const res = state._comResumen || {};
    const items = state.comisiones || [];
    return h`
      <section class="toolbar">
        <div>
          <h1>Comisiones</h1>
          <p>${items.length} registros encontrados.</p>
        </div>
        <div class="actions">
          <button id="btn-new-comision">Nueva comisión</button>
        </div>
      </section>
      <section class="stats-grid">
        <article class="card stat">
          <span>${items.length}</span><small>Operaciones</small>
        </article>
        <article class="card stat stat-green">
          <span>S/ ${formatMoney(res.monto_total || 0)}</span><small>Total recibido</small>
        </article>
        <article class="card stat stat-orange">
          <span>S/ ${formatMoney(res.monto_corredor || 0)}</span><small>Parte corredor</small>
        </article>
        <article class="card stat">
          <span>S/ ${formatMoney(res.monto_admin || 0)}</span><small>Parte admin</small>
        </article>
      </section>
      <section class="list-grid">
        ${items.length
          ? items.map(c => h`
            <article class="card">
              <div class="property-top">
                <div>
                  <small class="code-label">${escapeHtml(c.propiedad_codigo || '')}</small>
                  <h3>${escapeHtml(c.propiedad_titulo || 'Sin título')}</h3>
                </div>
                <span class="pill ${c.tipo_operacion === 'Venta' ? 'pill-red' : 'pill-orange'}">${escapeHtml(c.tipo_operacion)}</span>
              </div>
              <p><b>S/ ${formatMoney(c.monto_total)}</b> total · ${escapeHtml(c.fecha || '')}</p>
              ${c.monto_corredor != null ? h`<p class="muted">Corredor: S/ ${formatMoney(c.monto_corredor)}${c.porcentaje_corredor ? ` (${escapeHtml(String(c.porcentaje_corredor))}%)` : ''}</p>` : ''}
              ${c.monto_admin    != null ? h`<p class="muted">Admin: S/ ${formatMoney(c.monto_admin)}</p>` : ''}
              <p class="muted" style="font-size:12px">Responsable: ${escapeHtml(c.cerrado_por_nombre || c.corredor_externo ? (c.cerrado_por_nombre || ('Ext. · ' + c.corredor_externo)) : (c.registrado_por_nombre || 'Admin'))}</p>
              <p class="muted" style="font-size:12px">
                Pago: <span class="pill ${c.estado_pago === 'Pagado' ? 'pill-green' : 'pill-gray'}" style="font-size:11px">${escapeHtml(c.estado_pago || 'Pendiente')}</span>
                ${c.fecha_pago ? ` · ${escapeHtml(c.fecha_pago)}` : ''}
              </p>
              ${c.observaciones ? h`<p style="font-size:12px">${escapeHtml(c.observaciones)}</p>` : ''}
              <div class="card-btns">
                <button class="btn-sm btn-outline" data-action="edit-comision" data-id="${c.id}">Editar</button>
              </div>
            </article>`).join('')
          : '<article class="card"><p>No hay comisiones registradas.</p></article>'}
      </section>
    `;
  }

  function openComisionForm(data = {}) {
    const isEdit = !!data.id;
    const propOptions = state.properties.map(p =>
      `<option value="${p.id}" ${data.propiedad_id == p.id ? 'selected' : ''}>${escapeHtml(p.codigo + ' · ' + (p.titulo || 'Sin título'))}</option>`
    ).join('');

    const corredorOptions = state.users.filter(u => u.rol === 'corredor').map(u =>
      `<option value="${u.id}" ${data.cerrado_por_id == u.id ? 'selected' : ''}>${escapeHtml(u.nombre)}</option>`
    ).join('');

    // Determinar tipo de responsable inicial para el formulario de edición
    let respTipoInit = 'admin';
    if (data.cerrado_por_id) respTipoInit = 'corredor_registrado';
    else if (data.corredor_externo) respTipoInit = 'corredor_externo';

    const isAdmin = state.user.rol === 'admin';

    openModal(h`
      <div class="modal-header">
        <h3>${isEdit ? 'Editar comisión' : 'Nueva comisión'}</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <form id="comision-form" class="grid-form">
          <label class="full">Propiedad *
            <select name="propiedad_id" required>
              <option value="">Seleccionar...</option>
              ${propOptions}
            </select>
          </label>
          ${selectField('tipo_operacion', 'Tipo de operación', data.tipo_operacion || 'Alquiler', ['Alquiler','Venta'])}
          ${inputField('fecha', 'Fecha *', data.fecha || new Date().toISOString().slice(0,10), 'date')}
          ${inputField('monto_total', 'Comisión base (S/) *', data.monto_total ?? '', 'number')}

          ${isAdmin ? h`
            <label class="full cierre-section-label">Responsable</label>
            <div class="full radio-group" id="rg-responsable-com">
              <label class="radio-opt"><input type="radio" name="responsable_tipo" value="admin" ${respTipoInit === 'admin' ? 'checked' : ''}> Yo mismo (admin)</label>
              ${corredorOptions ? `<label class="radio-opt"><input type="radio" name="responsable_tipo" value="corredor_registrado" ${respTipoInit === 'corredor_registrado' ? 'checked' : ''}> Corredor registrado</label>` : ''}
              <label class="radio-opt"><input type="radio" name="responsable_tipo" value="corredor_externo" ${respTipoInit === 'corredor_externo' ? 'checked' : ''}> Corredor externo</label>
            </div>
            <div id="com-sel-reg" class="full" style="display:${respTipoInit === 'corredor_registrado' ? '' : 'none'}">
              <label>Corredor registrado
                <select name="cerrado_por_id">
                  <option value="">Seleccionar...</option>
                  ${corredorOptions}
                </select>
              </label>
            </div>
            <div id="com-sel-ext" class="full" style="display:${respTipoInit === 'corredor_externo' ? '' : 'none'}">
              ${inputField('corredor_externo', 'Nombre corredor externo', data.corredor_externo || '', 'text')}
            </div>
            <div id="com-sec-corredor" class="full" style="display:${respTipoInit !== 'admin' ? '' : 'none'}">
              <div class="grid-form" style="margin:0;padding:0">
                ${inputField('porcentaje_corredor', '% corredor', data.porcentaje_corredor ?? '', 'number', 'Ej: 50')}
                ${inputField('monto_corredor', 'Monto corredor (S/)', data.monto_corredor ?? '', 'number')}
                ${inputField('monto_admin', 'Monto admin (S/)', data.monto_admin ?? '', 'number')}
              </div>
            </div>` : ''}

          ${inputField('fecha_pago', 'Fecha de pago (o prevista)', data.fecha_pago || '', 'date')}
          ${selectField('estado_pago', 'Estado de pago', data.estado_pago || 'Pendiente', ['Pendiente', 'Pagado'])}
          <label class="full">Observaciones
            <textarea name="observaciones" rows="2">${escapeHtml(data.observaciones || '')}</textarea>
          </label>
        </form>
        <div class="actions" style="margin-top:14px">
          <button class="secondary" id="cancel-comision">Cancelar</button>
          <button id="save-comision">Guardar</button>
        </div>
      </div>
    `);

    document.getElementById('close-modal').onclick    = closeModal;
    document.getElementById('cancel-comision').onclick = closeModal;

    if (isAdmin) {
      document.getElementById('rg-responsable-com')?.addEventListener('change', e => {
        const val = e.target.value;
        document.getElementById('com-sel-reg').style.display     = val === 'corredor_registrado' ? '' : 'none';
        document.getElementById('com-sel-ext').style.display     = val === 'corredor_externo'    ? '' : 'none';
        document.getElementById('com-sec-corredor').style.display = val !== 'admin'              ? '' : 'none';
      });
      const recalcCom = () => {
        const total = parseFloat(document.querySelector('#comision-form [name=monto_total]')?.value || '0');
        const pct   = parseFloat(document.querySelector('#comision-form [name=porcentaje_corredor]')?.value || '0');
        if (!isNaN(total) && !isNaN(pct) && total > 0) {
          const mc = Math.round(total * pct / 100 * 100) / 100;
          document.querySelector('#comision-form [name=monto_corredor]').value = mc;
          document.querySelector('#comision-form [name=monto_admin]').value    = Math.round((total - mc) * 100) / 100;
        }
      };
      document.querySelector('#comision-form [name=monto_total]')?.addEventListener('input', recalcCom);
      document.querySelector('#comision-form [name=porcentaje_corredor]')?.addEventListener('input', recalcCom);
    }

    document.getElementById('save-comision').onclick = () => saveComision(data.id || null);
  }

  async function saveComision(editId) {
    const fd              = new FormData(document.getElementById('comision-form'));
    const responsableTipo = fd.get('responsable_tipo') || 'admin';
    const payload = {
      propiedad_id:        fd.get('propiedad_id'),
      tipo_operacion:      fd.get('tipo_operacion'),
      fecha:               fd.get('fecha'),
      monto_total:         fd.get('monto_total'),
      porcentaje_corredor: fd.get('porcentaje_corredor') || null,
      monto_corredor:      fd.get('monto_corredor') || null,
      monto_admin:         fd.get('monto_admin')    || null,
      cerrado_por_id:      responsableTipo === 'corredor_registrado' ? (fd.get('cerrado_por_id') || null) : null,
      corredor_externo:    responsableTipo === 'corredor_externo'    ? (fd.get('corredor_externo') || null) : null,
      fecha_pago:          fd.get('fecha_pago')  || null,
      estado_pago:         fd.get('estado_pago') || 'Pendiente',
      observaciones:       fd.get('observaciones'),
    };
    try {
      if (editId) {
        await request(`/comisiones/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Comisión actualizada.');
      } else {
        await request('/comisiones', { method: 'POST', body: JSON.stringify(payload) });
        toast('Comisión registrada.');
      }
      closeModal();
      await loadComisiones();
      mount();
    } catch (e) {
      toast(e.message);
    }
  }

  async function openComisionEdit(id) {
    try {
      const res = await request(`/comisiones/${id}`);
      // Cargar usuarios si aún no están
      if (state.user.rol === 'admin' && state.users.length === 0) {
        await loadUsers();
      }
      openComisionForm(res.item);
    } catch (e) {
      toast(e.message);
    }
  }

  // ─── Citas ────────────────────────────────────────────────────────────────

  function renderCitas() {
    const citas = state.citas || [];
    return h`
      <section class="toolbar">
        <div>
          <h1>Citas</h1>
          <p>${citas.length} registros.</p>
        </div>
        <div class="actions">
          <button id="btn-parse-cita" class="secondary">Pegar plantilla</button>
          <button id="btn-new-cita">Nueva cita manual</button>
        </div>
      </section>
      <section class="list-grid">
        ${citas.length
          ? citas.map(renderCitaCard).join('')
          : '<article class="card"><p>No hay citas registradas.</p></article>'}
      </section>
    `;
  }

  function buildCitaPlantilla(c) {
    const tipo    = (c.tipo || 'VISITA').toUpperCase();
    const fecha   = c.fecha  || '';
    const hora    = c.hora   ? formatHora12(c.hora) : '';
    const lugar   = c.ubicacion || c.propiedad_titulo || '';
    const cliente = c.prospecto_nombre || '';
    const celular = c.prospecto_celular || c.prospecto_whatsapp || '';

    // Formatear fecha dd-mm-yyyy si viene en yyyy-mm-dd
    let fechaFmt = fecha;
    const fdm = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (fdm) fechaFmt = `${fdm[3]}-${fdm[2]}-${fdm[1]}`;

    let lines = [`${tipo}: ${fechaFmt}`];
    if (hora)    lines.push(`HORA: ${hora}`);
    if (lugar)   lines.push(`LUGAR: ${lugar}`);
    if (cliente) lines.push(`CLIENTE: ${cliente}`);
    if (celular) lines.push(`CELULAR: ${celular}`);
    return lines.join('\n');
  }

  function formatHora12(t) {
    // t = "HH:MM:SS" o "HH:MM"
    const parts = t.split(':');
    let h = parseInt(parts[0], 10);
    const m = parts[1] || '00';
    const period = h >= 12 ? 'pm' : 'am';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${period}`;
  }

  function renderCitaCard(c) {
    const estadoCls = c.estado === 'Completada' ? 'pill-green'
                    : c.estado === 'Cancelada'  ? 'pill-red'
                    : 'pill-orange';
    return h`
      <article class="card">
        <div class="property-top">
          <div>
            <small class="code-label">${escapeHtml(c.tipo || 'Visita')}</small>
            <h3>${escapeHtml(c.titulo || c.tipo || 'Cita')}</h3>
          </div>
          <span class="pill ${estadoCls}">${escapeHtml(c.estado || 'Pendiente')}</span>
        </div>
        <p>${escapeHtml(formatFechaLegible(c.fecha))} ${c.hora ? ' · ' + escapeHtml(formatHora12(c.hora)) : ''}</p>
        ${c.prospecto_nombre ? h`<p class="muted">${escapeHtml(c.prospecto_nombre)}</p>` : ''}
        ${c.propiedad_titulo ? h`<p class="muted" style="font-size:12px">${escapeHtml(c.propiedad_titulo)}</p>` : ''}
        ${c.ubicacion ? h`<p style="font-size:12px">${escapeHtml(c.ubicacion)}</p>` : ''}
        ${c.notas ? h`<p style="font-size:12px;color:var(--muted)">${escapeHtml(c.notas)}</p>` : ''}
        <div class="card-btns">
          <button class="btn-sm btn-outline" data-action="edit-cita" data-id="${c.id}">Editar</button>
          <button class="btn-sm btn-outline" data-action="compartir-cita" data-id="${c.id}">Compartir</button>
          <button class="btn-sm btn-danger"  data-action="delete-cita" data-id="${c.id}">Eliminar</button>
        </div>
      </article>
    `;
  }

  function formatFechaLegible(fecha) {
    if (!fecha) return '';
    const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return fecha;
  }

  async function openCitaForm(editId = null, defaults = {}) {
    let data = defaults;
    if (editId) {
      try {
        // Buscar en state.citas primero
        const found = state.citas.find(c => c.id === editId);
        if (found) data = found;
      } catch (_) {}
    }

    const prospOpts = state.prospects.map(p =>
      `<option value="${p.id}" ${data.prospecto_id == p.id ? 'selected' : ''}>${escapeHtml(p.nombre)}</option>`
    ).join('');
    const propOpts = state.properties.map(p =>
      `<option value="${p.id}" ${data.propiedad_id == p.id ? 'selected' : ''}>${escapeHtml((p.codigo || '') + ' · ' + (p.titulo || 'Sin título'))}</option>`
    ).join('');

    openModal(h`
      <div class="modal-header">
        <h3>${editId ? 'Editar cita' : 'Nueva cita'}</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <form id="cita-form" class="grid-form">
          ${inputField('titulo', 'Título / motivo', data.titulo || '')}
          ${selectField('tipo', 'Tipo', data.tipo || 'Visita', ['Visita','Llamada','Reunión','Firma','Otro'])}
          ${inputField('fecha', 'Fecha *', data.fecha || new Date().toISOString().slice(0,10), 'date')}
          ${inputField('hora',  'Hora',   data.hora ? data.hora.slice(0,5) : '', 'time')}
          ${inputField('duracion_min', 'Duración (min)', data.duracion_min ?? 60, 'number')}
          <label class="full">Prospecto
            <select name="prospecto_id">
              <option value="">Sin prospecto</option>
              ${prospOpts}
            </select>
          </label>
          <label class="full">Propiedad
            <select name="propiedad_id">
              <option value="">Sin propiedad</option>
              ${propOpts}
            </select>
          </label>
          ${inputField('ubicacion', 'Lugar / dirección', data.ubicacion || '')}
          ${selectField('estado', 'Estado', data.estado || 'Pendiente', ['Pendiente','Completada','Cancelada'])}
          <label class="full">Notas
            <textarea name="notas" rows="2">${escapeHtml(data.notas || '')}</textarea>
          </label>
        </form>
        <div class="actions" style="margin-top:14px">
          <button class="secondary" id="cancel-cita">Cancelar</button>
          <button id="save-cita">Guardar</button>
        </div>
      </div>
    `);

    document.getElementById('close-modal').onclick = closeModal;
    document.getElementById('cancel-cita').onclick  = closeModal;
    document.getElementById('save-cita').onclick    = () => saveCita(editId);
  }

  async function saveCita(editId) {
    const fd = new FormData(document.getElementById('cita-form'));
    const payload = {
      titulo:       fd.get('titulo')       || null,
      tipo:         fd.get('tipo')         || 'Visita',
      fecha:        fd.get('fecha'),
      hora:         fd.get('hora')         || null,
      duracion_min: fd.get('duracion_min') || 60,
      prospecto_id: fd.get('prospecto_id') || null,
      propiedad_id: fd.get('propiedad_id') || null,
      ubicacion:    fd.get('ubicacion')    || null,
      estado:       fd.get('estado')       || 'Pendiente',
      notas:        fd.get('notas')        || null,
    };
    try {
      if (editId) {
        await request(`/citas/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Cita actualizada.');
      } else {
        await request('/citas', { method: 'POST', body: JSON.stringify(payload) });
        toast('Cita creada.');
      }
      closeModal();
      await loadCitas();
      await loadDashboard();
      mount();
    } catch (e) {
      toast(e.message);
    }
  }

  // ─── Parser de plantilla de cita ─────────────────────────────────────────

  function openParseCitaModal() {
    openModal(h`
      <div class="modal-header">
        <h3>Agregar cita desde plantilla</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--muted);margin-bottom:10px">
          Pega el texto con el formato de tu plantilla habitual:
        </p>
        <label>
          <textarea id="parse-cita-text" rows="7" placeholder="VISITA: 29-03-2026&#10;HORA: 11:00 am&#10;LUGAR: Av Lloque Yupanqui 2do PISO (950)&#10;CLIENTE: Alexander Mori&#10;CELULAR: 992 596 825" style="font-family:monospace;font-size:13px"></textarea>
        </label>
        <div class="actions" style="margin-top:12px">
          <button class="secondary" id="cancel-parse-cita">Cancelar</button>
          <button id="run-parse-cita">Interpretar</button>
        </div>
      </div>
    `);
    document.getElementById('close-modal').onclick      = closeModal;
    document.getElementById('cancel-parse-cita').onclick = closeModal;
    document.getElementById('run-parse-cita').onclick    = async () => {
      const text = document.getElementById('parse-cita-text').value.trim();
      if (!text) { toast('Pega el texto primero.'); return; }
      const btn = document.getElementById('run-parse-cita');
      btn.disabled = true;
      btn.textContent = 'Interpretando…';
      try {
        const res = await request('/citas/parse', { method: 'POST', body: JSON.stringify({ text }) });
        openParseCitaStep2(res);
      } catch (e) {
        toast(e.message);
        btn.disabled = false;
        btn.textContent = 'Interpretar';
      }
    };
  }

  function openParseCitaStep2(res) {
    const parsed      = res.parsed || {};
    const prospectos  = res.prospectos || [];
    const propiedades = res.propiedades || [];

    // Build prospect selection HTML
    let prospHTML = '';
    if (prospectos.length === 1) {
      prospHTML = h`
        <div class="parse-suggestion">
          <span class="pill pill-green" style="font-size:11px">Encontrado</span>
          <b>${escapeHtml(prospectos[0].nombre)}</b>
          <span class="muted">${escapeHtml(prospectos[0].celular || '')}</span>
          <input type="hidden" id="parse-prospecto-id" value="${prospectos[0].id}">
        </div>
        <label style="margin-top:6px;display:block">
          <input type="radio" name="prosp-action" value="use" checked> Usar este prospecto
        </label>
        <label style="display:block">
          <input type="radio" name="prosp-action" value="new"> Crear nuevo prospecto con estos datos
        </label>`;
    } else if (prospectos.length > 1) {
      const opts = prospectos.map(p =>
        `<option value="${p.id}">${escapeHtml(p.nombre)} · ${escapeHtml(p.celular || '')}</option>`
      ).join('');
      prospHTML = h`
        <label>Selecciona el prospecto
          <select id="parse-prospecto-id">
            ${opts}
          </select>
        </label>
        <label style="margin-top:6px;display:block">
          <input type="radio" name="prosp-action" value="use" checked> Usar el seleccionado
        </label>
        <label style="display:block">
          <input type="radio" name="prosp-action" value="new"> Crear nuevo prospecto
        </label>`;
    } else {
      prospHTML = h`
        <p class="muted" style="font-size:13px">No se encontró un prospecto coincidente.</p>
        <label><input type="radio" name="prosp-action" value="new" checked> Crear nuevo prospecto: <b>${escapeHtml(parsed.cliente || 'Sin nombre')}</b> · ${escapeHtml(parsed.celular || '')}</label>
        <label style="margin-top:4px;display:block"><input type="radio" name="prosp-action" value="none"> Sin prospecto por ahora</label>`;
    }

    // Build property selection HTML
    let propHTML = '';
    if (propiedades.length === 1) {
      const p = propiedades[0];
      const refs = (p.referencias || []).join(', ');
      propHTML = h`
        <div class="parse-suggestion">
          <span class="pill pill-green" style="font-size:11px">Sugerida</span>
          <b>${escapeHtml(p.titulo || p.codigo)}</b>
          <span class="muted">${escapeHtml(p.ubicacion || p.distrito || '')}</span>
          <input type="hidden" id="parse-prop-suggested" value="${p.id}">
        </div>
        <label style="margin-top:6px;display:block"><input type="radio" name="prop-action" value="use" checked> Usar esta propiedad</label>
        <label style="display:block"><input type="radio" name="prop-action" value="manual"> Seleccionar manualmente</label>
        <label style="display:block"><input type="radio" name="prop-action" value="none"> Sin propiedad</label>`;
    } else if (propiedades.length > 1) {
      const opts = propiedades.map(p =>
        `<option value="${p.id}">${escapeHtml((p.codigo||'') + ' · ' + (p.titulo||'Sin título') + (p.ubicacion ? ' · '+p.ubicacion : ''))}</option>`
      ).join('');
      propHTML = h`
        <label>Propiedades sugeridas
          <select id="parse-prop-suggested">
            ${opts}
          </select>
        </label>
        <label style="margin-top:6px;display:block"><input type="radio" name="prop-action" value="use" checked> Usar la seleccionada</label>
        <label style="display:block"><input type="radio" name="prop-action" value="manual"> Seleccionar manualmente</label>
        <label style="display:block"><input type="radio" name="prop-action" value="none"> Sin propiedad</label>`;
    } else {
      const allPropOpts = state.properties.map(p =>
        `<option value="${p.id}">${escapeHtml((p.codigo||'') + ' · ' + (p.titulo||'Sin título'))}</option>`
      ).join('');
      propHTML = h`
        <p class="muted" style="font-size:13px">No se identificó la propiedad automáticamente.</p>
        <label style="margin-top:4px">Seleccionar manualmente
          <select id="parse-prop-manual">
            <option value="">Sin propiedad</option>
            ${allPropOpts}
          </select>
        </label>`;
    }

    // Manual fallback select (shown when radio "manual" selected)
    const allPropOpts2 = state.properties.map(p =>
      `<option value="${p.id}">${escapeHtml((p.codigo||'') + ' · ' + (p.titulo||'Sin título'))}</option>`
    ).join('');

    // Format fecha display
    const fechaDisplay = parsed.fecha
      ? parsed.fecha.split('-').reverse().join('-')
      : '—';

    openModal(h`
      <div class="modal-header">
        <h3>Confirmar cita</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <div class="parse-extracted" style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            <div><span class="muted">Tipo:</span> <b>${escapeHtml(parsed.tipo || 'Visita')}</b></div>
            <div><span class="muted">Fecha:</span> <b>${escapeHtml(fechaDisplay)}</b></div>
            <div><span class="muted">Hora:</span> <b>${escapeHtml(parsed.hora ? parsed.hora.slice(0,5) : '—')}</b></div>
            <div><span class="muted">Lugar:</span> <b>${escapeHtml(parsed.lugar || '—')}</b></div>
            <div><span class="muted">Cliente:</span> <b>${escapeHtml(parsed.cliente || '—')}</b></div>
            <div><span class="muted">Celular:</span> <b>${escapeHtml(parsed.celular || '—')}</b></div>
          </div>
        </div>

        <div class="parse-section">
          <h4 style="margin:0 0 8px">Prospecto</h4>
          ${prospHTML}
        </div>

        <div class="parse-section" style="margin-top:14px">
          <h4 style="margin:0 0 8px">Propiedad</h4>
          ${propHTML}
          <div id="prop-manual-wrap" style="display:none;margin-top:8px">
            <label>Seleccionar propiedad
              <select id="parse-prop-manual-fallback">
                <option value="">Sin propiedad</option>
                ${allPropOpts2}
              </select>
            </label>
          </div>
        </div>

        <div class="parse-section" style="margin-top:14px">
          <h4 style="margin:0 0 8px">Datos de la cita</h4>
          <form id="parse-cita-final-form" class="grid-form">
            ${inputField('titulo',  'Título (opcional)', parsed.cliente ? `Visita ${parsed.cliente}` : '')}
            ${inputField('fecha',   'Fecha',  parsed.fecha  || '', 'date')}
            ${inputField('hora',    'Hora',   parsed.hora ? parsed.hora.slice(0,5) : '', 'time')}
            ${inputField('ubicacion','Lugar', parsed.lugar  || '')}
          </form>
        </div>

        <div class="actions" style="margin-top:16px">
          <button class="secondary" id="back-parse-cita">Volver</button>
          <button id="confirm-parse-cita">Crear cita</button>
        </div>
      </div>
    `);

    document.getElementById('close-modal').onclick    = closeModal;
    document.getElementById('back-parse-cita').onclick = openParseCitaModal;

    // Show/hide manual prop selector based on radio
    document.querySelectorAll('[name="prop-action"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const wrap = document.getElementById('prop-manual-wrap');
        if (wrap) wrap.style.display = radio.value === 'manual' ? '' : 'none';
      });
    });

    document.getElementById('confirm-parse-cita').onclick = async () => {
      const fd = new FormData(document.getElementById('parse-cita-final-form'));

      // Resolver prospecto_id
      let prospId = null;
      const prospAction = document.querySelector('[name="prosp-action"]:checked')?.value || 'none';
      if (prospAction === 'use') {
        const selEl = document.getElementById('parse-prospecto-id');
        prospId = selEl ? parseInt(selEl.value) : null;
      } else if (prospAction === 'new' && (parsed.cliente || parsed.celular)) {
        try {
          const nr = await request('/prospectos', {
            method: 'POST',
            body: JSON.stringify({
              nombre:   parsed.cliente || 'Sin nombre',
              celular:  parsed.celular || null,
              whatsapp: parsed.celular || null,
            }),
          });
          prospId = nr.id;
          await loadProspects();
        } catch (e) {
          toast('Error creando prospecto: ' + e.message);
          return;
        }
      }

      // Resolver propiedad_id
      let propId = null;
      const propAction = document.querySelector('[name="prop-action"]:checked')?.value || 'none';
      if (propAction === 'use') {
        const sugEl = document.getElementById('parse-prop-suggested');
        propId = sugEl ? parseInt(sugEl.value) || null : null;
      } else if (propAction === 'manual') {
        const manEl = document.getElementById('parse-prop-manual-fallback');
        propId = manEl ? parseInt(manEl.value) || null : null;
      } else {
        const manEl = document.getElementById('parse-prop-manual');
        propId = manEl ? parseInt(manEl.value) || null : null;
      }

      // Obtener nombre del prospecto para el título por defecto
      let prospNombre = parsed.cliente || '';
      if (prospId) {
        const found = state.prospects.find(p => p.id === prospId);
        if (found) prospNombre = found.nombre;
      }

      const payload = {
        titulo:       fd.get('titulo') || (prospNombre ? `Visita ${prospNombre}` : null),
        tipo:         parsed.tipo || 'Visita',
        fecha:        fd.get('fecha'),
        hora:         fd.get('hora') || null,
        duracion_min: 60,
        prospecto_id: prospId,
        propiedad_id: propId,
        ubicacion:    fd.get('ubicacion') || null,
        estado:       'Pendiente',
        notas:        null,
      };

      try {
        await request('/citas', { method: 'POST', body: JSON.stringify(payload) });
        toast('Cita creada correctamente.');
        closeModal();
        await loadCitas();
        await loadDashboard();
        mount();
      } catch (e) {
        toast(e.message);
      }
    };
  }

  // ─── Compartir cita ───────────────────────────────────────────────────────

  function openCompartirCitaModal(cita) {
    const plantilla = buildCitaPlantilla(cita);

    openModal(h`
      <div class="modal-header">
        <h3>Compartir cita</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <label>Plantilla generada
          <textarea id="plantilla-cita-text" rows="7" readonly style="font-family:monospace;font-size:13px;background:var(--bg)">${escapeHtml(plantilla)}</textarea>
        </label>
        <div class="actions" style="margin-top:14px">
          <button class="secondary" id="close-compartir">Cerrar</button>
          <button id="btn-copiar-plantilla">Copiar al portapapeles</button>
          <button id="btn-whatsapp-plantilla" style="background:#25D366;color:#fff">WhatsApp</button>
        </div>
        <p id="copy-feedback" style="font-size:12px;color:var(--primary);margin-top:6px;display:none">¡Copiado!</p>
      </div>
    `);

    document.getElementById('close-modal').onclick    = closeModal;
    document.getElementById('close-compartir').onclick = closeModal;

    document.getElementById('btn-copiar-plantilla').onclick = async () => {
      try {
        await navigator.clipboard.writeText(plantilla);
        const fb = document.getElementById('copy-feedback');
        if (fb) { fb.style.display = 'block'; setTimeout(() => { fb.style.display = 'none'; }, 2000); }
      } catch (_) {
        // Fallback para navegadores sin clipboard API
        const ta = document.getElementById('plantilla-cita-text');
        ta.select();
        document.execCommand('copy');
        toast('Copiado.');
      }
    };

    document.getElementById('btn-whatsapp-plantilla').onclick = () => {
      const encoded = encodeURIComponent(plantilla);
      window.open(`https://wa.me/?text=${encoded}`, '_blank');
    };
  }

  async function openCitasProspectoModal(prospId, nombre) {
    try {
      const res   = await request(`/citas?prospecto_id=${prospId}`);
      const items = res.items || [];
      openModal(h`
        <div class="modal-header">
          <h3>Citas · ${escapeHtml(nombre)}</h3>
          <button class="icon-btn" id="close-modal">×</button>
        </div>
        <div class="modal-body">
          ${items.length
            ? items.map(c => h`
                <div style="border-bottom:1px solid var(--border);padding:8px 0">
                  <div style="display:flex;justify-content:space-between">
                    <b>${escapeHtml(c.titulo || c.tipo || 'Cita')}</b>
                    <span class="pill ${c.estado === 'Completada' ? 'pill-green' : c.estado === 'Cancelada' ? 'pill-red' : 'pill-orange'}" style="font-size:11px">${escapeHtml(c.estado)}</span>
                  </div>
                  <small class="muted">${escapeHtml(c.fecha)}${c.hora ? ' · ' + escapeHtml(c.hora.slice(0,5)) : ''}</small>
                  ${c.propiedad_titulo ? h`<br><small>${escapeHtml(c.propiedad_titulo)}</small>` : ''}
                </div>`).join('')
            : '<p class="muted">Sin citas registradas.</p>'}
          <div class="actions" style="margin-top:12px">
            <button id="btn-nueva-cita-prosp">+ Nueva cita</button>
            <button class="secondary" id="close-citas-prosp-modal">Cerrar</button>
          </div>
        </div>
      `);
      document.getElementById('close-modal').onclick         = closeModal;
      document.getElementById('close-citas-prosp-modal').onclick = closeModal;
      document.getElementById('btn-nueva-cita-prosp').onclick = () => {
        closeModal();
        openCitaForm(null, { prospecto_id: prospId });
      };
    } catch (e) {
      toast(e.message);
    }
  }

  // ─── Requerimientos modal ─────────────────────────────────────────────────

  async function openRequerimientosModal(prospId, nombre) {
    try {
      const res   = await request(`/prospectos/${prospId}/requerimientos`);
      const items = res.items || [];
      renderRequerimientosModal(prospId, nombre, items);
    } catch (e) {
      toast(e.message);
    }
  }

  function renderRequerimientosModal(prospId, nombre, items) {
    const tipoOpts = ['Departamento','Minidepartamento','Casa','Local','Terreno','Oficina','Almacén','Cuarto'];
    const lista = items.length
      ? items.map(r => h`
          <div class="req-item" style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
              <div>
                ${(r.tipos_inmueble || []).length
                  ? h`<b>${escapeHtml((r.tipos_inmueble).join(', '))}</b>`
                  : '<span class="muted">Sin tipo especificado</span>'}
                ${r.presupuesto_max ? h`<br><span>Hasta S/ ${formatMoney(r.presupuesto_max)}</span>` : ''}
              </div>
              <div style="display:flex;gap:6px">
                <button class="btn-sm btn-outline" data-action="edit-req" data-req-id="${r.id}" data-prosp-id="${prospId}" data-nombre="${escapeAttr(nombre)}">Editar</button>
                <button class="btn-sm btn-danger" data-action="delete-req" data-req-id="${r.id}" data-prosp-id="${prospId}" data-nombre="${escapeAttr(nombre)}">✕</button>
              </div>
            </div>
            <div style="font-size:12px;color:var(--muted)">
              Cochera: ${escapeHtml(r.cochera || 'NO_TIENE')} ·
              Mascota: ${r.requiere_propiedad_con_mascota ? 'Sí' : 'No'} ·
              1er piso: ${r.primer_piso ? 'Sí' : 'No'}
            </div>
            ${r.observaciones ? h`<p style="font-size:12px;margin-top:4px">${escapeHtml(r.observaciones)}</p>` : ''}
          </div>`).join('')
      : '<p class="muted">Sin requerimientos. Agrega uno para habilitar el matching.</p>';

    openModal(h`
      <div class="modal-header">
        <h3>Requerimientos · ${escapeHtml(nombre)}</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <div id="req-lista">${lista}</div>
        <hr style="margin:14px 0">
        <h4 style="margin:0 0 10px">Nuevo requerimiento</h4>
        <form id="req-form" class="grid-form">
          <label class="full">Tipos de inmueble buscados
            <div id="tipos-check-wrap" class="checkbox-row" style="flex-wrap:wrap;gap:8px;margin-top:6px">
              ${tipoOpts.map(t => `
                <label class="check" style="min-width:120px">
                  <input type="checkbox" name="tipos_inmueble" value="${t}">
                  <span>${escapeHtml(t)}</span>
                </label>`).join('')}
            </div>
          </label>
          ${inputField('presupuesto_max', 'Presupuesto máx. (S/)', '', 'number')}
          ${selectField('cochera', 'Cochera necesaria', 'NO_TIENE', ['NO_TIENE','MOTO','CARRO'])}
          <div class="checkbox-row full">
            ${checkboxField('requiere_propiedad_con_mascota', 'Propiedad que acepte mascotas', false)}
            ${checkboxField('primer_piso', 'Necesita 1er piso', false)}
          </div>
          <label class="full">Observaciones
            <textarea name="observaciones" rows="2"></textarea>
          </label>
        </form>
        <div class="actions" style="margin-top:10px">
          <button class="secondary" id="cancel-req-modal">Cerrar</button>
          <button id="save-req">Agregar requerimiento</button>
        </div>
      </div>
    `);

    document.getElementById('close-modal').onclick    = closeModal;
    document.getElementById('cancel-req-modal').onclick = closeModal;

    // Edit / delete existing requirements
    document.getElementById('req-lista')?.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, reqId, prospId: pid, nombre: pnombre } = btn.dataset;
      if (action === 'delete-req') {
        if (!confirm('¿Eliminar este requerimiento?')) return;
        try {
          await request(`/prospectos/${pid}/requerimientos/${reqId}`, { method: 'DELETE', body: '{}' });
          toast('Requerimiento eliminado.');
          await openRequerimientosModal(parseInt(pid), pnombre);
          await loadProspects();
        } catch (err) { toast(err.message); }
      }
    });

    document.getElementById('save-req').onclick = async () => {
      const fd    = new FormData(document.getElementById('req-form'));
      const tipos = [...document.querySelectorAll('#tipos-check-wrap input:checked')].map(i => i.value);
      const payload = {
        tipos_inmueble:                 tipos,
        presupuesto_max:                fd.get('presupuesto_max') || null,
        cochera:                        fd.get('cochera') || 'NO_TIENE',
        requiere_propiedad_con_mascota: fd.get('requiere_propiedad_con_mascota') === '1',
        primer_piso:                    fd.get('primer_piso') === '1',
        observaciones:                  fd.get('observaciones') || null,
      };
      try {
        await request(`/prospectos/${prospId}/requerimientos`, { method: 'POST', body: JSON.stringify(payload) });
        toast('Requerimiento agregado.');
        await openRequerimientosModal(prospId, nombre);
        await loadProspects();
      } catch (err) { toast(err.message); }
    };
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  function bindLogin() {
    const form     = document.getElementById('login-form');
    const errorBox = document.getElementById('login-error');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errorBox.style.display = 'none';
      const fd = new FormData(form);
      try {
        const login    = fd.get('login')    || '';
        const password = fd.get('password') || '';
        console.log('[login] payload →', { login, password: password ? '***' : '(vacío)' });
        if (!login || !password) {
          throw new Error('Ingresa usuario/correo y contraseña.');
        }
        const res  = await request('/auth/login', {
          method: 'POST',
          body:   JSON.stringify({ login, password }),
        });
        state.user = res.user;
        await loadData();
        mount();
      } catch (err) {
        errorBox.textContent    = err.message;
        errorBox.style.display  = 'block';
      }
    });
  }

  // ─── Utilidades ───────────────────────────────────────────────────────────

  function splitLines(v) {
    return String(v || '').split('\n').map(x => x.trim()).filter(Boolean);
  }

  function formatMoney(v) {
    if (v === null || v === undefined || v === '') return '-';
    const n = Number(v);
    return Number.isFinite(n)
      ? n.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      : String(v);
  }

  function escapeHtml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(v) {
    return escapeHtml(v).replace(/\n/g, '&#10;');
  }

  function toast(message) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    root.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
    setTimeout(() => { root.innerHTML = ''; }, 3000);
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────────

  async function bootstrap() {
    // Restore page from hash on browser back/forward (popstate fires on history.back/forward)
    window.addEventListener('popstate', async () => {
      if (!state.user) return;
      const page = getPageFromHash();
      if (page === state.page) return;
      state.page = page;
      if (page === 'usuarios' && state.users.length === 0) await loadUsers();
      if (page === 'comisiones') await loadComisiones();
      if (page === 'citas') await loadCitas();
      mount();
    });

    try {
      const res  = await request('/auth/me');
      state.user = res.user;
      // Restore module from URL hash on page refresh
      state.page = getPageFromHash();
      if (state.page === 'usuarios') await loadUsers();
      if (state.page === 'comisiones') await loadComisiones();
      await loadData();
    } catch (_) {
      state.user = null;
    }
    mount();
  }

  // Expuesto globalmente para poder llamarlo desde onclick en los popups de Leaflet
  window._cpVerPropiedad = id => openPropertyDetailModal(parseInt(id)).catch(e => toast(e.message));

  return { bootstrap };
})();

document.addEventListener('DOMContentLoaded', App.bootstrap);
