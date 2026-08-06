/**
 * site.js — lógica do site público (index.html)
 * Lê tudo através de HM (data.js): veículos, configurações da loja etc.
 * Qualquer alteração salva pelo painel do gestor (admin.html) aparece
 * aqui na próxima vez que a página for carregada.
 *
 * O catálogo é paginado (carregamento incremental) em vez de baixar o
 * estoque inteiro de uma vez — importante conforme o número de veículos
 * cresce. Trocar de filtro refaz a consulta no servidor.
 */
(function () {
  'use strict';

  const badgeClass = { destaque: 'badge-destaque', seminovo: 'badge-seminovo', consignado: 'badge-consignado' };
  const badgeLabel = { destaque: 'Destaque', seminovo: 'Seminovo', consignado: 'Consignado' };

  let cfg = null;
  let catalogState = { page: 0, pageSize: 9, filter: 'todos', rows: [], total: 0 };
  let lastFocusedEl = null;

  /* ── Aplica as configurações da loja em todos os pontos do site ── */
  function applyConfig() {
    const wppHref = HM.wppLink('Olá! Vim pelo site e gostaria de saber mais sobre os veículos da Holanda Motors.', cfg.wpp);
    document.getElementById('headerWppBtn').href = wppHref;
    document.getElementById('floatWppBtn').href = wppHref;
    document.getElementById('consigWppBtn').href = HM.wppLink('Olá! Tenho interesse em consignar meu veículo na Holanda Motors.', cfg.wpp);
    document.getElementById('contatoWppLink').href = wppHref;
    document.getElementById('contatoWppLink').textContent = formatPhoneDisplay(cfg.wpp);

    document.getElementById('heroSub').textContent = cfg.about;
    document.getElementById('sobreNome').textContent = cfg.name;
    document.getElementById('sobreEndereco').textContent = cfg.address;
    document.getElementById('mapAddress').innerHTML = cfg.address.replace(/, /g, ',<br>');
    document.getElementById('contatoAddress').innerHTML = cfg.address.replace(/, /g, ',<br>');
    document.getElementById('mapLink').href = 'https://maps.google.com/?q=' + encodeURIComponent(cfg.address);
    document.getElementById('horarioSemana').textContent = cfg.h1;
    document.getElementById('horarioSabado').textContent = cfg.h2;
    document.getElementById('instaLink').href = 'https://instagram.com/' + cfg.insta.replace('@', '');
    document.getElementById('instaHandle').textContent = cfg.insta;

    document.getElementById('floatWppBtn').style.display = cfg.floatwpp ? 'flex' : 'none';

    if (!cfg.consig) {
      document.getElementById('consignacao').style.display = 'none';
      ['navConsig', 'navConsigMobile', 'navConsigFooter', 'heroConsigBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    }
  }

  function formatPhoneDisplay(digits) {
    const clean = String(digits).replace(/\D/g, '');
    const local = clean.startsWith('55') ? clean.slice(2) : clean;
    const match = local.match(/^(\d{2})(\d{5})(\d{4})$/);
    return match ? `(${match[1]}) ${match[2]}-${match[3]}` : digits;
  }

  /* ── HERO dinâmico: mostra o veículo em destaque (ou o mais recente) — busca só um registro, não o catálogo inteiro ── */
  async function renderHero() {
    const wrap = document.getElementById('heroVisual');
    if (!cfg.hero) { wrap.style.display = 'none'; return; }
    let featured;
    try {
      featured = await HM.getFeaturedVehicle();
    } catch (err) {
      console.error('[site] Falha ao carregar veículo em destaque.', err);
      wrap.style.display = 'none';
      return;
    }
    if (!featured) { wrap.style.display = 'none'; return; }
    wrap.innerHTML = `
      <div class="hero-car-card">
        <div class="hero-car-img">
          ${featured.img ? `<img src="${escapeHtml(featured.img)}" alt="${escapeHtml(featured.make + ' ' + featured.model)}">` : ''}
          <span class="hero-car-label">${badgeLabel[featured.badge] || 'Destaque'}</span>
        </div>
        <div class="hero-car-info">
          <div class="hero-car-name">${escapeHtml(featured.make)} ${escapeHtml(featured.model)}</div>
          <div class="hero-car-specs">
            <div class="hero-car-spec"><strong>${featured.year}</strong>Ano</div>
            <div class="hero-car-spec"><strong>${HM.formatKm(featured.km)}</strong>Rodados</div>
            <div class="hero-car-spec"><strong>${escapeHtml(featured.cambio)}</strong>Câmbio</div>
          </div>
          <div class="hero-car-price">${escapeHtml(featured.price)} <span>à vista</span></div>
        </div>
      </div>`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  /* ── CATÁLOGO (paginado) ── */
  async function loadCatalogPage(reset) {
    const pageToLoad = reset ? 0 : catalogState.page + 1;
    // ativo/vendido são pedidos explicitamente (não só confiados ao RLS):
    // se um gestor estiver logado neste mesmo navegador, a política de RLS
    // para autenticados deixaria ver TODO o estoque — esses filtros
    // garantem que o site público sempre mostra só o que pode ser vendido,
    // não importa quem esteja com sessão aberta.
    const opts = { page: pageToLoad, pageSize: catalogState.pageSize, ativo: true, vendido: false, comFoto: !!cfg.nophoto };
    if (catalogState.filter === 'carro' || catalogState.filter === 'moto') opts.tipo = catalogState.filter;
    if (catalogState.filter === 'consignado') opts.badge = 'consignado';

    const loadMoreBtn = document.getElementById('loadMoreBtn');
    loadMoreBtn.disabled = true;
    try {
      const { rows, total } = await HM.getVehicles(opts);
      catalogState.page = pageToLoad;
      catalogState.rows = reset ? rows : catalogState.rows.concat(rows);
      catalogState.total = total;
      renderVehicles();
    } catch (err) {
      console.error('[site] Falha ao carregar veículos.', err);
      if (reset) {
        document.getElementById('vehiclesGrid').innerHTML = `
          <div class="vehicles-empty">
            <p>Não foi possível carregar o estoque no momento. Tente novamente em instantes.</p>
          </div>`;
        loadMoreBtn.hidden = true;
      }
    } finally {
      loadMoreBtn.disabled = false;
    }
  }

  function renderCard(v) {
    const wppMsg = `Olá! Vi o ${v.make} ${v.model} no site da Holanda Motors e gostaria de saber mais!`;
    return `
    <article class="vehicle-card" data-tipo="${v.tipo}" data-badge="${v.badge}">
      <div class="vehicle-img ${v.img ? '' : 'no-image'}">
        ${v.img ? `<img src="${escapeHtml(v.img)}" alt="${escapeHtml(v.make + ' ' + v.model)}" loading="lazy">` : ''}
        <span class="vehicle-badge badge ${badgeClass[v.badge]}">${badgeLabel[v.badge] || v.badge}</span>
      </div>
      <div class="vehicle-info">
        <p class="vehicle-make">${escapeHtml(v.make)}</p>
        <h3 class="vehicle-model">${escapeHtml(v.model)}</h3>
        <ul class="vehicle-specs">
          <li class="vehicle-spec">${v.year}</li>
          <li class="vehicle-spec">${HM.formatKm(v.km)}</li>
          <li class="vehicle-spec">${escapeHtml(v.cambio)}</li>
        </ul>
        <p class="vehicle-price">${escapeHtml(v.price)}</p>
        <div class="vehicle-actions">
          <button class="v-btn-detail" data-detail="${v.id}">Ver detalhes</button>
          <a href="${HM.wppLink(wppMsg, cfg.wpp)}" target="_blank" class="v-btn-wpp">
            <svg class="icon-wpp" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            WhatsApp
          </a>
        </div>
      </div>
    </article>`;
  }

  function renderVehicles() {
    const list = catalogState.rows;
    const grid = document.getElementById('vehiclesGrid');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (!list.length) {
      grid.innerHTML = `
        <div class="vehicles-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <p>Nenhum veículo encontrado com esse filtro no momento.</p>
        </div>`;
      loadMoreBtn.hidden = true;
      return;
    }
    grid.innerHTML = list.map(renderCard).join('');
    grid.querySelectorAll('[data-detail]').forEach(btn => {
      btn.addEventListener('click', () => openModal(btn.dataset.detail, btn));
    });
    loadMoreBtn.hidden = list.length >= catalogState.total;
  }

  function setFilter(filter, btn) {
    catalogState.filter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
    if (btn) btn.setAttribute('aria-pressed', 'true');
    loadCatalogPage(true);
  }

  document.getElementById('loadMoreBtn').addEventListener('click', () => loadCatalogPage(false));

  /* ── MODAL DE DETALHES (acessível: foco preso, ESC fecha, foco retorna ao gatilho) ── */
  function openModal(id, triggerEl) {
    const v = catalogState.rows.find(x => x.id === id);
    if (!v) return;
    lastFocusedEl = triggerEl || document.activeElement;

    const wppMsg = `Olá! Vi o ${v.make} ${v.model} no site da Holanda Motors e gostaria de saber mais!`;
    const fotos = (v.imagens && v.imagens.length ? v.imagens : (v.img ? [{ url: v.img }] : []));
    renderModalImage(fotos[0] ? fotos[0].url : '', v);
    document.getElementById('modalThumbs').innerHTML = fotos.length > 1
      ? fotos.map((f, i) => `<button type="button" class="modal-thumb ${i === 0 ? 'active' : ''}" data-thumb="${escapeHtml(f.url)}"><img src="${escapeHtml(f.url)}" alt=""></button>`).join('')
      : '';
    document.getElementById('modalThumbs').querySelectorAll('[data-thumb]').forEach(btn => {
      btn.addEventListener('click', () => {
        renderModalImage(btn.dataset.thumb, v);
        document.getElementById('modalThumbs').querySelectorAll('.modal-thumb').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('modalMake').textContent = v.make;
    document.getElementById('modalModel').textContent = v.model;
    document.getElementById('modalSpecs').innerHTML = `
      <li class="modal-spec"><label>Ano</label><span>${v.year}</span></li>
      <li class="modal-spec"><label>Quilometragem</label><span>${HM.formatKm(v.km)}</span></li>
      <li class="modal-spec"><label>Câmbio</label><span>${escapeHtml(v.cambio)}</span></li>
      <li class="modal-spec"><label>Combustível</label><span>${escapeHtml(v.combustivel)}</span></li>
      <li class="modal-spec"><label>Cor</label><span>${escapeHtml(v.cor || '—')}</span></li>
      <li class="modal-spec"><label>Tipo</label><span>${v.tipo === 'carro' ? 'Carro' : 'Moto'}</span></li>
    `;
    document.getElementById('modalPrice').textContent = v.price;
    document.getElementById('modalDesc').textContent = v.desc || '';
    document.getElementById('modalDesc').style.display = v.desc ? 'block' : 'none';
    document.getElementById('modalWpp').href = HM.wppLink(wppMsg, cfg.wpp);

    const overlay = document.getElementById('modalOverlay');
    overlay.hidden = false;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('modalCloseBtn').focus();
    document.addEventListener('keydown', onModalKeydown);
  }

  function renderModalImage(url, v) {
    document.getElementById('modalImg').innerHTML = url
      ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(v.make + ' ' + v.model)}" style="width:100%;height:300px;object-fit:cover;display:block;">`
      : '';
  }

  function closeModal() {
    const overlay = document.getElementById('modalOverlay');
    overlay.classList.remove('open');
    overlay.hidden = true;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onModalKeydown);
    if (lastFocusedEl) lastFocusedEl.focus();
  }

  function onModalKeydown(e) {
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key !== 'Tab') return;
    const overlay = document.getElementById('modalOverlay');
    const focusables = overlay.querySelectorAll('a[href], button:not([disabled])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  /* ── MENU MOBILE ── */
  const hamburger = document.getElementById('hamburger');
  const mobileNav = document.getElementById('mobileNav');
  hamburger.addEventListener('click', () => {
    const isOpen = mobileNav.classList.toggle('open');
    hamburger.setAttribute('aria-expanded', String(isOpen));
    hamburger.setAttribute('aria-label', isOpen ? 'Fechar menu' : 'Abrir menu');
  });
  mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    mobileNav.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-label', 'Abrir menu');
  }));

  /* ── HEADER: sombra ao rolar ── */
  window.addEventListener('scroll', () => {
    document.getElementById('header').classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  /* ── FILTROS ── */
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => setFilter(btn.dataset.filter, btn));
  });

  /* ── INIT ── */
  (async function init() {
    try {
      cfg = await HM.getConfig();
    } catch (err) {
      console.error('[site] Falha ao carregar dados da loja.', err);
      document.getElementById('vehiclesGrid').innerHTML = `
        <div class="vehicles-empty">
          <p>Não foi possível carregar o estoque no momento. Tente novamente em instantes.</p>
        </div>`;
      return;
    }
    applyConfig();
    renderHero();
    loadCatalogPage(true);
  })();
})();
