/* CorredorPro - SPA Frontend
   Vanilla JS, sin frameworks. Compatible con todos los navegadores modernos. */

const App = (() => {
  // ─── Estado global ────────────────────────────────────────────────────────
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
            ${navBtn('matches',     'Matches')}
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
      case 'matches':     return renderMatches();
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
        <article class="card stat stat-orange">
          <span>${resumen.matches_nuevos ?? state.matches.length}</span><small>Matches nuevos</small>
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
    const img = item.foto_principal
      ? h`<div class="card-foto"><img src="${uploadsBase}/propiedades/${item.id}/${escapeAttr(item.foto_principal)}" alt="Foto"></div>`
      : h`<div class="card-foto card-foto-empty"><span>Sin foto</span></div>`;

    const limpieza = item.limpieza_programada
      ? h`<p class="limpieza-aviso">Limpieza de fotos programada: ${escapeHtml(item.limpieza_programada)}</p>`
      : '';

    const adminBtns = state.user.rol === 'admin'
      ? h`<div class="card-admin-btns">
            ${item.estado !== 'Disponible' ? h`<button class="btn-sm btn-green" data-action="estado-disponible" data-id="${item.id}">Disponible</button>` : ''}
            ${item.estado !== 'Alquilado'  ? h`<button class="btn-sm btn-orange" data-action="estado-alquilado" data-id="${item.id}">Alquilado</button>` : ''}
            ${item.estado !== 'Vendido'    ? h`<button class="btn-sm btn-red" data-action="estado-vendido" data-id="${item.id}">Vendido</button>` : ''}
            <button class="btn-sm btn-danger" data-action="delete-prop" data-id="${item.id}">Eliminar</button>
          </div>`
      : '';

    return h`
      <article class="card property-card">
        ${img}
        <div class="property-top">
          <div>
            <small class="code-label">${escapeHtml(item.codigo)}</small>
            <h3>${escapeHtml(item.titulo || 'Sin título')}</h3>
          </div>
          ${estadoPill(item.estado)}
        </div>
        <p>${escapeHtml(item.tipo || '-')} · ${escapeHtml(item.operacion || '-')}</p>
        <p class="precio">${escapeHtml(item.moneda || 'S/')} ${formatMoney(item.precio)}</p>
        <p class="ubicacion">${escapeHtml(item.ubicacion || item.distrito || 'Sin ubicación')}</p>
        <div class="meta-row">
          <span>${item.habitaciones ?? '-'} hab.</span>
          <span>${item.banos ?? '-'} baños</span>
          <span>${item.area ?? '-'} m²</span>
          ${item.latitud ? '<span class="has-pin">📍 Pin</span>' : ''}
        </div>
        ${limpieza}
        ${adminBtns}
        <div class="card-btns">
          <button class="btn-sm btn-outline" data-action="edit-prop" data-id="${item.id}">Editar</button>
          <button class="btn-sm btn-outline" data-action="ver-fotos" data-id="${item.id}">Fotos</button>
          <button class="btn-sm btn-outline" data-action="ver-matches-prop" data-id="${item.id}">Matches</button>
        </div>
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

      items.forEach(pin => {
        const imgHtml = pin.foto_principal
          ? `<img src="${uploadsBase}/propiedades/${pin.id}/${pin.foto_principal}" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;margin-bottom:6px">`
          : '';

        const popup = `
          <div style="min-width:180px;font-family:system-ui">
            ${imgHtml}
            <b style="color:#0f62fe">${escapeHtml(pin.codigo)}</b><br>
            <span style="font-size:13px">${escapeHtml(pin.titulo || 'Sin título')}</span><br>
            <span style="font-size:12px;color:#6b7280">${escapeHtml(pin.tipo || '-')} · ${escapeHtml(pin.operacion || '-')}</span><br>
            <b>${escapeHtml(pin.moneda || 'S/')} ${formatMoney(pin.precio)}</b><br>
            ${pin.estado === 'Disponible' ? '<span style="color:green">Disponible</span>' : `<span style="color:orange">${escapeHtml(pin.estado)}</span>`}
          </div>`;

        // Color del pin según estado
        const color = pin.estado === 'Disponible' ? '#16a34a'
                    : pin.estado === 'Alquilado'  ? '#ea580c'
                    : '#dc2626';

        const icon = L.divIcon({
          html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.4)"></div>`,
          className: '',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });

        L.marker([parseFloat(pin.latitud), parseFloat(pin.longitud)], { icon })
          .addTo(leafletMap)
          .bindPopup(popup);
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
        <div class="card-btns">
          <button class="btn-sm btn-outline" data-action="edit-prospect" data-id="${item.id}">Editar</button>
          <button class="btn-sm btn-outline" data-action="ver-requerimientos" data-id="${item.id}" data-nombre="${escapeAttr(item.nombre)}">Requerimientos</button>
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
          <p>Compatibilidad calculada automáticamente. Solo tus propiedades y tus prospectos.</p>
        </div>
      </section>
      <section class="list-grid">
        ${state.matches.length
          ? state.matches.map(renderMatchCard).join('')
          : '<article class="card"><p>No hay matches generados. Agrega requerimientos a tus prospectos para ver compatibilidades.</p></article>'}
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
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, nombre, activo } = btn.dataset;

    if (action === 'edit-prop') {
      await openPropertyEdit(parseInt(id));
    } else if (action === 'ver-fotos') {
      await openFotosModal(parseInt(id));
    } else if (action === 'estado-disponible') {
      await cambiarEstadoPropiedad(parseInt(id), 'Disponible');
    } else if (action === 'estado-alquilado') {
      await cambiarEstadoPropiedad(parseInt(id), 'Alquilado');
    } else if (action === 'estado-vendido') {
      await cambiarEstadoPropiedad(parseInt(id), 'Vendido');
    } else if (action === 'delete-prop') {
      if (!confirm(`¿Eliminar definitivamente la propiedad #${id}? Se borrarán también sus fotos. Esta acción no se puede deshacer.`)) return;
      await eliminarPropiedad(parseInt(id));
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
      request('/matches?min=40').then(r => { state.matches = r.items || []; }),
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

  function renderFotosModal(propId, fotos) {
    const lista = fotos.length
      ? fotos.map(f => h`
          <div class="foto-item">
            <img src="${uploadsBase}/propiedades/${propId}/${escapeAttr(f.filename)}" alt="">
            <div class="foto-btns">
              ${f.es_principal ? '<span class="pill pill-green" style="font-size:11px">Principal</span>' : `<button class="btn-sm btn-outline" data-foto-id="${f.id}" data-action-foto="principal">Principal</button>`}
              <button class="btn-sm btn-danger" data-foto-id="${f.id}" data-action-foto="delete">Eliminar</button>
            </div>
          </div>`).join('')
      : '<p class="muted">No hay fotos aún.</p>';

    openModal(h`
      <div class="modal-header">
        <h3>Fotos de propiedad #${propId}</h3>
        <button class="icon-btn" id="close-modal">×</button>
      </div>
      <div class="modal-body">
        <div class="fotos-grid" id="fotos-grid">
          ${lista}
        </div>
        <hr style="margin:16px 0">
        <label><b>Subir nuevas fotos</b> (JPG, PNG, WEBP · máx. 5 MB c/u)
          <input type="file" id="fotos-input" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
        </label>
        <div class="actions" style="margin-top:12px">
          <button class="secondary" id="cancel-fotos">Cerrar</button>
          <button id="upload-fotos">Subir fotos</button>
        </div>
        <div id="fotos-progress" style="margin-top:10px"></div>
      </div>
    `);

    document.getElementById('close-modal').onclick   = closeModal;
    document.getElementById('cancel-fotos').onclick  = closeModal;

    // Acciones sobre fotos existentes
    document.getElementById('fotos-grid')?.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action-foto]');
      if (!btn) return;
      const { actionFoto, fotoId } = btn.dataset;

      if (actionFoto === 'delete') {
        if (!confirm('¿Eliminar esta foto?')) return;
        try {
          await request(`/fotos/${fotoId}`, { method: 'DELETE', body: '{}' });
          await openFotosModal(propId);
          await loadData();
        } catch (err) { toast(err.message); }
      }

      if (actionFoto === 'principal') {
        try {
          await request(`/fotos/${fotoId}/principal`, { method: 'PUT', body: '{}' });
          await openFotosModal(propId);
          await loadData();
        } catch (err) { toast(err.message); }
      }
    });

    // Subir fotos
    document.getElementById('upload-fotos').onclick = async () => {
      const input = document.getElementById('fotos-input');
      if (!input.files.length) { toast('Selecciona al menos una foto.'); return; }

      const fd = new FormData();
      for (const file of input.files) {
        fd.append('fotos[]', file);
      }

      const prog = document.getElementById('fotos-progress');
      prog.textContent = 'Subiendo…';
      try {
        const res = await request(`/propiedades/${propId}/fotos`, { method: 'POST', body: fd });
        prog.textContent = `Subidas: ${res.uploaded.length}. Omitidas: ${res.skipped.length}.`;
        await openFotosModal(propId);
        await loadData();
      } catch (err) {
        prog.textContent = '';
        toast(err.message);
      }
    };
  }

  // ─── Cambiar estado de propiedad ──────────────────────────────────────────

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
              ${c.monto_corredor != null ? h`<p class="muted">Corredor: S/ ${formatMoney(c.monto_corredor)}</p>` : ''}
              ${c.monto_admin    != null ? h`<p class="muted">Admin: S/ ${formatMoney(c.monto_admin)}</p>` : ''}
              <p class="muted" style="font-size:12px">Cerrado por: ${escapeHtml(c.cerrado_por_nombre || c.registrado_por_nombre || 'N/A')}</p>
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

    const corredorOptions = state.user.rol === 'admin'
      ? (state.users.filter(u => u.rol === 'corredor').map(u =>
          `<option value="${u.id}" ${data.cerrado_por_id == u.id ? 'selected' : ''}>${escapeHtml(u.nombre)}</option>`
        ).join(''))
      : '';

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
          ${inputField('fecha',         'Fecha *',           data.fecha || new Date().toISOString().slice(0,10), 'date')}
          ${inputField('monto_total',   'Monto total (S/) *', data.monto_total ?? '', 'number')}
          ${inputField('monto_corredor','Parte corredor (S/)', data.monto_corredor ?? '', 'number')}
          ${inputField('monto_admin',   'Parte admin (S/)',   data.monto_admin ?? '', 'number')}
          ${state.user.rol === 'admin' && corredorOptions
            ? h`<label>Cerrado por corredor
                  <select name="cerrado_por_id">
                    <option value="">Yo mismo (admin)</option>
                    ${corredorOptions}
                  </select>
                </label>`
            : ''}
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

    document.getElementById('close-modal').onclick     = closeModal;
    document.getElementById('cancel-comision').onclick  = closeModal;
    document.getElementById('save-comision').onclick    = () => saveComision(data.id || null);
  }

  async function saveComision(editId) {
    const fd      = new FormData(document.getElementById('comision-form'));
    const payload = {
      propiedad_id:    fd.get('propiedad_id'),
      tipo_operacion:  fd.get('tipo_operacion'),
      fecha:           fd.get('fecha'),
      monto_total:     fd.get('monto_total'),
      monto_corredor:  fd.get('monto_corredor') || null,
      monto_admin:     fd.get('monto_admin')    || null,
      cerrado_por_id:  fd.get('cerrado_por_id') || null,
      observaciones:   fd.get('observaciones'),
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
        // Recalcular matches
        await Promise.all([
          loadProspects(),
          request('/matches?min=40').then(r => { state.matches = r.items || []; }),
        ]);
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
    try {
      const res  = await request('/auth/me');
      state.user = res.user;
      await loadData();
    } catch (_) {
      state.user = null;
    }
    mount();
  }

  return { bootstrap };
})();

document.addEventListener('DOMContentLoaded', App.bootstrap);
