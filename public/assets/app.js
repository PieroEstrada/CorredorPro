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
    users:       [],
  };

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
            ${navBtn('matches',     'Matches')}
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
      case 'matches':     return renderMatches();
      case 'usuarios':    return state.user.rol === 'admin' ? renderUsuarios() : '<p>Sin acceso.</p>';
      default:            return '<section class="card"><p>Página no disponible.</p></section>';
    }
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  function renderDashboard() {
    const disponibles = state.properties.filter(p => p.estado === 'Disponible').length;
    const alquilados  = state.properties.filter(p => p.estado === 'Alquilado').length;
    const vendidos    = state.properties.filter(p => p.estado === 'Vendido').length;
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
        <article class="card stat">
          <span>${state.properties.length}</span><small>Propiedades total</small>
        </article>
        <article class="card stat stat-green">
          <span>${disponibles}</span><small>Disponibles</small>
        </article>
        <article class="card stat stat-orange">
          <span>${alquilados}</span><small>Alquiladas</small>
        </article>
        <article class="card stat stat-red">
          <span>${vendidos}</span><small>Vendidas</small>
        </article>
        <article class="card stat">
          <span>${state.prospects.length}</span><small>Prospectos</small>
        </article>
        <article class="card stat">
          <span>${state.matches.length}</span><small>Matches activos</small>
        </article>
      </section>
      <div class="dashboard-map-header">
        <h2>Mapa de propiedades</h2>
        <p>Solo muestra propiedades con coordenadas registradas.</p>
      </div>
      <div id="mapa-container"></div>
    `;
  }

  // ─── Propiedades ──────────────────────────────────────────────────────────

  function renderProperties() {
    return h`
      <section class="toolbar">
        <div>
          <h1>Propiedades</h1>
          <p>${state.properties.length} registros.</p>
        </div>
        <div class="actions">
          <button id="btn-open-parser">Pegar anuncio</button>
          <button class="secondary" id="btn-open-manual">Nueva propiedad</button>
        </div>
      </section>
      <section class="list-grid">
        ${state.properties.length
          ? state.properties.map(renderPropertyCard).join('')
          : '<article class="card"><p>No hay propiedades registradas.</p></article>'}
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

  function renderProspects() {
    return h`
      <section class="toolbar">
        <div>
          <h1>Prospectos</h1>
          <p>${state.prospects.length} registros.</p>
        </div>
        <div class="actions">
          <button id="btn-new-prospect">Nuevo prospecto</button>
        </div>
      </section>
      <section class="list-grid">
        ${state.prospects.length
          ? state.prospects.map(renderProspectCard).join('')
          : '<article class="card"><p>No hay prospectos registrados.</p></article>'}
      </section>
    `;
  }

  function renderProspectCard(item) {
    const estadoColor = item.estado === 'Nuevo' ? 'pill-green'
                      : item.estado === 'Descartado' ? 'pill-red'
                      : 'pill-gray';
    return h`
      <article class="card">
        <div class="property-top">
          <div>
            <small class="code-label">${escapeHtml(item.codigo)}</small>
            <h3>${escapeHtml(item.nombre)}</h3>
          </div>
          <span class="pill ${estadoColor}">${escapeHtml(item.estado || 'Nuevo')}</span>
        </div>
        <p>${escapeHtml(item.telefono || 'Sin teléfono')}</p>
        <p class="muted">${escapeHtml(item.fuente || '-')} · ${escapeHtml(item.nacionalidad || '-')}</p>
        <div class="card-btns">
          <button class="btn-sm btn-outline" data-action="edit-prospect" data-id="${item.id}">Editar</button>
          <button class="btn-sm btn-outline" data-action="ver-comentarios" data-id="${item.id}" data-nombre="${escapeAttr(item.nombre)}">Comentarios</button>
        </div>
      </article>
    `;
  }

  // ─── Matches ──────────────────────────────────────────────────────────────

  function renderMatches() {
    return h`
      <section class="toolbar">
        <div>
          <h1>Matches</h1>
          <p>Compatibilidad calculada automáticamente en PHP.</p>
        </div>
      </section>
      <section class="list-grid">
        ${state.matches.length
          ? state.matches.map(m => h`
            <article class="card">
              <div class="property-top">
                <span class="code-label">${escapeHtml(m.propiedad_codigo)}</span>
                <span class="pill pill-green">${m.score}%</span>
              </div>
              <h3>${escapeHtml(m.prospecto_nombre)}</h3>
              <p>${escapeHtml(m.propiedad_titulo)}</p>
              <ul class="reason-list">
                ${(m.razones || []).map(r => `<li>${escapeHtml(r)}</li>`).join('')}
              </ul>
            </article>`).join('')
          : '<article class="card"><p>No hay matches generados.</p></article>'}
      </section>
    `;
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
        mount();
      });
    });

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await request('/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
      state.user       = null;
      state.properties = [];
      state.prospects  = [];
      state.matches    = [];
      state.users      = [];
      mount();
    });

    // Botones globales
    document.getElementById('btn-open-parser')?.addEventListener('click', openParserModal);
    document.getElementById('btn-open-manual')?.addEventListener('click', () => openPropertyForm({}));
    document.getElementById('btn-new-prospect')?.addEventListener('click', openProspectForm);
    document.getElementById('btn-new-user')?.addEventListener('click', openUserForm);

    // Delegación de eventos en cards
    document.getElementById('main-content')?.addEventListener('click', handleCardAction);
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
    } else if (action === 'ver-comentarios') {
      await openComentariosModal(parseInt(id), nombre);
    } else if (action === 'edit-user') {
      await openUserEdit(parseInt(id));
    } else if (action === 'change-password') {
      openPasswordModal(parseInt(id), nombre);
    } else if (action === 'toggle-user') {
      await toggleUser(parseInt(id), activo === '1' ? 0 : 1);
    }
  }

  // ─── Carga de datos ───────────────────────────────────────────────────────

  async function loadData() {
    const [props, pros, matches] = await Promise.all([
      request('/propiedades'),
      request('/prospectos'),
      request('/matches?min=40'),
    ]);
    state.properties = props.items   || [];
    state.prospects  = pros.items    || [];
    state.matches    = matches.items || [];
  }

  async function loadUsers() {
    const res    = await request('/usuarios');
    state.users  = res.items || [];
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
            ${checkboxField('cochera',              'Cochera',              data.cochera)}
            ${checkboxField('agua_incluida',        'Agua incluida',        data.agua_incluida)}
            ${checkboxField('internet_incluido',    'Internet',             data.internet_incluido)}
            ${checkboxField('mantenimiento_incluido','Mantenimiento',       data.mantenimiento_incluido)}
            ${checkboxField('aire_acondicionado',   'Aire acondicionado',   data.aire_acondicionado)}
            ${checkboxField('lavanderia',           'Lavandería',           data.lavanderia)}
            ${checkboxField('terraza',              'Terraza',              data.terraza)}
            ${checkboxField('patio',                'Patio',                data.patio)}
            ${checkboxField('seguridad',            'Seguridad',            data.seguridad)}
            ${checkboxField('rejas',                'Rejas',                data.rejas)}
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
      cochera:                 fd.get('cochera') === '1',
      agua_incluida:           fd.get('agua_incluida') === '1',
      internet_incluido:       fd.get('internet_incluido') === '1',
      mantenimiento_incluido:  fd.get('mantenimiento_incluido') === '1',
      aire_acondicionado:      fd.get('aire_acondicionado') === '1',
      lavanderia:              fd.get('lavanderia') === '1',
      terraza:                 fd.get('terraza') === '1',
      patio:                   fd.get('patio') === '1',
      seguridad:               fd.get('seguridad') === '1',
      rejas:                   fd.get('rejas') === '1',
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
            const fr = await request(`/propiedades/${res.item.id}/fotos`, { method: 'POST', body: fd2 });
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
          ${inputField('telefono',    'Teléfono',      data.telefono || '')}
          ${inputField('whatsapp',    'WhatsApp',      data.whatsapp || '')}
          ${inputField('correo',      'Correo',        data.correo || '')}
          ${inputField('nacionalidad','Nacionalidad',  data.nacionalidad || 'Peruana')}
          ${selectField('fuente',     'Fuente',        data.fuente || 'WhatsApp', ['WhatsApp','Referido','Facebook','TikTok','OLX','Directo','Otro'])}
          ${selectField('estado',     'Estado',        data.estado || 'Nuevo', ['Nuevo','Contactado','En seguimiento','Descartado','Lista negra'])}
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
  }

  async function saveProspect(editId) {
    const fd      = new FormData(document.getElementById('prospect-form'));
    const payload = Object.fromEntries(fd.entries());
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
          ${inputField('nombre',  'Nombre *',   data.nombre || '')}
          ${inputField('correo',  'Correo *',   data.correo || '', 'email')}
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

  // ─── Login ────────────────────────────────────────────────────────────────

  function bindLogin() {
    const form     = document.getElementById('login-form');
    const errorBox = document.getElementById('login-error');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errorBox.style.display = 'none';
      const fd = new FormData(form);
      try {
        const res  = await request('/auth/login', {
          method: 'POST',
          body:   JSON.stringify({ correo: fd.get('correo'), password: fd.get('password') }),
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
