/**
 * admin.js — lógica do painel do gestor (admin.html)
 * Toda leitura/escrita de dados passa por HM (data.js), a mesma camada
 * usada pelo site público. HM fala com o Supabase — autenticação real
 * (Supabase Auth), banco (Postgres com RLS) e fotos (Supabase Storage).
 */
(function () {
  'use strict';

  const badgeLabels = { seminovo: 'Seminovo', consignado: 'Consignado', destaque: 'Destaque' };
  const badgeCls = { seminovo: 'badge-seminovo', consignado: 'badge-consignado', destaque: 'badge-destaque' };
  const consigStatusLabels = { ativo: 'Disponível', negociando: 'Em negociação', vendido: 'Vendido', devolvido: 'Devolvido' };
  const consigStatusCls = { ativo: 'badge-ativo', negociando: 'badge-negociando', vendido: 'badge-seminovo', devolvido: 'badge-inativo' };

  let currentImg = '';
  let lastFocusedEl = null;
  let pendingDelete = { type: null, id: null };

  /* ── AUTENTICAÇÃO (Supabase Auth) ── */
  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value;
    const errEl = document.getElementById('loginError');
    const submitBtn = e.currentTarget.querySelector('button[type="submit"]');
    errEl.textContent = '';
    submitBtn.disabled = true;
    try {
      await HM.login(email, pass);
      await enterAdminApp();
    } catch (err) {
      console.error('[admin] Falha no login.', err);
      errEl.textContent = 'E-mail ou senha incorretos.';
    } finally {
      submitBtn.disabled = false;
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await HM.logout();
    showLoginScreen();
  });

  async function enterAdminApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminApp').style.display = 'block';
    await Promise.all([renderDashboard(), renderVehicleTable(), renderConsigTable(), loadConfigForm()]);
    checkMobile();
  }

  function showLoginScreen() {
    document.getElementById('adminApp').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').textContent = '';
  }

  /** Ao carregar a página, mantém a sessão se o gestor já estiver autenticado. */
  (async function initSession() {
    const session = await HM.getSession();
    if (session) await enterAdminApp();
    else showLoginScreen();
  })();

  /* ── NAVEGAÇÃO ── */
  const titles = { dashboard: 'Dashboard', veiculos: 'Veículos', consignacoes: 'Consignações', configuracoes: 'Configurações' };
  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.page, btn));
  });
  function navigate(page, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item[data-page]').forEach(n => n.removeAttribute('aria-current'));
    document.getElementById('page-' + page).classList.add('active');
    if (el) el.setAttribute('aria-current', 'page');
    document.getElementById('topbarTitle').textContent = titles[page] || page;
    if (window.innerWidth < 900) closeSidebar();
    document.getElementById('mainContent').focus?.();
  }

  const sidebar = document.getElementById('sidebar');
  const menuToggle = document.getElementById('menuToggle');
  menuToggle.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });
  function closeSidebar() {
    sidebar.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  }
  function checkMobile() {
    // O botão de menu já fica oculto/visível via CSS (@media), isso só
    // garante que o estado aria-expanded comece coerente.
    menuToggle.setAttribute('aria-expanded', 'false');
  }
  window.addEventListener('resize', () => { if (window.innerWidth >= 900) closeSidebar(); });

  /* ── DASHBOARD ── */
  async function renderDashboard() {
    const [vs, cs] = await Promise.all([HM.getVehicles(), HM.getConsigs()]);
    const ativos = vs.filter(v => v.ativo);
    const carros = vs.filter(v => v.tipo === 'carro');
    const motos = vs.filter(v => v.tipo === 'moto');
    const consigs = vs.filter(v => v.badge === 'consignado');
    const destaque = vs.filter(v => v.badge === 'destaque');

    document.getElementById('dashStats').innerHTML = `
      <div class="stat-card blue"><div class="stat-card-label">Total em estoque</div><div class="stat-card-val">${vs.length}</div><div class="stat-card-sub">${ativos.length} visíveis no site</div></div>
      <div class="stat-card green"><div class="stat-card-label">Carros</div><div class="stat-card-val">${carros.length}</div><div class="stat-card-sub">Em ${vs.length} veículos</div></div>
      <div class="stat-card yellow"><div class="stat-card-label">Motos</div><div class="stat-card-val">${motos.length}</div><div class="stat-card-sub">Em ${vs.length} veículos</div></div>
      <div class="stat-card red-c"><div class="stat-card-label">Consignações</div><div class="stat-card-val">${cs.length}</div><div class="stat-card-sub">${cs.filter(c => c.status === 'ativo').length} disponíveis</div></div>
    `;

    const pct = (n) => vs.length ? Math.round(n / vs.length * 100) : 0;
    document.getElementById('typeBars').innerHTML = `
      <div class="type-bar"><div class="type-bar-label">Carros</div><div class="type-bar-track"><div class="type-bar-fill" style="width:${pct(carros.length)}%"></div></div><div class="type-bar-count">${carros.length}</div></div>
      <div class="type-bar"><div class="type-bar-label">Motos</div><div class="type-bar-track"><div class="type-bar-fill" style="width:${pct(motos.length)}%;background:var(--yellow)"></div></div><div class="type-bar-count">${motos.length}</div></div>
      <div class="type-bar"><div class="type-bar-label">Consignados</div><div class="type-bar-track"><div class="type-bar-fill" style="width:${pct(consigs.length)}%;background:var(--green)"></div></div><div class="type-bar-count">${consigs.length}</div></div>
      <div class="type-bar"><div class="type-bar-label">Destaque</div><div class="type-bar-track"><div class="type-bar-fill" style="width:${pct(destaque.length)}%;background:var(--blue)"></div></div><div class="type-bar-count">${destaque.length}</div></div>
    `;

    const acts = await HM.getActivity();
    const colors = { verde: 'var(--green)', amarelo: 'var(--yellow)', vermelho: 'var(--red)', azul: 'var(--blue)' };
    document.getElementById('activityList').innerHTML = acts.length
      ? acts.slice(0, 8).map(a => `<li class="activity-item"><span class="activity-dot" style="background:${colors[a.color] || 'var(--gray)'}"></span><span>${escapeHtml(a.msg)}</span><span class="activity-time">${a.time}</span></li>`).join('')
      : '<li class="activity-item"><span class="activity-dot" style="background:var(--gray)"></span><span style="color:var(--gray)">Nenhuma atividade ainda.</span></li>';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  /* ── TABELA DE VEÍCULOS ── */
  document.getElementById('searchVehicle').addEventListener('input', renderVehicleTable);
  document.getElementById('filterTipo').addEventListener('change', renderVehicleTable);
  document.getElementById('filterBadge').addEventListener('change', renderVehicleTable);

  async function renderVehicleTable() {
    let vs;
    try {
      vs = await HM.getVehicles();
    } catch (err) {
      console.error('[admin] Falha ao carregar veículos.', err);
      toast('Não foi possível carregar os veículos.', 'error');
      return;
    }
    const q = (document.getElementById('searchVehicle').value || '').toLowerCase();
    const ft = document.getElementById('filterTipo').value;
    const fb = document.getElementById('filterBadge').value;
    const filtered = vs.filter(v => {
      const match = !q || `${v.make} ${v.model} ${v.cor || ''}`.toLowerCase().includes(q);
      return match && (!ft || v.tipo === ft) && (!fb || v.badge === fb);
    });
    const tbody = document.getElementById('vehicleTableBody');
    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><p>Nenhum veículo encontrado.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = filtered.map(v => `
      <tr>
        <td>${v.img ? `<img class="td-img" src="${escapeHtml(v.img)}" alt="">` : `<div class="td-img" aria-hidden="true"></div>`}</td>
        <td><div class="td-name">${escapeHtml(v.make)} ${escapeHtml(v.model)}</div><div class="td-sub">${escapeHtml(v.cor || '—')} · ${escapeHtml(v.combustivel || '—')}</div></td>
        <td>${v.year} <span style="color:var(--gray)">/ ${Number(v.km).toLocaleString('pt-BR')} km</span></td>
        <td style="font-weight:700">${escapeHtml(v.price)}</td>
        <td style="text-transform:capitalize">${v.tipo}</td>
        <td><span class="badge ${badgeCls[v.badge]}">${badgeLabels[v.badge] || v.badge}</span></td>
        <td><span class="badge ${v.ativo ? 'badge-ativo' : 'badge-inativo'}">${v.ativo ? 'Visível' : 'Oculto'}</span></td>
        <td>
          <div class="actions">
            <button class="btn-icon toggle" type="button" data-toggle="${v.id}" aria-label="${v.ativo ? 'Ocultar do site' : 'Exibir no site'}">${v.ativo
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
              : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'}</button>
            <button class="btn-icon edit" type="button" data-edit="${v.id}" aria-label="Editar ${escapeHtml(v.make)} ${escapeHtml(v.model)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon del" type="button" data-del="${v.id}" data-label="${escapeHtml(v.make)} ${escapeHtml(v.model)}" aria-label="Excluir ${escapeHtml(v.make)} ${escapeHtml(v.model)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleVisible(b.dataset.toggle, vs)));
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openVehicleModal(b.dataset.edit, b, vs)));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => confirmDelete('vehicle', b.dataset.del, b.dataset.label, b)));
  }

  async function toggleVisible(id, cachedList) {
    const v = cachedList.find(x => x.id === id);
    if (!v) return;
    const novoAtivo = !v.ativo;
    try {
      await HM.toggleVehicleAtivo(id, novoAtivo);
      await HM.logActivity(`${v.make} ${v.model} ${novoAtivo ? 'exibido' : 'ocultado'} no site`, novoAtivo ? 'verde' : 'amarelo');
      await Promise.all([renderVehicleTable(), renderDashboard()]);
      toast(novoAtivo ? 'Veículo exibido no site.' : 'Veículo ocultado do site.', 'success');
    } catch (err) {
      console.error('[admin] Falha ao alterar visibilidade.', err);
      toast('Não foi possível alterar a visibilidade do veículo.', 'error');
    }
  }

  /* ── MODAL DE VEÍCULO ── */
  const vehicleOverlay = document.getElementById('vehicleModalOverlay');
  const vehicleDefaults = { vTipo: 'carro', vBadge: 'seminovo', vCambio: 'Automático', vCombustivel: 'Flex', vAtivo: '1' };

  document.getElementById('newVehicleBtn').addEventListener('click', (e) => openVehicleModal(null, e.currentTarget));
  document.getElementById('vehicleModalCloseBtn').addEventListener('click', closeVehicleModal);
  document.getElementById('vehicleCancelBtn').addEventListener('click', closeVehicleModal);
  document.getElementById('vehicleSaveBtn').addEventListener('click', saveVehicle);
  vehicleOverlay.addEventListener('click', e => { if (e.target === e.currentTarget) closeVehicleModal(); });

  async function openVehicleModal(id, triggerEl, cachedList) {
    currentImg = '';
    lastFocusedEl = triggerEl || document.activeElement;
    document.getElementById('vehicleFormError').textContent = '';

    // Reseta TODOS os campos, incluindo os <select> — sem isso, abrir "Novo
    // veículo" logo após editar um herdava os valores do veículo anterior.
    ['vId', 'vMake', 'vModel', 'vYear', 'vKm', 'vPrice', 'vColor', 'vDesc', 'vImgUrl'].forEach(f => { document.getElementById(f).value = ''; });
    Object.entries(vehicleDefaults).forEach(([f, val]) => { document.getElementById(f).value = val; });

    document.getElementById('vehicleModalTitle').textContent = id ? 'Editar Veículo' : 'Novo Veículo';
    resetImgUpload();

    if (id) {
      const list = cachedList || await HM.getVehicles();
      const v = list.find(x => x.id === id);
      if (!v) return;
      document.getElementById('vId').value = v.id;
      document.getElementById('vMake').value = v.make;
      document.getElementById('vModel').value = v.model;
      document.getElementById('vYear').value = v.year;
      document.getElementById('vKm').value = v.km;
      document.getElementById('vPrice').value = v.price;
      document.getElementById('vColor').value = v.cor || '';
      document.getElementById('vDesc').value = v.desc || '';
      document.getElementById('vTipo').value = v.tipo;
      document.getElementById('vBadge').value = v.badge;
      document.getElementById('vCambio').value = v.cambio || 'Automático';
      document.getElementById('vCombustivel').value = v.combustivel || 'Flex';
      document.getElementById('vAtivo').value = v.ativo ? '1' : '0';
      if (v.img) document.getElementById('vImgUrl').value = v.img;
    }
    openModal(vehicleOverlay, document.getElementById('vMake'));
  }
  function closeVehicleModal() { closeModalEl(vehicleOverlay); resetImgUpload(); }

  async function saveVehicle() {
    const make = document.getElementById('vMake').value.trim();
    const model = document.getElementById('vModel').value.trim();
    const year = Number(document.getElementById('vYear').value);
    const km = document.getElementById('vKm').value;
    const price = document.getElementById('vPrice').value.trim();
    const errEl = document.getElementById('vehicleFormError');

    if (!make || !model || !price || !year || km === '') {
      errEl.textContent = 'Preencha todos os campos obrigatórios (*).';
      return;
    }
    if (year < 1990 || year > 2027) {
      errEl.textContent = 'Informe um ano de fabricação válido.';
      return;
    }
    if (Number(km) < 0) {
      errEl.textContent = 'A quilometragem não pode ser negativa.';
      return;
    }
    errEl.textContent = '';

    const imgUrl = document.getElementById('vImgUrl').value.trim();
    const img = currentImg || imgUrl || '';
    const editId = document.getElementById('vId').value;
    const data = {
      make, model, year, km: Number(km), price,
      cor: document.getElementById('vColor').value.trim(),
      tipo: document.getElementById('vTipo').value,
      badge: document.getElementById('vBadge').value,
      cambio: document.getElementById('vCambio').value,
      combustivel: document.getElementById('vCombustivel').value,
      ativo: Number(document.getElementById('vAtivo').value),
      img,
      desc: document.getElementById('vDesc').value.trim(),
    };

    const saveBtn = document.getElementById('vehicleSaveBtn');
    saveBtn.disabled = true;
    try {
      if (editId) {
        await HM.updateVehicle(editId, data);
        await HM.logActivity(`${make} ${model} atualizado`, 'azul');
        toast('Veículo atualizado com sucesso!', 'success');
      } else {
        await HM.createVehicle(data);
        await HM.logActivity(`${make} ${model} adicionado ao estoque`, 'verde');
        toast('Veículo adicionado com sucesso!', 'success');
      }
      await Promise.all([renderVehicleTable(), renderDashboard()]);
      closeVehicleModal();
    } catch (err) {
      console.error('[admin] Falha ao salvar veículo.', err);
      errEl.textContent = 'Não foi possível salvar o veículo. Tente novamente.';
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ── UPLOAD DE IMAGEM ── */
  const uploadArea = document.getElementById('uploadArea');
  const imgFileInput = document.getElementById('imgFileInput');
  const vImgUrl = document.getElementById('vImgUrl');

  imgFileInput.addEventListener('change', e => handleImageFile(e.target.files[0]));
  document.getElementById('imgRemoveBtn').addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    currentImg = ''; resetImgUpload(); vImgUrl.value = '';
  });
  vImgUrl.addEventListener('input', () => {
    const url = vImgUrl.value.trim();
    if (!url) { resetImgUpload(); return; }
    currentImg = '';
    showImgPreview(url);
  });
  uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleImageFile(file);
  });

  function handleImageFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Selecione um arquivo de imagem válido.', 'error'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Arquivo muito grande. Máx. 5MB.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      currentImg = ev.target.result;
      showImgPreview(currentImg);
      vImgUrl.value = '';
    };
    reader.onerror = () => toast('Não foi possível ler essa imagem.', 'error');
    reader.readAsDataURL(file);
  }
  function showImgPreview(src) {
    document.getElementById('uploadPlaceholder').style.display = 'none';
    document.getElementById('uploadPreviewWrap').style.display = 'block';
    document.getElementById('uploadPreview').src = src;
  }
  function resetImgUpload() {
    currentImg = '';
    document.getElementById('uploadPlaceholder').style.display = 'block';
    document.getElementById('uploadPreviewWrap').style.display = 'none';
    document.getElementById('uploadPreview').src = '';
    imgFileInput.value = '';
  }

  /* ── TABELA DE CONSIGNAÇÕES ── */
  async function renderConsigTable() {
    let cs;
    try {
      cs = await HM.getConsigs();
    } catch (err) {
      console.error('[admin] Falha ao carregar consignações.', err);
      toast('Não foi possível carregar as consignações.', 'error');
      return;
    }
    const tbody = document.getElementById('consigTableBody');
    if (!cs.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>Nenhuma consignação registrada.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = cs.map(c => `
      <tr>
        <td><div class="td-name">${escapeHtml(c.owner)}</div></td>
        <td>${escapeHtml(c.vehicle)}<br><span style="color:var(--gray);font-size:11px">${escapeHtml(c.plate || '—')}</span></td>
        <td><a href="https://wa.me/55${(c.contact || '').replace(/\D/g, '')}" target="_blank" style="color:var(--green);text-decoration:none">${escapeHtml(c.contact)}</a></td>
        <td style="font-weight:700">${escapeHtml(c.value || '—')}</td>
        <td style="font-size:12px;color:var(--gray)">${c.date ? new Date(c.date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
        <td><span class="badge ${consigStatusCls[c.status] || 'badge-seminovo'}">${consigStatusLabels[c.status] || c.status}</span></td>
        <td>
          <div class="actions">
            <button class="btn-icon edit" type="button" data-cedit="${c.id}" aria-label="Editar consignação de ${escapeHtml(c.owner)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon del" type="button" data-cdel="${c.id}" data-label="consignação de ${escapeHtml(c.owner)}" aria-label="Excluir consignação de ${escapeHtml(c.owner)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-cedit]').forEach(b => b.addEventListener('click', () => openConsigModal(b.dataset.cedit, b, cs)));
    tbody.querySelectorAll('[data-cdel]').forEach(b => b.addEventListener('click', () => confirmDelete('consig', b.dataset.cdel, b.dataset.label, b)));
  }

  /* ── MODAL DE CONSIGNAÇÃO ── */
  const consigOverlay = document.getElementById('consigModalOverlay');
  document.getElementById('newConsigBtn').addEventListener('click', e => openConsigModal(null, e.currentTarget));
  document.getElementById('consigModalCloseBtn').addEventListener('click', closeConsigModal);
  document.getElementById('consigCancelBtn').addEventListener('click', closeConsigModal);
  document.getElementById('consigSaveBtn').addEventListener('click', saveConsig);
  consigOverlay.addEventListener('click', e => { if (e.target === e.currentTarget) closeConsigModal(); });

  async function openConsigModal(id, triggerEl, cachedList) {
    lastFocusedEl = triggerEl || document.activeElement;
    document.getElementById('consigFormError').textContent = '';
    ['cId', 'cOwner', 'cContact', 'cVehicle', 'cPlate', 'cValue', 'cNotes', 'cCommission'].forEach(f => { document.getElementById(f).value = ''; });
    document.getElementById('cDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('cStatus').value = 'ativo';
    document.getElementById('consigModalTitle').textContent = id ? 'Editar Consignação' : 'Registrar Consignação';
    if (id) {
      const list = cachedList || await HM.getConsigs();
      const c = list.find(x => x.id === id);
      if (!c) return;
      document.getElementById('cId').value = c.id;
      document.getElementById('cOwner').value = c.owner;
      document.getElementById('cContact').value = c.contact;
      document.getElementById('cVehicle').value = c.vehicle;
      document.getElementById('cPlate').value = c.plate || '';
      document.getElementById('cValue').value = c.value || '';
      document.getElementById('cDate').value = c.date || '';
      document.getElementById('cStatus').value = c.status;
      document.getElementById('cCommission').value = c.commission || '';
      document.getElementById('cNotes').value = c.notes || '';
    }
    openModal(consigOverlay, document.getElementById('cOwner'));
  }
  function closeConsigModal() { closeModalEl(consigOverlay); }

  async function saveConsig() {
    const owner = document.getElementById('cOwner').value.trim();
    const contact = document.getElementById('cContact').value.trim();
    const vehicle = document.getElementById('cVehicle').value.trim();
    const errEl = document.getElementById('consigFormError');
    if (!owner || !contact || !vehicle) {
      errEl.textContent = 'Preencha todos os campos obrigatórios (*).';
      return;
    }
    errEl.textContent = '';
    const editId = document.getElementById('cId').value;
    const data = {
      owner, contact, vehicle,
      plate: document.getElementById('cPlate').value.trim(),
      value: document.getElementById('cValue').value.trim(),
      date: document.getElementById('cDate').value,
      status: document.getElementById('cStatus').value,
      commission: document.getElementById('cCommission').value.trim(),
      notes: document.getElementById('cNotes').value.trim(),
    };

    const saveBtn = document.getElementById('consigSaveBtn');
    saveBtn.disabled = true;
    try {
      if (editId) {
        await HM.updateConsig(editId, data);
        await HM.logActivity(`Consignação de ${owner} atualizada`, 'azul');
        toast('Consignação atualizada!', 'success');
      } else {
        await HM.createConsig(data);
        await HM.logActivity(`Nova consignação: ${vehicle} de ${owner}`, 'verde');
        toast('Consignação registrada!', 'success');
      }
      await Promise.all([renderConsigTable(), renderDashboard()]);
      closeConsigModal();
    } catch (err) {
      console.error('[admin] Falha ao salvar consignação.', err);
      errEl.textContent = 'Não foi possível salvar a consignação. Tente novamente.';
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ── EXCLUSÃO (modal de confirmação compartilhado) ── */
  const confirmOverlay = document.getElementById('confirmOverlay');
  document.getElementById('confirmCancelBtn').addEventListener('click', closeConfirm);
  document.getElementById('confirmOkBtn').addEventListener('click', executeDelete);
  confirmOverlay.addEventListener('click', e => { if (e.target === e.currentTarget) closeConfirm(); });

  function confirmDelete(type, id, label, triggerEl) {
    pendingDelete = { type, id };
    lastFocusedEl = triggerEl || document.activeElement;
    document.getElementById('confirmMsg').textContent = `Você está prestes a excluir "${label}". Esta ação não pode ser desfeita.`;
    openModal(confirmOverlay, document.getElementById('confirmCancelBtn'));
  }
  function closeConfirm() {
    closeModalEl(confirmOverlay);
    pendingDelete = { type: null, id: null };
  }
  async function executeDelete() {
    const { type, id } = pendingDelete;
    const okBtn = document.getElementById('confirmOkBtn');
    okBtn.disabled = true;
    try {
      if (type === 'vehicle') {
        await HM.deleteVehicle(id);
        await renderVehicleTable();
        await HM.logActivity('Veículo excluído do estoque', 'vermelho');
        toast('Veículo excluído.', 'success');
      } else if (type === 'consig') {
        await HM.deleteConsig(id);
        await renderConsigTable();
        await HM.logActivity('Consignação excluída', 'vermelho');
        toast('Consignação excluída.', 'success');
      }
      await renderDashboard();
      closeConfirm();
    } catch (err) {
      console.error('[admin] Falha ao excluir.', err);
      toast('Não foi possível excluir. Tente novamente.', 'error');
    } finally {
      okBtn.disabled = false;
    }
  }

  /* ── CONFIGURAÇÕES ── */
  async function loadConfigForm() {
    const cfg = await HM.getConfig();
    document.getElementById('cfg-name').value = cfg.name;
    document.getElementById('cfg-address').value = cfg.address;
    document.getElementById('cfg-wpp').value = cfg.wpp;
    document.getElementById('cfg-insta').value = cfg.insta;
    document.getElementById('cfg-h1').value = cfg.h1;
    document.getElementById('cfg-h2').value = cfg.h2;
    document.getElementById('cfg-about').value = cfg.about;
    document.getElementById('cfg-hero').checked = !!cfg.hero;
    document.getElementById('cfg-consig').checked = !!cfg.consig;
    document.getElementById('cfg-floatwpp').checked = !!cfg.floatwpp;
    document.getElementById('cfg-nophoto').checked = !!cfg.nophoto;
  }
  document.getElementById('saveConfigBtn').addEventListener('click', async () => {
    const cfg = {
      name: document.getElementById('cfg-name').value.trim(),
      address: document.getElementById('cfg-address').value.trim(),
      wpp: document.getElementById('cfg-wpp').value.replace(/\D/g, ''),
      insta: document.getElementById('cfg-insta').value.trim(),
      h1: document.getElementById('cfg-h1').value.trim(),
      h2: document.getElementById('cfg-h2').value.trim(),
      about: document.getElementById('cfg-about').value.trim(),
      hero: document.getElementById('cfg-hero').checked,
      consig: document.getElementById('cfg-consig').checked,
      floatwpp: document.getElementById('cfg-floatwpp').checked,
      nophoto: document.getElementById('cfg-nophoto').checked,
    };
    try {
      await HM.saveConfig(cfg);
      await HM.logActivity('Configurações salvas', 'azul');
      toast('Configurações salvas com sucesso! Recarregue o site público para ver as mudanças.', 'success');
    } catch (err) {
      console.error('[admin] Falha ao salvar configurações.', err);
      toast('Não foi possível salvar as configurações.', 'error');
    }
  });

  document.getElementById('changePassBtn').addEventListener('click', async () => {
    const p1 = document.getElementById('cfg-pass').value;
    const p2 = document.getElementById('cfg-pass2').value;
    const errEl = document.getElementById('passError');
    if (!p1) { errEl.textContent = 'Digite a nova senha.'; return; }
    if (p1 !== p2) { errEl.textContent = 'As senhas não coincidem.'; return; }
    if (p1.length < 6) { errEl.textContent = 'Senha muito curta (mín. 6 caracteres).'; return; }
    errEl.textContent = '';
    try {
      await HM.changePassword(p1);
      document.getElementById('cfg-pass').value = '';
      document.getElementById('cfg-pass2').value = '';
      toast('Senha alterada com sucesso!', 'success');
    } catch (err) {
      console.error('[admin] Falha ao trocar senha.', err);
      errEl.textContent = 'Não foi possível alterar a senha. Tente novamente.';
    }
  });

  /* ── FORMATAÇÃO DE PREÇO (aplica em qualquer campo de preço do painel) ── */
  ['vPrice', 'cValue'].forEach(id => {
    document.getElementById(id).addEventListener('input', function () {
      const v = this.value.replace(/[^\d]/g, '');
      this.value = v ? HM.formatPrice(Number(v)) : '';
    });
  });

  /* ── TOAST ── */
  function toast(msg, type = 'success') {
    const wrap = document.getElementById('toastWrap');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span class="toast-dot" aria-hidden="true"></span><span>${escapeHtml(msg)}</span>`;
    wrap.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3500);
  }

  /* ── MODAIS ACESSÍVEIS: abrir/fechar com foco preso e ESC ── */
  function openModal(overlay, focusEl) {
    overlay.hidden = false;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    (focusEl || overlay.querySelector('input, button')).focus();
    overlay._keydownHandler = (e) => onModalKeydown(e, overlay);
    document.addEventListener('keydown', overlay._keydownHandler);
  }
  function closeModalEl(overlay) {
    overlay.classList.remove('open');
    overlay.hidden = true;
    document.body.style.overflow = '';
    if (overlay._keydownHandler) document.removeEventListener('keydown', overlay._keydownHandler);
    if (lastFocusedEl) lastFocusedEl.focus();
  }
  function onModalKeydown(e, overlay) {
    if (e.key === 'Escape') {
      if (overlay === vehicleOverlay) closeVehicleModal();
      else if (overlay === consigOverlay) closeConsigModal();
      else if (overlay === confirmOverlay) closeConfirm();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = overlay.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select, textarea');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
})();
