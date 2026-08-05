/**
 * site.js — lógica do site público (index.html)
 * Lê tudo através de HM (data.js): veículos, configurações da loja etc.
 * Qualquer alteração salva pelo painel do gestor (admin.html) aparece
 * aqui na próxima vez que a página for carregada.
 *
 * Config e veículos são buscados uma vez no carregamento da página e
 * mantidos em cache local (cfg / vehiclesCache) — os filtros e o modal
 * de detalhes trabalham em cima desse cache, sem refazer requisições.
 */
(function () {
  'use strict';

  const badgeClass = { destaque: 'badge-destaque', seminovo: 'badge-seminovo', consignado: 'badge-consignado' };
  const badgeLabel = { destaque: 'Destaque', seminovo: 'Seminovo', consignado: 'Consignado' };

  let cfg = null;
  let vehiclesCache = [];
  let currentFilter = 'todos';
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

    // Botão flutuante de WhatsApp é opcional (configurável no painel)
    document.getElementById('floatWppBtn').style.display = cfg.floatwpp ? 'flex' : 'none';

    // Seção de consignação é opcional — some do menu também, não só da página
    if (!cfg.consig) {
      document.getElementById('consignacao').style.display = 'none';
      ['navConsig', 'navConsigMobile', 'navConsigFooter', 'heroConsigBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    }
  }

  function formatPhoneDisplay(digits) {
    // "5585997576262" → "(85) 99757-6262"
    const clean = String(digits).replace(/\D/g, '');
    const local = clean.startsWith('55') ? clean.slice(2) : clean;
    const match = local.match(/^(\d{2})(\d{5})(\d{4})$/);
    return match ? `(${match[1]}) ${match[2]}-${match[3]}` : digits;
  }

  /* ── HERO dinâmico: mostra o veículo em destaque (ou o primeiro disponível) ── */
  function renderHero() {
    const wrap = document.getElementById('heroVisual');
    if (!cfg.hero) { wrap.style.display = 'none'; return; }
    const vehicles = vehiclesCache.filter(v => v.ativo);
    if (!vehicles.length) { wrap.style.display = 'none'; return; }
    const featured = vehicles.find(v => v.badge === 'destaque') || vehicles[0];
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

  /* ── CATÁLOGO ── */
  function getVisibleVehicles() {
    let list = vehiclesCache.filter(v => v.ativo);
    if (cfg.nophoto) list = list.filter(v => v.img);
    return list;
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
    const all = getVisibleVehicles();
    const list = currentFilter === 'todos' ? all
      : currentFilter === 'consignado' ? all.filter(v => v.badge === 'consignado')
      : all.filter(v => v.tipo === currentFilter);

    const grid = document.getElementById('vehiclesGrid');
    if (!list.length) {
      grid.innerHTML = `
        <div class="vehicles-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <p>Nenhum veículo encontrado com esse filtro no momento.</p>
        </div>`;
      return;
    }
    grid.innerHTML = list.map(renderCard).join('');

    // Delegação de evento cobriria isso também, mas os cards são recriados
    // a cada render — então religamos os botões de detalhe aqui.
    grid.querySelectorAll('[data-detail]').forEach(btn => {
      btn.addEventListener('click', () => openModal(btn.dataset.detail, btn));
    });
  }

  function setFilter(filter, btn) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
    if (btn) btn.setAttribute('aria-pressed', 'true');
    renderVehicles();
  }

  /* ── MODAL DE DETALHES (acessível: foco preso, ESC fecha, foco retorna ao gatilho) ── */
  function openModal(id, triggerEl) {
    const v = vehiclesCache.find(x => x.id === id);
    if (!v) return;
    lastFocusedEl = triggerEl || document.activeElement;

    const wppMsg = `Olá! Vi o ${v.make} ${v.model} no site da Holanda Motors e gostaria de saber mais!`;
    document.getElementById('modalImg').innerHTML = v.img
      ? `<img src="${escapeHtml(v.img)}" alt="${escapeHtml(v.make + ' ' + v.model)}" style="width:100%;height:300px;object-fit:cover;display:block;">`
      : '';
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
    // Prende o foco dentro do modal (focus trap simples)
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
      [cfg, vehiclesCache] = await Promise.all([HM.getConfig(), HM.getVehicles()]);
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
    renderVehicles();
  })();
})();
