/**
 * admin.js — lógica do painel do gestor (servido em /admin/)
 * Toda leitura/escrita de dados passa por HM (data.js) — autenticação real
 * (Supabase Auth), banco (Postgres com RLS) e fotos (Supabase Storage).
 *
 * Este arquivo mantém o estado das listas paginadas (veículos, consignações,
 * logs) em módulo-escopo, para que cada mutação atualize esse estado local
 * em vez de refazer a consulta inteira sempre que possível — e para que
 * dashboard e tabela nunca disparem a mesma consulta duas vezes.
 */
(function () {
  'use strict';

  const badgeLabels = { seminovo: 'Seminovo', consignado: 'Consignado', destaque: 'Destaque' };
  const badgeCls = { seminovo: 'badge-seminovo', consignado: 'badge-consignado', destaque: 'badge-destaque' };
  const consigStatusLabels = { ativo: 'Disponível', negociando: 'Em negociação', vendido: 'Vendido', devolvido: 'Devolvido' };
  const consigStatusCls = { ativo: 'badge-ativo', negociando: 'badge-negociando', vendido: 'badge-seminovo', devolvido: 'badge-inativo' };
  const ROLE_ORDER = { vendedor: 1, gerente: 2, administrador: 3 };
  const ROLE_LABELS = { administrador: 'Administrador', gerente: 'Gerente', vendedor: 'Vendedor' };

  const ICON_EYE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_EYE_OFF = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  const ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const ICON_DEL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>';
  const ICON_TAG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.59 13.41L11 3.83A2 2 0 009.59 3.24L4 3a1 1 0 00-1 1l.24 5.59a2 2 0 00.59 1.41l9.58 9.58a2 2 0 002.83 0l4.35-4.35a2 2 0 000-2.82z"/><circle cx="8" cy="8" r="1.5"/></svg>';
  const ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  const ICON_UNDO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-15-6.7L3 13"/></svg>';
  const ICON_EYE_SMALL = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="vertical-align:-2px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_WPP_SMALL = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:-2px"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';

  let lastFocusedEl = null;
  let pendingDelete = { type: null, id: null };
  let currentRole = 'vendedor';
  let currentUserId = '';
  let currentUserEmail = '';

  function roleAtLeast(min) { return (ROLE_ORDER[currentRole] || 0) >= (ROLE_ORDER[min] || 0); }

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
    } catch (err) {
      console.error('[admin] Falha no login.', err);
      errEl.textContent = 'E-mail ou senha incorretos.';
      submitBtn.disabled = false;
      return;
    }
    try {
      await enterAdminApp();
    } catch (err) {
      console.error('[admin] Login ok, mas falhou ao carregar o painel.', err);
      errEl.textContent = `Login feito, mas o painel não carregou: ${err.message || err}`;
    } finally {
      submitBtn.disabled = false;
    }
  });

  document.getElementById('googleLoginBtn').addEventListener('click', async () => {
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    try {
      await HM.loginWithGoogle();
    } catch (err) {
      console.error('[admin] Falha ao iniciar login com Google.', err);
      errEl.textContent = 'Não foi possível iniciar o login com Google.';
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await HM.logout();
    showLoginScreen();
  });

  async function enterAdminApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminApp').style.display = 'block';
    const profile = await HM.getCurrentUserProfile();
    currentRole = profile ? profile.role : 'vendedor';
    currentUserId = profile ? profile.id : '';
    currentUserEmail = profile ? profile.email : '';
    applyRolePermissions();
    resetVehicleState();
    resetConsigState();
    await Promise.all([renderDashboard(), loadVehiclePage(true), loadConsigPage(true), loadConfigForm()]);
    checkMobile();
  }

  function showLoginScreen() {
    document.getElementById('adminApp').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').textContent = '';
  }

  /** Ao carregar a página, mantém a sessão se o gestor já estiver autenticado
   * (inclusive voltando de um redirecionamento OAuth do Google). Os dois
   * passos são tratados em separado: uma falha genuína de conexão com o
   * Supabase é bem diferente de uma sessão válida cujo carregamento do
   * painel deu errado — mostrar o mesmo aviso pras duas coisas só esconde
   * a causa real. */
  (async function initSession() {
    let session;
    try {
      session = await HM.getSession();
    } catch (err) {
      console.error('[admin] Falha ao verificar sessão.', err);
      showLoginScreen();
      document.getElementById('loginError').textContent = 'Não foi possível conectar ao Supabase. Verifique sua conexão ou a configuração em supabase-client.js.';
      return;
    }
    if (!session) { showLoginScreen(); return; }
    try {
      await enterAdminApp();
    } catch (err) {
      console.error('[admin] Sessão válida, mas falhou ao carregar o painel.', err);
      showLoginScreen();
      document.getElementById('loginError').textContent = `Login feito, mas o painel não carregou: ${err.message || err}`;
    }
  })();

  /** Desloga automaticamente se a sessão expirar/for encerrada em outra aba,
   * e registra a entrada no painel quando uma sessão nova é criada de fato
   * (login por senha ou volta do redirecionamento do Google) — não em
   * releitura de sessão já existente ao reabrir a aba (evento INITIAL_SESSION). */
  HM.onAuthStateChange((session, event) => {
    if (event === 'SIGNED_OUT' && document.getElementById('adminApp').style.display !== 'none') {
      showLoginScreen();
    }
    if (event === 'SIGNED_IN') {
      HM.logSessionEntry();
    }
  });

  function applyRolePermissions() {
    const badge = document.getElementById('roleBadge');
    badge.hidden = false;
    badge.textContent = ROLE_LABELS[currentRole] || currentRole;
    badge.className = `role-badge ${currentRole}`;
    document.getElementById('topbarUser').textContent = currentUserEmail || 'Gestor · Holanda Motors';

    document.querySelectorAll('.nav-item[data-min-role]').forEach(btn => {
      btn.hidden = !roleAtLeast(btn.dataset.minRole);
    });

    const podeConfig = roleAtLeast('gerente');
    document.getElementById('saveConfigBtn').style.display = podeConfig ? '' : 'none';
    document.querySelectorAll('#page-configuracoes input, #page-configuracoes textarea').forEach(el => {
      if (el.id.startsWith('cfg-')) el.disabled = !podeConfig;
    });
    document.getElementById('backupSection').hidden = !podeConfig;
    document.getElementById('backupFinSection').hidden = !podeConfig;
  }

  /* ── NAVEGAÇÃO ── */
  const titles = {
    dashboard: 'Dashboard', veiculos: 'Veículos', consignacoes: 'Consignações',
    'fin-dashboard': 'Dashboard Financeiro', 'fin-fluxo': 'Fluxo de Caixa',
    'fin-receber': 'Contas a Receber', 'fin-pagar': 'Contas a Pagar',
    'fin-despesas': 'Despesas', 'fin-receitas': 'Receitas',
    'fin-comissoes': 'Comissões', 'fin-relatorios': 'Relatórios',
    usuarios: 'Usuários', logs: 'Logs', configuracoes: 'Configurações',
  };
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
    if (page === 'usuarios') { renderUsersTable(); renderAllowedEmailsTable(); }
    if (page === 'logs') loadLogsPage(true);
    if (page === 'fin-dashboard') renderDashboardFinanceiro();
    if (FIN_VIEWS[page]) abrirFinView(page);
    if (page === 'fin-comissoes') abrirComissoes();
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
    menuToggle.setAttribute('aria-expanded', 'false');
  }
  window.addEventListener('resize', () => { if (window.innerWidth >= 900) closeSidebar(); });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  /* ── DASHBOARD ── */
  async function renderDashboard() {
    let stats, consigStats, acts, maisVistos;
    try {
      [stats, consigStats, acts, maisVistos] = await Promise.all([HM.getVehicleStats(), HM.getConsigStats(), HM.getActivity(), HM.getMaisVistos()]);
    } catch (err) {
      console.error('[admin] Falha ao carregar o dashboard.', err);
      toast('Não foi possível carregar o dashboard.', 'error');
      return;
    }

    document.getElementById('dashStats').innerHTML = `
      <div class="stat-card blue"><div class="stat-card-label">Total cadastrados</div><div class="stat-card-val">${stats.total}</div><div class="stat-card-sub">${stats.ativos} visíveis no site</div></div>
      <div class="stat-card green"><div class="stat-card-label">Vendidos</div><div class="stat-card-val">${stats.vendidos}</div><div class="stat-card-sub">de ${stats.total} cadastrados</div></div>
      <div class="stat-card yellow"><div class="stat-card-label">Destaques</div><div class="stat-card-val">${stats.destaque}</div><div class="stat-card-sub">exibidos no hero do site</div></div>
      <div class="stat-card red-c"><div class="stat-card-label">Consignações</div><div class="stat-card-val">${consigStats.total}</div><div class="stat-card-sub">${consigStats.ativas} disponíveis</div></div>
    `;

    const pct = (n) => stats.total ? Math.round(n / stats.total * 100) : 0;
    document.getElementById('typeBars').innerHTML = `
      <div class="type-bar"><div class="type-bar-label">Carros</div><div class="type-bar-track"><div class="type-bar-fill" style="width:${pct(stats.carros)}%"></div></div><div class="type-bar-count">${stats.carros}</div></div>
      <div class="type-bar"><div class="type-bar-label">Motos</div><div class="type-bar-track"><div class="type-bar-fill" style="width:${pct(stats.motos)}%;background:var(--yellow)"></div></div><div class="type-bar-count">${stats.motos}</div></div>
      <div class="type-bar"><div class="type-bar-label">Consignados</div><div class="type-bar-track"><div class="type-bar-fill" style="width:${pct(stats.consignados)}%;background:var(--green)"></div></div><div class="type-bar-count">${stats.consignados}</div></div>
      <div class="type-bar"><div class="type-bar-label">Destaque</div><div class="type-bar-track"><div class="type-bar-fill" style="width:${pct(stats.destaque)}%;background:var(--blue)"></div></div><div class="type-bar-count">${stats.destaque}</div></div>
    `;

    const colors = { verde: 'var(--green)', amarelo: 'var(--yellow)', vermelho: 'var(--red)', azul: 'var(--blue)' };
    document.getElementById('activityList').innerHTML = acts.length
      ? acts.map(a => `<li class="activity-item"><span class="activity-dot" style="background:${colors[a.color] || 'var(--gray)'}"></span><span>${escapeHtml(a.msg)}</span><span class="activity-time">${a.time}</span></li>`).join('')
      : '<li class="activity-item"><span class="activity-dot" style="background:var(--gray)"></span><span style="color:var(--gray)">Nenhuma atividade ainda.</span></li>';

    document.getElementById('mostViewedList').innerHTML = maisVistos.length
      ? maisVistos.map(m => `<li class="most-viewed-item"><span class="most-viewed-name">${escapeHtml(m.nome)}</span><span class="most-viewed-count">${m.visualizacoes} visualizaç${m.visualizacoes === 1 ? 'ão' : 'ões'}</span></li>`).join('')
      : '<li class="most-viewed-item"><span style="color:var(--gray)">Ainda sem visualizações registradas.</span></li>';
  }

  /* ── TABELA DE VEÍCULOS (paginada + busca instantânea) ── */
  let vehicleState = { page: 0, pageSize: 20, search: '', tipo: '', badge: '', rows: [], total: 0, interesse: {} };
  function resetVehicleState() { vehicleState = { page: 0, pageSize: 20, search: '', tipo: '', badge: '', rows: [], total: 0, interesse: {} }; }

  let searchDebounceTimer = null;
  document.getElementById('searchVehicle').addEventListener('input', e => {
    clearTimeout(searchDebounceTimer);
    const valor = e.target.value;
    searchDebounceTimer = setTimeout(() => { vehicleState.search = valor; loadVehiclePage(true); }, 250);
  });
  document.getElementById('filterTipo').addEventListener('change', e => { vehicleState.tipo = e.target.value; loadVehiclePage(true); });
  document.getElementById('filterBadge').addEventListener('change', e => { vehicleState.badge = e.target.value; loadVehiclePage(true); });
  document.getElementById('vehicleLoadMoreBtn').addEventListener('click', () => loadVehiclePage(false));

  // Token de requisição: se o usuário mexer em outro filtro antes desta
  // consulta voltar, a resposta antiga (agora obsoleta) é descartada em vez
  // de sobrescrever o resultado mais recente na tela (mesmo achado do
  // catálogo público, corrigido aqui pelo mesmo motivo).
  let vehicleRequestToken = 0;

  async function loadVehiclePage(reset) {
    const requestToken = ++vehicleRequestToken;
    const pageToLoad = reset ? 0 : vehicleState.page + 1;
    const loadMoreBtn = document.getElementById('vehicleLoadMoreBtn');
    loadMoreBtn.disabled = true;
    try {
      const { rows, total } = await HM.getVehicles({ page: pageToLoad, pageSize: vehicleState.pageSize, search: vehicleState.search, tipo: vehicleState.tipo, badge: vehicleState.badge });
      if (requestToken !== vehicleRequestToken) return;
      vehicleState.page = pageToLoad;
      vehicleState.rows = reset ? rows : vehicleState.rows.concat(rows);
      vehicleState.total = total;
      renderVehicleTable();
      try {
        // Mescla em vez de sobrescrever: "carregar mais" só busca o
        // interesse da página nova, sem perder o das páginas já mostradas.
        const novoInteresse = await HM.getInteresseVeiculos(rows.map(v => v.id));
        if (requestToken !== vehicleRequestToken) return;
        vehicleState.interesse = reset ? novoInteresse : { ...vehicleState.interesse, ...novoInteresse };
        renderVehicleTable();
      } catch (err) {
        console.error('[admin] Falha ao carregar contadores de interesse.', err);
      }
    } catch (err) {
      if (requestToken !== vehicleRequestToken) return;
      console.error('[admin] Falha ao carregar veículos.', err);
      toast('Não foi possível carregar os veículos.', 'error');
    } finally {
      loadMoreBtn.disabled = false;
    }
  }

  function vehicleRowHtml(v, interesse) {
    const subParts = [v.cor || '—', v.combustivel || '—'];
    if (v.placa) subParts.push(`Placa ${v.placa}`);
    const visivelBadge = v.vendido
      ? `<span class="badge badge-vendido">Vendido</span>`
      : `<span class="badge ${v.ativo ? 'badge-ativo' : 'badge-inativo'}">${v.ativo ? 'Visível' : 'Oculto'}</span>`;
    const podeExcluir = roleAtLeast('gerente');
    const info = interesse || { visualizacoes: 0, whatsapp: 0 };
    return `
      <tr>
        <td>${v.img ? `<img class="td-img" src="${escapeHtml(v.img)}" alt="">` : `<div class="td-img" aria-hidden="true"></div>`}</td>
        <td><div class="td-name">${escapeHtml(v.make)} ${escapeHtml(v.model)}</div><div class="td-sub">${subParts.map(s => escapeHtml(s)).join(' · ')}</div></td>
        <td>${v.year} <span style="color:var(--gray)">/ ${Number(v.km).toLocaleString('pt-BR')} km</span></td>
        <td style="font-weight:700">${escapeHtml(v.price)}</td>
        <td style="text-transform:capitalize">${v.tipo}</td>
        <td><span class="badge ${badgeCls[v.badge]}">${badgeLabels[v.badge] || v.badge}</span></td>
        <td>${visivelBadge}</td>
        <td class="td-interesse" title="${info.visualizacoes} visualizações · ${info.whatsapp} cliques em WhatsApp">${ICON_EYE_SMALL} ${info.visualizacoes} &nbsp; ${ICON_WPP_SMALL} ${info.whatsapp}</td>
        <td>
          <div class="actions">
            <button class="btn-icon toggle" type="button" data-toggle="${v.id}" ${v.vendido ? 'disabled' : ''} aria-label="${v.ativo ? 'Ocultar do site' : 'Exibir no site'}">${v.ativo ? ICON_EYE_OFF : ICON_EYE}</button>
            <button class="btn-icon sold" type="button" data-sold="${v.id}" data-vendido="${v.vendido ? '1' : '0'}" data-label="${escapeHtml(v.make)} ${escapeHtml(v.model)}" aria-label="${v.vendido ? 'Reverter para disponível' : 'Marcar como vendido'}">${ICON_TAG}</button>
            <button class="btn-icon edit" type="button" data-edit="${v.id}" aria-label="Editar ${escapeHtml(v.make)} ${escapeHtml(v.model)}">${ICON_EDIT}</button>
            ${podeExcluir ? `<button class="btn-icon del" type="button" data-del="${v.id}" data-label="${escapeHtml(v.make)} ${escapeHtml(v.model)}" aria-label="Excluir ${escapeHtml(v.make)} ${escapeHtml(v.model)}">${ICON_DEL}</button>` : ''}
          </div>
        </td>
      </tr>`;
  }

  function renderVehicleTable() {
    const vs = vehicleState.rows;
    const tbody = document.getElementById('vehicleTableBody');
    if (!vs.length) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><p>Nenhum veículo encontrado.</p></div></td></tr>`;
    } else {
      tbody.innerHTML = vs.map(v => vehicleRowHtml(v, vehicleState.interesse[v.id])).join('');
      tbody.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => toggleVisible(b.dataset.toggle)));
      tbody.querySelectorAll('[data-sold]').forEach(b => b.addEventListener('click', () => markSold(b.dataset.sold, b.dataset.label, b.dataset.vendido === '1')));
      tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openVehicleModal(b.dataset.edit, b)));
      tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => confirmDelete('vehicle', b.dataset.del, b.dataset.label, b)));
    }
    document.getElementById('vehicleListCount').textContent = vs.length ? `Mostrando ${vs.length} de ${vehicleState.total}` : '';
    document.getElementById('vehicleLoadMoreBtn').hidden = vs.length >= vehicleState.total;
  }

  async function toggleVisible(id) {
    try {
      const novoEstado = await HM.toggleVehicleAtivo(id);
      const v = vehicleState.rows.find(x => x.id === id);
      if (v) v.ativo = novoEstado;
      renderVehicleTable();
      renderDashboard();
      toast(novoEstado ? 'Veículo exibido no site.' : 'Veículo ocultado do site.', 'success');
    } catch (err) {
      console.error('[admin] Falha ao alterar visibilidade.', err);
      toast('Não foi possível alterar a visibilidade do veículo.', 'error');
    }
  }

  async function markSold(id, label, vendidoAtual) {
    const novo = !vendidoAtual;
    try {
      await HM.setVehicleVendido(id, novo, label);
      const v = vehicleState.rows.find(x => x.id === id);
      if (v) { v.vendido = novo; if (novo) v.ativo = false; }
      renderVehicleTable();
      renderDashboard();
      toast(novo ? 'Veículo marcado como vendido.' : 'Veículo revertido para disponível.', 'success');
    } catch (err) {
      console.error('[admin] Falha ao atualizar status de venda.', err);
      toast('Não foi possível atualizar o status de venda.', 'error');
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

  function openVehicleModal(id, triggerEl) {
    resetGallery();
    lastFocusedEl = triggerEl || document.activeElement;
    document.getElementById('vehicleFormError').textContent = '';

    ['vId', 'vUpdatedAt', 'vMake', 'vModel', 'vYear', 'vKm', 'vPrice', 'vColor', 'vPlaca', 'vDesc', 'vImgUrl'].forEach(f => { document.getElementById(f).value = ''; });
    Object.entries(vehicleDefaults).forEach(([f, val]) => { document.getElementById(f).value = val; });

    document.getElementById('vehicleModalTitle').textContent = id ? 'Editar Veículo' : 'Novo Veículo';
    document.getElementById('vehicleSoldBtn').hidden = !id;
    document.getElementById('vehicleHistoryWrap').hidden = !id;

    if (id) {
      const v = vehicleState.rows.find(x => x.id === id);
      if (!v) return;
      document.getElementById('vId').value = v.id;
      document.getElementById('vUpdatedAt').value = v.updatedAt || '';
      document.getElementById('vMake').value = v.make;
      document.getElementById('vModel').value = v.model;
      document.getElementById('vYear').value = v.year;
      document.getElementById('vKm').value = v.km;
      document.getElementById('vPrice').value = v.price;
      document.getElementById('vColor').value = v.cor || '';
      document.getElementById('vPlaca').value = v.placa || '';
      document.getElementById('vDesc').value = v.desc || '';
      document.getElementById('vTipo').value = v.tipo;
      document.getElementById('vBadge').value = v.badge;
      document.getElementById('vCambio').value = v.cambio || 'Automático';
      document.getElementById('vCombustivel').value = v.combustivel || 'Flex';
      document.getElementById('vAtivo').value = v.ativo ? '1' : '0';
      galleryImages = (v.imagens || []).map(img => ({ id: img.id, file: null, url: img.url, previewUrl: img.url, principal: img.principal }));
      renderGallery();

      const soldBtn = document.getElementById('vehicleSoldBtn');
      soldBtn.textContent = v.vendido ? 'Reverter venda' : 'Marcar como vendido';
      soldBtn.onclick = () => markSold(v.id, `${v.make} ${v.model}`, v.vendido).then(closeVehicleModal);

      loadVehicleHistory(v.id);
    }
    openModal(vehicleOverlay, document.getElementById('vMake'));
  }
  function closeVehicleModal() { closeModalEl(vehicleOverlay); resetGallery(); }

  async function loadVehicleHistory(vehicleId) {
    const list = document.getElementById('vehicleHistoryList');
    list.innerHTML = '<li class="log-empty">Carregando…</li>';
    try {
      const { rows } = await HM.getLogs({ entidade: 'veiculo', entidadeId: vehicleId, pageSize: 15 });
      list.innerHTML = rows.length
        ? rows.map(l => `<li><strong>${escapeHtml(l.usuario_email ? l.usuario_email.split('@')[0] : 'Alguém')}</strong> ${escapeHtml((l.detalhes && l.detalhes.resumo) || l.acao)} <span style="float:right;color:var(--gray)">${new Date(l.created_at).toLocaleString('pt-BR')}</span></li>`).join('')
        : '<li class="log-empty">Sem histórico registrado ainda.</li>';
    } catch (err) {
      console.error('[admin] Falha ao carregar histórico do veículo.', err);
      list.innerHTML = '<li class="log-empty">Não foi possível carregar o histórico.</li>';
    }
  }

  async function saveVehicle() {
    const make = document.getElementById('vMake').value.trim();
    const model = document.getElementById('vModel').value.trim();
    const year = Number(document.getElementById('vYear').value);
    const km = document.getElementById('vKm').value;
    const price = document.getElementById('vPrice').value.trim();
    const errEl = document.getElementById('vehicleFormError');

    if (!make || !model || !price || !year || km === '') { errEl.textContent = 'Preencha todos os campos obrigatórios (*).'; return; }
    if (year < 1990 || year > 2027) { errEl.textContent = 'Informe um ano de fabricação válido.'; return; }
    if (Number(km) < 0) { errEl.textContent = 'A quilometragem não pode ser negativa.'; return; }
    if (galleryImages.some(i => i.uploading)) { errEl.textContent = 'Aguarde a compactação das fotos terminar.'; return; }
    errEl.textContent = '';

    const editId = document.getElementById('vId').value;
    const data = {
      make, model, year, km: Number(km), price,
      cor: document.getElementById('vColor').value.trim(),
      placa: document.getElementById('vPlaca').value.trim().toUpperCase(),
      tipo: document.getElementById('vTipo').value,
      badge: document.getElementById('vBadge').value,
      cambio: document.getElementById('vCambio').value,
      combustivel: document.getElementById('vCombustivel').value,
      ativo: Number(document.getElementById('vAtivo').value),
      images: galleryImages,
      desc: document.getElementById('vDesc').value.trim(),
    };

    const saveBtn = document.getElementById('vehicleSaveBtn');
    saveBtn.disabled = true;
    try {
      if (editId) {
        data.expectedUpdatedAt = document.getElementById('vUpdatedAt').value || null;
        await HM.updateVehicle(editId, data);
        toast('Veículo atualizado com sucesso!', 'success');
      } else {
        await HM.createVehicle(data);
        toast('Veículo adicionado com sucesso!', 'success');
      }
      await Promise.all([loadVehiclePage(true), renderDashboard()]);
      closeVehicleModal();
    } catch (err) {
      console.error('[admin] Falha ao salvar veículo.', err);
      errEl.textContent = (err instanceof HM.ConcurrencyError) ? err.message : 'Não foi possível salvar o veículo. Tente novamente.';
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ── GALERIA DE FOTOS (múltiplas, arrastar-e-soltar, compactação automática) ── */
  let galleryImages = []; // { id, file, url, previewUrl, principal, uploading }
  const uploadArea = document.getElementById('uploadArea');
  const imgFileInput = document.getElementById('imgFileInput');
  const vImgUrlInput = document.getElementById('vImgUrl');

  function resetGallery() { galleryImages = []; renderGallery(); }

  function renderGallery() {
    const wrap = document.getElementById('imgGallery');
    wrap.innerHTML = galleryImages.map((img, idx) => `
      <div class="img-gallery-item ${img.uploading ? 'uploading' : ''}">
        <img src="${escapeHtml(img.previewUrl || img.url)}" alt="">
        ${img.principal ? '<span class="gallery-principal-tag">Capa</span>' : ''}
        <div class="gallery-actions">
          <button type="button" class="gallery-btn star ${img.principal ? 'is-principal' : ''}" data-star="${idx}" aria-label="Definir como capa" title="Definir como capa">★</button>
          <button type="button" class="gallery-btn" data-removeimg="${idx}" aria-label="Remover foto" title="Remover">✕</button>
        </div>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-star]').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.star);
      galleryImages.forEach((im, idx) => { im.principal = idx === i; });
      renderGallery();
    }));
    wrap.querySelectorAll('[data-removeimg]').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.removeimg);
      const removida = galleryImages.splice(i, 1)[0];
      if (removida && removida.principal && galleryImages.length) galleryImages[0].principal = true;
      renderGallery();
    }));
  }

  async function addFilesToGallery(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (!files.length) { toast('Selecione arquivos de imagem válidos.', 'error'); return; }
    for (const file of files) {
      if (file.size > 15 * 1024 * 1024) { toast(`"${file.name}" é grande demais (máx. 15MB antes da compactação).`, 'error'); continue; }
      const item = { id: null, file: null, url: '', previewUrl: URL.createObjectURL(file), principal: galleryImages.length === 0, uploading: true };
      galleryImages.push(item);
      renderGallery();
      item.file = await HM.compressImage(file);
      item.uploading = false;
      renderGallery();
    }
  }

  imgFileInput.addEventListener('change', e => { addFilesToGallery(e.target.files); e.target.value = ''; });
  uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag');
    if (e.dataTransfer.files.length) addFilesToGallery(e.dataTransfer.files);
  });

  function addUrlFromInput() {
    const url = vImgUrlInput.value.trim();
    if (!url) return;
    galleryImages.push({ id: null, file: null, url, previewUrl: url, principal: galleryImages.length === 0 });
    vImgUrlInput.value = '';
    renderGallery();
  }
  vImgUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addUrlFromInput(); } });
  vImgUrlInput.addEventListener('blur', addUrlFromInput);

  /* ── TABELA DE CONSIGNAÇÕES (paginada) ── */
  let consigState = { page: 0, pageSize: 20, rows: [], total: 0 };
  function resetConsigState() { consigState = { page: 0, pageSize: 20, rows: [], total: 0 }; }
  document.getElementById('consigLoadMoreBtn').addEventListener('click', () => loadConsigPage(false));

  let consigRequestToken = 0;

  async function loadConsigPage(reset) {
    const requestToken = ++consigRequestToken;
    const pageToLoad = reset ? 0 : consigState.page + 1;
    const btn = document.getElementById('consigLoadMoreBtn');
    btn.disabled = true;
    try {
      const { rows, total } = await HM.getConsigs({ page: pageToLoad, pageSize: consigState.pageSize });
      if (requestToken !== consigRequestToken) return;
      consigState.page = pageToLoad;
      consigState.rows = reset ? rows : consigState.rows.concat(rows);
      consigState.total = total;
      renderConsigTable();
    } catch (err) {
      if (requestToken !== consigRequestToken) return;
      console.error('[admin] Falha ao carregar consignações.', err);
      toast('Não foi possível carregar as consignações.', 'error');
    } finally {
      if (requestToken === consigRequestToken) btn.disabled = false;
    }
  }

  function renderConsigTable() {
    const cs = consigState.rows;
    const tbody = document.getElementById('consigTableBody');
    if (!cs.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>Nenhuma consignação registrada.</p></div></td></tr>`;
    } else {
      const podeExcluir = roleAtLeast('gerente');
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
              <button class="btn-icon edit" type="button" data-cedit="${c.id}" aria-label="Editar consignação de ${escapeHtml(c.owner)}">${ICON_EDIT}</button>
              ${podeExcluir ? `<button class="btn-icon del" type="button" data-cdel="${c.id}" data-label="consignação de ${escapeHtml(c.owner)}" aria-label="Excluir consignação de ${escapeHtml(c.owner)}">${ICON_DEL}</button>` : ''}
            </div>
          </td>
        </tr>
      `).join('');
      tbody.querySelectorAll('[data-cedit]').forEach(b => b.addEventListener('click', () => openConsigModal(b.dataset.cedit, b)));
      tbody.querySelectorAll('[data-cdel]').forEach(b => b.addEventListener('click', () => confirmDelete('consig', b.dataset.cdel, b.dataset.label, b)));
    }
    document.getElementById('consigListCount').textContent = cs.length ? `Mostrando ${cs.length} de ${consigState.total}` : '';
    document.getElementById('consigLoadMoreBtn').hidden = cs.length >= consigState.total;
  }

  /* ── MODAL DE CONSIGNAÇÃO ── */
  const consigOverlay = document.getElementById('consigModalOverlay');
  document.getElementById('newConsigBtn').addEventListener('click', e => openConsigModal(null, e.currentTarget));
  document.getElementById('consigModalCloseBtn').addEventListener('click', closeConsigModal);
  document.getElementById('consigCancelBtn').addEventListener('click', closeConsigModal);
  document.getElementById('consigSaveBtn').addEventListener('click', saveConsig);
  consigOverlay.addEventListener('click', e => { if (e.target === e.currentTarget) closeConsigModal(); });

  function openConsigModal(id, triggerEl) {
    lastFocusedEl = triggerEl || document.activeElement;
    document.getElementById('consigFormError').textContent = '';
    ['cId', 'cUpdatedAt', 'cOwner', 'cContact', 'cVehicle', 'cPlate', 'cValue', 'cNotes', 'cCommission'].forEach(f => { document.getElementById(f).value = ''; });
    document.getElementById('cDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('cStatus').value = 'ativo';
    document.getElementById('consigModalTitle').textContent = id ? 'Editar Consignação' : 'Registrar Consignação';
    if (id) {
      const c = consigState.rows.find(x => x.id === id);
      if (!c) return;
      document.getElementById('cId').value = c.id;
      document.getElementById('cUpdatedAt').value = c.updatedAt || '';
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
    if (!owner || !contact || !vehicle) { errEl.textContent = 'Preencha todos os campos obrigatórios (*).'; return; }
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
        data.expectedUpdatedAt = document.getElementById('cUpdatedAt').value || null;
        await HM.updateConsig(editId, data);
        toast('Consignação atualizada!', 'success');
      } else {
        await HM.createConsig(data);
        toast('Consignação registrada!', 'success');
      }
      await Promise.all([loadConsigPage(true), renderDashboard()]);
      closeConsigModal();
    } catch (err) {
      console.error('[admin] Falha ao salvar consignação.', err);
      errEl.textContent = (err instanceof HM.ConcurrencyError) ? err.message : 'Não foi possível salvar a consignação. Tente novamente.';
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   * FINANCEIRO — Dashboard e Fluxo de Caixa
   * ════════════════════════════════════════════════════════════════════ */

  const FIN_FORMA_LABELS = { pix: 'PIX', dinheiro: 'Dinheiro', cartao_debito: 'Cartão débito', cartao_credito: 'Cartão crédito', transferencia: 'Transferência', financiamento: 'Financiamento', cheque: 'Cheque' };
  const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  function formatMesLabel(isoMes) {
    const [ano, mes] = isoMes.split('-');
    return `${MESES_ABREV[Number(mes) - 1]}/${ano.slice(2)}`;
  }

  /* ── Dashboard Financeiro ── */
  let finCharts = {};
  function destroyFinChart(key) {
    if (finCharts[key]) { finCharts[key].destroy(); delete finCharts[key]; }
  }
  function finChartOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#888', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,.06)' } },
        y: { ticks: { color: '#888', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
      },
      plugins: { legend: { labels: { color: '#aaa', font: { size: 11 } } } },
    };
  }

  async function renderDashboardFinanceiro() {
    const statsEl = document.getElementById('finDashStats');
    try {
      const d = await HM.getDashboardFinanceiro();
      const lucro = d.entradasMes - d.saidasMes;
      const cards = [
        { label: 'Saldo atual', val: HM.formatPrice(d.saldoAtual), cls: d.saldoAtual >= 0 ? 'green' : 'red-c' },
        { label: 'Entradas do mês', val: HM.formatPrice(d.entradasMes), cls: 'green' },
        { label: 'Saídas do mês', val: HM.formatPrice(d.saidasMes), cls: 'red-c' },
        { label: 'Lucro líquido (mês)', val: HM.formatPrice(lucro), cls: lucro >= 0 ? 'green' : 'red-c' },
        { label: 'Contas vencidas', val: d.contasVencidas, sub: HM.formatPrice(d.contasVencidasValor), cls: d.contasVencidas ? 'red-c' : '' },
        { label: 'Contas a vencer (7 dias)', val: d.contasAVencer, sub: HM.formatPrice(d.contasAVencerValor), cls: 'yellow' },
        { label: 'Recebimentos de hoje', val: HM.formatPrice(d.recebimentosHoje), cls: 'blue' },
        { label: 'Pagamentos de hoje', val: HM.formatPrice(d.pagamentosHoje), cls: 'blue' },
      ];
      statsEl.innerHTML = cards.map(c => `
        <div class="stat-card ${c.cls}">
          <div class="stat-card-label">${c.label}</div>
          <div class="stat-card-val">${c.val}</div>
          ${c.sub ? `<div class="stat-card-sub">${c.sub}</div>` : ''}
        </div>
      `).join('');

      if (typeof Chart === 'undefined') return;

      destroyFinChart('fluxo');
      finCharts.fluxo = new Chart(document.getElementById('finChartFluxo'), {
        type: 'bar',
        data: {
          labels: d.fluxoPorMes.map(m => formatMesLabel(m.mes)),
          datasets: [
            { label: 'Entradas', data: d.fluxoPorMes.map(m => m.entradas), backgroundColor: '#22C55E', borderRadius: 3 },
            { label: 'Saídas', data: d.fluxoPorMes.map(m => m.saidas), backgroundColor: '#C8102E', borderRadius: 3 },
          ],
        },
        options: finChartOptions(),
      });

      destroyFinChart('receitaDespesa');
      finCharts.receitaDespesa = new Chart(document.getElementById('finChartReceitaDespesa'), {
        type: 'doughnut',
        data: { labels: ['Receita', 'Despesa'], datasets: [{ data: [d.entradasMes, d.saidasMes], backgroundColor: ['#22C55E', '#C8102E'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#aaa', font: { size: 11 } } } } },
      });

      destroyFinChart('receitas');
      finCharts.receitas = new Chart(document.getElementById('finChartReceitas'), {
        type: 'bar',
        data: { labels: d.receitasPorCategoria.map(c => c.categoria), datasets: [{ label: 'Receitas', data: d.receitasPorCategoria.map(c => c.total), backgroundColor: '#3B82F6', borderRadius: 3 }] },
        options: { ...finChartOptions(), indexAxis: 'y' },
      });

      destroyFinChart('despesas');
      finCharts.despesas = new Chart(document.getElementById('finChartDespesas'), {
        type: 'bar',
        data: { labels: d.despesasPorCategoria.map(c => c.categoria), datasets: [{ label: 'Despesas', data: d.despesasPorCategoria.map(c => c.total), backgroundColor: '#C8102E', borderRadius: 3 }] },
        options: { ...finChartOptions(), indexAxis: 'y' },
      });
    } catch (err) {
      console.error('[admin] Falha ao carregar dashboard financeiro.', err);
      statsEl.innerHTML = `<div class="stat-card"><div class="stat-card-label">Erro ao carregar</div><div class="stat-card-val">—</div></div>`;
      toast('Não foi possível carregar o dashboard financeiro.', 'error');
    }
  }

  /* ── VISÕES DO LEDGER ─────────────────────────────────────────────────
   * Fluxo de Caixa, Contas a Receber, Contas a Pagar, Despesas e Receitas
   * são a mesma tabela sob recortes diferentes — então existe uma
   * implementação só. Cada visão declara apenas o que a diferencia
   * (filtros travados, colunas, rótulos) e a fábrica lá embaixo monta a
   * página inteira: barra de filtros, tabela, paginação e ações.
   * ────────────────────────────────────────────────────────────────── */

  /** Colunas disponíveis. Cada visão escolhe as suas em FIN_VIEWS.colunas. */
  const FIN_COLUNAS = {
    data: {
      th: 'Data',
      td: l => `<td class="fin-td-nowrap">${HM.formatDateBR(l.dataLancamento)}</td>`,
    },
    vencimento: {
      th: 'Vencimento',
      td: l => `<td class="fin-td-nowrap${l.vencida ? ' fin-valor-saida' : ''}">${l.dataVencimento ? HM.formatDateBR(l.dataVencimento) : '—'}</td>`,
    },
    descricao: {
      th: 'Descrição',
      td: l => `<td><div class="td-name">${escapeHtml(l.descricao)}</div>${l.formaPagamento ? `<div class="td-sub">${FIN_FORMA_LABELS[l.formaPagamento] || l.formaPagamento}</div>` : ''}</td>`,
    },
    categoria: {
      th: 'Categoria',
      td: l => `<td class="fin-td-muted">${escapeHtml(l.categoriaNome || '—')}</td>`,
    },
    pessoa: {
      th: cfg => cfg.pessoa === 'cliente' ? 'Cliente' : 'Fornecedor',
      td: (l, cfg) => `<td class="fin-td-muted">${escapeHtml((cfg.pessoa === 'cliente' ? l.clienteNome : l.fornecedorNome) || '—')}</td>`,
    },
    tipo: {
      th: 'Tipo',
      td: l => `<td><span class="badge ${l.tipo === 'entrada' ? 'badge-ativo' : 'badge-vendido'}">${l.tipo === 'entrada' ? 'Entrada' : 'Saída'}</span></td>`,
    },
    valor: {
      th: 'Valor',
      td: l => `<td class="fin-td-valor ${l.tipo === 'entrada' ? 'fin-valor-entrada' : 'fin-valor-saida'}">${l.tipo === 'entrada' ? '+' : '−'} ${HM.formatPrice(l.valor)}</td>`,
    },
    saldo: {
      th: 'Em aberto',
      td: l => `<td class="fin-td-valor">${l.saldo > 0 ? HM.formatPrice(l.saldo) : '—'}</td>`,
    },
    status: {
      th: 'Status',
      td: l => `<td>${lancamentoStatusBadge(l)}</td>`,
    },
  };

  /** Filtros disponíveis (além da busca e do período, que toda visão tem). */
  const FIN_FILTROS = {
    tipo: { campo: 'tipo', rotulo: 'Filtrar por tipo', opcoes: [['', 'Entradas e saídas'], ['entrada', 'Entradas'], ['saida', 'Saídas']] },
    status: { campo: 'status', rotulo: 'Filtrar por status', opcoes: [['', 'Todos os status'], ['pendente', 'Pendente'], ['pago', 'Pago'], ['cancelado', 'Cancelado']] },
    categoria: { campo: 'categoriaId', rotulo: 'Filtrar por categoria', opcoes: [['', 'Todas as categorias']], dinamico: 'categorias' },
    forma: {
      campo: 'formaPagamento', rotulo: 'Filtrar por forma de pagamento',
      opcoes: [['', 'Todas as formas'], ...Object.entries(FIN_FORMA_LABELS)],
    },
  };

  const FIN_VIEWS = {
    'fin-fluxo': {
      titulo: 'Fluxo de Caixa',
      novoLabel: 'Novo lançamento',
      busca: 'Buscar por descrição...',
      fixos: {},
      padroes: {},
      colunas: ['data', 'descricao', 'categoria', 'tipo', 'valor', 'status'],
      filtros: ['tipo', 'status', 'categoria', 'forma'],
      vazio: 'Nenhum lançamento encontrado.',
    },
    'fin-receber': {
      titulo: 'Contas a Receber',
      novoLabel: 'Nova cobrança',
      busca: 'Buscar por descrição...',
      hint: 'Valores que clientes ainda devem à loja. Use o botão de baixa (✓) para registrar um recebimento parcial ou total — cada recebimento fica no histórico do lançamento.',
      fixos: { tipo: 'entrada' },
      padroes: { tipo: 'entrada', status: 'pendente' },
      pessoa: 'cliente',
      colunas: ['vencimento', 'descricao', 'pessoa', 'valor', 'saldo', 'status'],
      filtros: ['status', 'categoria'],
      statusPadrao: 'pendente',
      ordem: 'vencimento-proximo',
      vazio: 'Nenhuma conta a receber neste filtro.',
    },
    'fin-pagar': {
      titulo: 'Contas a Pagar',
      novoLabel: 'Nova conta a pagar',
      busca: 'Buscar por descrição...',
      hint: 'Compromissos da loja com fornecedores, impostos, aluguel, funcionários e afins. Use o botão de baixa (✓) para registrar um pagamento parcial ou total.',
      fixos: { tipo: 'saida' },
      padroes: { tipo: 'saida', status: 'pendente' },
      pessoa: 'fornecedor',
      colunas: ['vencimento', 'descricao', 'pessoa', 'valor', 'saldo', 'status'],
      filtros: ['status', 'categoria'],
      statusPadrao: 'pendente',
      ordem: 'vencimento-proximo',
      vazio: 'Nenhuma conta a pagar neste filtro.',
    },
    'fin-despesas': {
      titulo: 'Despesas',
      novoLabel: 'Nova despesa',
      busca: 'Buscar por descrição...',
      fixos: { tipo: 'saida' },
      padroes: { tipo: 'saida', status: 'pago' },
      pessoa: 'fornecedor',
      colunas: ['data', 'descricao', 'categoria', 'pessoa', 'valor', 'status'],
      filtros: ['status', 'categoria', 'forma'],
      vazio: 'Nenhuma despesa encontrada.',
    },
    'fin-receitas': {
      titulo: 'Receitas',
      novoLabel: 'Nova receita',
      busca: 'Buscar por descrição...',
      fixos: { tipo: 'entrada' },
      padroes: { tipo: 'entrada', status: 'pago' },
      pessoa: 'cliente',
      colunas: ['data', 'descricao', 'categoria', 'pessoa', 'valor', 'status'],
      filtros: ['status', 'categoria', 'forma'],
      vazio: 'Nenhuma receita encontrada.',
    },
  };

  let finCategoriasCarregadas = false;
  let finCategoriasEntrada = [];
  let finCategoriasSaida = [];
  const finViews = {};
  let finViewAtiva = null;

  async function carregarCategoriasFinanceiras() {
    if (finCategoriasCarregadas) return;
    try {
      const [entrada, saida] = await Promise.all([HM.getCategoriasFinanceiras('entrada'), HM.getCategoriasFinanceiras('saida')]);
      finCategoriasEntrada = entrada;
      finCategoriasSaida = saida;
      finCategoriasCarregadas = true;
    } catch (err) {
      console.error('[admin] Falha ao carregar categorias financeiras.', err);
    }
  }

  /** Categorias raiz que fazem sentido para a visão (só de entrada, só de
   * saída, ou as duas quando a visão não trava o tipo). */
  function finCategoriasDaVisao(cfg) {
    const lista = cfg.fixos.tipo === 'entrada' ? finCategoriasEntrada
      : cfg.fixos.tipo === 'saida' ? finCategoriasSaida
      : [...finCategoriasEntrada, ...finCategoriasSaida];
    return lista.filter(c => !c.categoria_pai_id).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  function lancamentoStatusBadge(l) {
    if (l.status === 'cancelado') return `<span class="badge badge-inativo">Cancelado</span>`;
    if (l.status === 'pago') return `<span class="badge badge-ativo">Pago</span>`;
    if (l.vencida) return `<span class="badge badge-vencido">Vencido</span>`;
    if (l.valorPago > 0) return `<span class="badge badge-negociando">Parcial</span>`;
    return `<span class="badge badge-negociando">Pendente</span>`;
  }

  function finViewShellHtml(key, cfg) {
    const filtros = (cfg.filtros || []).map(nome => {
      const f = FIN_FILTROS[nome];
      const opcoes = f.dinamico === 'categorias'
        ? [...f.opcoes, ...finCategoriasDaVisao(cfg).map(c => [c.id, c.nome])]
        : f.opcoes;
      const selecionada = cfg.statusPadrao && f.campo === 'status' ? cfg.statusPadrao : '';
      return `
        <label class="sr-only" for="${key}-f-${nome}">${f.rotulo}</label>
        <select class="filter-select" id="${key}-f-${nome}">
          ${opcoes.map(([v, t]) => `<option value="${escapeHtml(v)}"${v === selecionada ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        </select>`;
    }).join('');

    const colunas = cfg.colunas.map(c => FIN_COLUNAS[c]);
    const ths = colunas.map(c => `<th scope="col">${escapeHtml(typeof c.th === 'function' ? c.th(cfg) : c.th)}</th>`).join('');

    return `
      <div class="section-header">
        <h1 class="section-title">${escapeHtml(cfg.titulo)}</h1>
        <button class="btn-primary" id="${key}-novo" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${escapeHtml(cfg.novoLabel)}
        </button>
      </div>
      ${cfg.hint ? `<p class="page-hint">${escapeHtml(cfg.hint)}</p>` : ''}
      <div class="search-bar">
        <label class="sr-only" for="${key}-search">Buscar em ${escapeHtml(cfg.titulo)}</label>
        <input class="search-input" id="${key}-search" placeholder="${escapeHtml(cfg.busca)}">
        ${filtros}
        <label class="sr-only" for="${key}-inicio">Data inicial</label>
        <input class="search-input fin-date-input" id="${key}-inicio" type="date" title="Data inicial">
        <label class="sr-only" for="${key}-fim">Data final</label>
        <input class="search-input fin-date-input" id="${key}-fim" type="date" title="Data final">
      </div>
      <div class="table-wrap">
        <table>
          <caption class="sr-only">${escapeHtml(cfg.titulo)}</caption>
          <thead><tr>${ths}<th scope="col">Ações</th></tr></thead>
          <tbody id="${key}-tbody" aria-live="polite"></tbody>
        </table>
      </div>
      <div class="list-footer">
        <span class="list-count" id="${key}-count"></span>
        <button class="btn-secondary" id="${key}-more" type="button" hidden>Carregar mais</button>
      </div>`;
  }

  /**
   * Monta uma visão do ledger dentro da sua seção e devolve o controlador.
   * Cada visão tem seu próprio estado, seu próprio token de requisição
   * (respostas atrasadas de um filtro antigo são descartadas) e sua própria
   * paginação — trocar de página no menu não embaralha os resultados.
   */
  function criarFinView(key, cfg) {
    const secao = document.getElementById('page-' + key);
    secao.innerHTML = finViewShellHtml(key, cfg);

    const colunas = cfg.colunas.map(c => FIN_COLUNAS[c]);
    const el = sufixo => document.getElementById(`${key}-${sufixo}`);
    const state = {
      page: 0, pageSize: 25, search: '',
      tipo: '', status: cfg.statusPadrao || '', formaPagamento: '', categoriaId: '',
      dataInicio: '', dataFim: '', rows: [], total: 0,
    };
    let token = 0;
    let debounceBusca;

    el('search').addEventListener('input', e => {
      clearTimeout(debounceBusca);
      const valor = e.target.value;
      debounceBusca = setTimeout(() => { state.search = valor; load(true); }, 250);
    });
    (cfg.filtros || []).forEach(nome => {
      el('f-' + nome).addEventListener('change', e => { state[FIN_FILTROS[nome].campo] = e.target.value; load(true); });
    });
    el('inicio').addEventListener('change', e => { state.dataInicio = e.target.value; load(true); });
    el('fim').addEventListener('change', e => { state.dataFim = e.target.value; load(true); });
    el('more').addEventListener('click', () => load(false));
    el('novo').addEventListener('click', e => openLancamentoModal(null, e.currentTarget, cfg.padroes));

    async function load(reset) {
      const requestToken = ++token;
      const pageToLoad = reset ? 0 : state.page + 1;
      const btnMais = el('more');
      btnMais.disabled = true;
      try {
        const { rows, total } = await HM.getLancamentos({
          page: pageToLoad, pageSize: state.pageSize, search: state.search,
          tipo: state.tipo, status: state.status, formaPagamento: state.formaPagamento,
          categoriaId: state.categoriaId, dataInicio: state.dataInicio, dataFim: state.dataFim,
          orderBy: cfg.ordem || 'recentes',
          ...cfg.fixos,
        });
        if (requestToken !== token) return;
        state.page = pageToLoad;
        state.rows = reset ? rows : state.rows.concat(rows);
        state.total = total;
        render();
      } catch (err) {
        if (requestToken !== token) return;
        console.error(`[admin] Falha ao carregar ${cfg.titulo}.`, err);
        toast(`Não foi possível carregar ${cfg.titulo}.`, 'error');
      } finally {
        if (requestToken === token) btnMais.disabled = false;
      }
    }

    function render() {
      const tbody = el('tbody');
      const linhas = state.rows;
      if (!linhas.length) {
        tbody.innerHTML = `<tr><td colspan="${colunas.length + 1}"><div class="empty-state"><p>${escapeHtml(cfg.vazio)}</p></div></td></tr>`;
      } else {
        const podeExcluir = roleAtLeast('administrador');
        tbody.innerHTML = linhas.map(l => `
          <tr>
            ${colunas.map(c => c.td(l, cfg)).join('')}
            <td>
              <div class="actions">
                ${l.saldo > 0 && l.status !== 'cancelado' ? `<button class="btn-icon toggle" type="button" data-baixa="${l.id}" aria-label="Registrar baixa de ${escapeHtml(l.descricao)}">${ICON_CHECK}</button>` : ''}
                ${l.valorPago > 0 ? `<button class="btn-icon" type="button" data-reabrir="${l.id}" data-label="${escapeHtml(l.descricao)}" aria-label="Reabrir ${escapeHtml(l.descricao)}">${ICON_UNDO}</button>` : ''}
                <button class="btn-icon edit" type="button" data-fin-edit="${l.id}" aria-label="Editar ${escapeHtml(l.descricao)}">${ICON_EDIT}</button>
                ${podeExcluir ? `<button class="btn-icon del" type="button" data-fin-del="${l.id}" data-label="${escapeHtml(l.descricao)}" aria-label="Excluir ${escapeHtml(l.descricao)}">${ICON_DEL}</button>` : ''}
              </div>
            </td>
          </tr>`).join('');
        tbody.querySelectorAll('[data-fin-edit]').forEach(b => b.addEventListener('click', () => openLancamentoModal(b.dataset.finEdit, b)));
        tbody.querySelectorAll('[data-fin-del]').forEach(b => b.addEventListener('click', () => confirmDelete('lancamento', b.dataset.finDel, b.dataset.label, b)));
        tbody.querySelectorAll('[data-baixa]').forEach(b => b.addEventListener('click', () => openBaixaModal(b.dataset.baixa, b)));
        tbody.querySelectorAll('[data-reabrir]').forEach(b => b.addEventListener('click', () => reabrirLancamento(b.dataset.reabrir, b.dataset.label)));
      }
      el('count').textContent = linhas.length ? `Mostrando ${linhas.length} de ${state.total}` : '';
      el('more').hidden = linhas.length >= state.total;
    }

    return { load, render, state, cfg };
  }

  /** Abre (criando na primeira vez) a visão financeira de uma página. */
  async function abrirFinView(key) {
    await carregarCategoriasFinanceiras();
    if (!finViews[key]) finViews[key] = criarFinView(key, FIN_VIEWS[key]);
    finViewAtiva = key;
    finViews[key].load(true);
  }

  /** Recarrega a visão financeira aberta no momento — usada depois de
   * salvar, dar baixa ou excluir. O dashboard não precisa ser atualizado
   * aqui: ele já recarrega sozinho toda vez que é aberto pelo menu. */
  async function recarregarFinViewAtiva() {
    const view = finViewAtiva && finViews[finViewAtiva];
    if (view) await view.load(true);
  }

  async function reabrirLancamento(id, label) {
    try {
      await HM.reabrirLancamento(id);
      await recarregarFinViewAtiva();
      toast(`"${label}" reaberto — as baixas anteriores foram desfeitas.`, 'success');
    } catch (err) {
      console.error('[admin] Falha ao reabrir lançamento.', err);
      toast('Não foi possível reabrir este lançamento.', 'error');
    }
  }

  /* ── Modal de lançamento (criar/editar) ── */
  const lancamentoOverlay = document.getElementById('lancamentoModalOverlay');
  let finTipoAtual = 'entrada';

  document.getElementById('lancamentoModalCloseBtn').addEventListener('click', closeLancamentoModal);
  document.getElementById('lancamentoCancelBtn').addEventListener('click', closeLancamentoModal);
  document.getElementById('lancamentoSaveBtn').addEventListener('click', saveLancamento);
  lancamentoOverlay.addEventListener('click', e => { if (e.target === e.currentTarget) closeLancamentoModal(); });
  document.getElementById('lTipoEntradaBtn').addEventListener('click', () => setLancamentoTipo('entrada'));
  document.getElementById('lTipoSaidaBtn').addEventListener('click', () => setLancamentoTipo('saida'));
  document.getElementById('lCategoria').addEventListener('change', e => populateLancamentoSubcategoriaSelect(e.target.value));

  function setLancamentoTipo(tipo) {
    finTipoAtual = tipo;
    document.getElementById('lTipoEntradaBtn').classList.toggle('active', tipo === 'entrada');
    document.getElementById('lTipoEntradaBtn').setAttribute('aria-pressed', String(tipo === 'entrada'));
    document.getElementById('lTipoSaidaBtn').classList.toggle('active', tipo === 'saida');
    document.getElementById('lTipoSaidaBtn').setAttribute('aria-pressed', String(tipo === 'saida'));
    // Entrada vem de um cliente, saída vai para um fornecedor — o mesmo
    // campo troca de papel conforme o tipo, em vez de exibir os dois.
    document.getElementById('lPessoaLabel').textContent = tipo === 'entrada' ? 'Cliente' : 'Fornecedor';
    document.getElementById('lPessoa').placeholder = tipo === 'entrada' ? 'Nome do cliente (opcional)' : 'Nome do fornecedor (opcional)';
    atualizarSugestoesPessoa();
    populateLancamentoCategoriaSelect();
  }

  /** Preenche o datalist do campo cliente/fornecedor. Como o cadastro é
   * criado sob demanda ao salvar (igual à marca de um veículo), a lista é
   * só uma sugestão — o gestor pode digitar um nome novo. */
  async function atualizarSugestoesPessoa() {
    const dl = document.getElementById('lPessoaLista');
    try {
      const pessoas = finTipoAtual === 'entrada' ? await HM.getClientes() : await HM.getFornecedores();
      dl.innerHTML = pessoas.map(p => `<option value="${escapeHtml(p.nome)}"></option>`).join('');
    } catch (err) {
      console.error('[admin] Falha ao carregar sugestões de cliente/fornecedor.', err);
      dl.innerHTML = '';
    }
  }

  /** Procura um lançamento entre os já carregados em qualquer visão aberta,
   * evitando uma ida ao servidor quando a linha veio da tabela. */
  function acharLancamentoCarregado(id) {
    for (const view of Object.values(finViews)) {
      const encontrado = view.state.rows.find(x => x.id === id);
      if (encontrado) return encontrado;
    }
    return null;
  }

  function populateLancamentoCategoriaSelect(categoriaIdSelecionada, subcategoriaIdSelecionada) {
    const lista = finTipoAtual === 'entrada' ? finCategoriasEntrada : finCategoriasSaida;
    const raizes = lista.filter(c => !c.categoria_pai_id).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const catSel = document.getElementById('lCategoria');
    catSel.innerHTML = '<option value="">Sem categoria</option>' + raizes.map(c => `<option value="${c.id}" ${c.id === categoriaIdSelecionada ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('');
    populateLancamentoSubcategoriaSelect(catSel.value, subcategoriaIdSelecionada);
  }

  function populateLancamentoSubcategoriaSelect(categoriaId, subcategoriaIdSelecionada) {
    const lista = finTipoAtual === 'entrada' ? finCategoriasEntrada : finCategoriasSaida;
    const subs = lista.filter(c => c.categoria_pai_id === categoriaId).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const subSel = document.getElementById('lSubcategoria');
    subSel.innerHTML = '<option value="">Nenhuma</option>' + subs.map(c => `<option value="${c.id}" ${c.id === subcategoriaIdSelecionada ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('');
    subSel.closest('.field').hidden = subs.length === 0;
  }

  /** `padroes` vem da visão que abriu o modal (Contas a Pagar já começa
   * como saída pendente, Receitas como entrada paga, e assim por diante),
   * pra ninguém precisar reconfigurar o óbvio a cada lançamento. */
  async function openLancamentoModal(id, triggerEl, padroes = {}) {
    await carregarCategoriasFinanceiras();
    lastFocusedEl = triggerEl || document.activeElement;
    document.getElementById('lancamentoFormError').textContent = '';
    document.getElementById('lValorPagoHint').hidden = true;
    document.getElementById('lHistoricoWrap').hidden = true;

    ['lId', 'lUpdatedAt', 'lNumeroDocumento', 'lObservacoes', 'lValor', 'lDataVencimento', 'lFormaPagamento', 'lPessoa', 'lCentroCusto'].forEach(f => { document.getElementById(f).value = ''; });
    document.getElementById('lDataLancamento').value = new Date().toISOString().slice(0, 10);
    document.getElementById('lStatus').value = padroes.status || 'pendente';
    document.getElementById('lOrigem').value = 'manual';
    document.getElementById('lDescricao').value = '';
    setLancamentoTipo(padroes.tipo || 'entrada');
    document.getElementById('lancamentoModalTitle').textContent = id ? 'Editar Lançamento' : 'Novo Lançamento';

    if (id) {
      const l = acharLancamentoCarregado(id) || await HM.getLancamentoById(id);
      if (!l) return;
      document.getElementById('lId').value = l.id;
      document.getElementById('lUpdatedAt').value = l.updatedAt || '';
      document.getElementById('lDescricao').value = l.descricao;
      document.getElementById('lValor').value = HM.formatPrice(l.valor);
      document.getElementById('lDataLancamento').value = l.dataLancamento || '';
      document.getElementById('lDataVencimento').value = l.dataVencimento || '';
      document.getElementById('lFormaPagamento').value = l.formaPagamento || '';
      document.getElementById('lStatus').value = l.status;
      document.getElementById('lOrigem').value = l.origem;
      document.getElementById('lNumeroDocumento').value = l.numeroDocumento || '';
      document.getElementById('lCentroCusto').value = l.centroCusto || '';
      document.getElementById('lObservacoes').value = l.observacoes || '';
      setLancamentoTipo(l.tipo);
      document.getElementById('lPessoa').value = (l.tipo === 'entrada' ? l.clienteNome : l.fornecedorNome) || '';
      populateLancamentoCategoriaSelect(l.categoriaId, l.subcategoriaId);
      if (l.valorPago > 0 && l.valorPago < l.valor) {
        const hint = document.getElementById('lValorPagoHint');
        hint.hidden = false;
        hint.textContent = `Já foi baixado ${HM.formatPrice(l.valorPago)} deste lançamento (saldo em aberto: ${HM.formatPrice(l.saldo)}). Para registrar mais uma baixa, use o botão ✓ na lista em vez de mexer no valor aqui.`;
      }
      if (l.valorPago > 0) carregarHistoricoPagamentos(l.id);
    }
    openModal(lancamentoOverlay, document.getElementById('lDescricao'));
  }
  function closeLancamentoModal() { closeModalEl(lancamentoOverlay); }

  async function carregarHistoricoPagamentos(lancamentoId) {
    const wrap = document.getElementById('lHistoricoWrap');
    const lista = document.getElementById('lHistoricoList');
    wrap.hidden = false;
    lista.innerHTML = '<li class="log-empty">Carregando…</li>';
    try {
      const pagamentos = await HM.getPagamentosLancamento(lancamentoId);
      lista.innerHTML = pagamentos.length
        ? pagamentos.map(p => `
          <li>
            <strong>${HM.formatPrice(p.valor)}</strong>
            ${p.formaPagamento ? `· ${escapeHtml(FIN_FORMA_LABELS[p.formaPagamento] || p.formaPagamento)}` : ''}
            <span style="float:right;color:var(--gray)">${HM.formatDateBR(p.dataPagamento)}</span>
            ${p.observacoes ? `<div class="td-sub">${escapeHtml(p.observacoes)}</div>` : ''}
          </li>`).join('')
        : '<li class="log-empty">Nenhuma baixa registrada ainda.</li>';
    } catch (err) {
      console.error('[admin] Falha ao carregar histórico de pagamentos.', err);
      lista.innerHTML = '<li class="log-empty">Não foi possível carregar o histórico.</li>';
    }
  }

  async function saveLancamento() {
    const descricao = document.getElementById('lDescricao').value.trim();
    const valorStr = document.getElementById('lValor').value.trim();
    const errEl = document.getElementById('lancamentoFormError');
    if (!descricao || !valorStr) { errEl.textContent = 'Preencha a descrição e o valor.'; return; }
    if (HM.parsePrice(valorStr) <= 0) { errEl.textContent = 'Informe um valor maior que zero.'; return; }
    errEl.textContent = '';

    const editId = document.getElementById('lId').value;
    const status = document.getElementById('lStatus').value;
    const saveBtn = document.getElementById('lancamentoSaveBtn');
    saveBtn.disabled = true;
    try {
      // Cliente/fornecedor é criado sob demanda a partir do nome digitado,
      // do mesmo jeito que a marca de um veículo — sem cadastro prévio.
      const nomePessoa = document.getElementById('lPessoa').value.trim();
      const pessoaId = nomePessoa
        ? await (finTipoAtual === 'entrada' ? HM.ensureCliente(nomePessoa) : HM.ensureFornecedor(nomePessoa))
        : null;

      const data = {
        tipo: finTipoAtual,
        descricao,
        valor: HM.parsePrice(valorStr),
        categoriaId: document.getElementById('lCategoria').value || null,
        subcategoriaId: document.getElementById('lSubcategoria').value || null,
        dataLancamento: document.getElementById('lDataLancamento').value || null,
        dataVencimento: document.getElementById('lDataVencimento').value || null,
        dataPagamento: document.getElementById('lDataLancamento').value || null,
        formaPagamento: document.getElementById('lFormaPagamento').value || null,
        status,
        origem: document.getElementById('lOrigem').value,
        clienteId: finTipoAtual === 'entrada' ? pessoaId : null,
        fornecedorId: finTipoAtual === 'saida' ? pessoaId : null,
        numeroDocumento: document.getElementById('lNumeroDocumento').value.trim(),
        centroCusto: document.getElementById('lCentroCusto').value.trim(),
        observacoes: document.getElementById('lObservacoes').value.trim(),
      };

      if (editId) {
        data.expectedUpdatedAt = document.getElementById('lUpdatedAt').value || null;
        await HM.updateLancamento(editId, data);
        toast('Lançamento atualizado!', 'success');
      } else {
        await HM.createLancamento(data);
        toast('Lançamento registrado!', 'success');
      }
      await recarregarFinViewAtiva();
      closeLancamentoModal();
    } catch (err) {
      console.error('[admin] Falha ao salvar lançamento.', err);
      errEl.textContent = (err instanceof HM.ConcurrencyError) ? err.message : 'Não foi possível salvar o lançamento. Tente novamente.';
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ── Modal de baixa (recebimento/pagamento parcial ou total) ── */
  const baixaOverlay = document.getElementById('baixaModalOverlay');
  let baixaLancamentoId = null;
  let baixaSaldoAtual = 0;

  document.getElementById('baixaCancelBtn').addEventListener('click', closeBaixaModal);
  document.getElementById('baixaConfirmBtn').addEventListener('click', confirmBaixa);
  baixaOverlay.addEventListener('click', e => { if (e.target === e.currentTarget) closeBaixaModal(); });

  function openBaixaModal(id, triggerEl) {
    const l = acharLancamentoCarregado(id);
    if (!l) return;
    baixaLancamentoId = id;
    baixaSaldoAtual = l.saldo;
    lastFocusedEl = triggerEl || document.activeElement;
    document.getElementById('baixaModalTitle').textContent = l.tipo === 'entrada' ? 'Registrar recebimento' : 'Registrar pagamento';
    document.getElementById('baixaModalSaldo').textContent = `${escapeHtml(l.descricao)} — em aberto ${HM.formatPrice(l.saldo)} de ${HM.formatPrice(l.valor)}`;
    document.getElementById('baixaValor').value = HM.formatPrice(l.saldo);
    document.getElementById('baixaData').value = new Date().toISOString().slice(0, 10);
    document.getElementById('baixaForma').value = l.formaPagamento || '';
    document.getElementById('baixaObs').value = '';
    document.getElementById('baixaFormError').textContent = '';
    openModal(baixaOverlay, document.getElementById('baixaValor'));
  }
  function closeBaixaModal() { closeModalEl(baixaOverlay); baixaLancamentoId = null; baixaSaldoAtual = 0; }

  async function confirmBaixa() {
    const errEl = document.getElementById('baixaFormError');
    const valor = HM.parsePrice(document.getElementById('baixaValor').value);
    if (valor <= 0) { errEl.textContent = 'Informe um valor maior que zero.'; return; }
    if (valor > baixaSaldoAtual) {
      errEl.textContent = `O valor não pode passar do saldo em aberto (${HM.formatPrice(baixaSaldoAtual)}).`;
      return;
    }
    const btn = document.getElementById('baixaConfirmBtn');
    btn.disabled = true;
    try {
      await HM.registrarPagamento(baixaLancamentoId, valor, {
        dataPagamento: document.getElementById('baixaData').value || null,
        formaPagamento: document.getElementById('baixaForma').value || null,
        observacoes: document.getElementById('baixaObs').value.trim() || null,
      });
      await recarregarFinViewAtiva();
      closeBaixaModal();
      toast('Baixa registrada!', 'success');
    } catch (err) {
      console.error('[admin] Falha ao registrar baixa.', err);
      errEl.textContent = 'Não foi possível registrar essa baixa. Tente novamente.';
    } finally {
      btn.disabled = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   * COMISSÕES
   * ------------------------------------------------------------------------
   * Única página do Financeiro que o vendedor enxerga — e só com as
   * comissões dele (garantido pela RLS, não só escondendo botão). Criar,
   * editar, pagar e configurar continuam restritos a gerente/administrador.
   * ════════════════════════════════════════════════════════════════════ */

  let comissaoState = { page: 0, pageSize: 25, search: '', vendedorId: '', status: '', dataInicio: '', dataFim: '', rows: [], total: 0 };
  let comissaoRequestToken = 0;
  let comissaoSearchDebounce;
  let vendedoresCache = [];

  const COMISSAO_STATUS_BADGE = {
    paga: '<span class="badge badge-ativo">Paga</span>',
    pendente: '<span class="badge badge-negociando">Pendente</span>',
    cancelada: '<span class="badge badge-inativo">Cancelada</span>',
  };

  function podeGerirComissoes() { return roleAtLeast('gerente'); }

  document.getElementById('comSearch').addEventListener('input', e => {
    clearTimeout(comissaoSearchDebounce);
    const valor = e.target.value;
    comissaoSearchDebounce = setTimeout(() => { comissaoState.search = valor; loadComissoesPage(true); }, 250);
  });
  document.getElementById('comFilterVendedor').addEventListener('change', e => { comissaoState.vendedorId = e.target.value; loadComissoesPage(true); });
  document.getElementById('comFilterStatus').addEventListener('change', e => { comissaoState.status = e.target.value; loadComissoesPage(true); });
  document.getElementById('comFilterInicio').addEventListener('change', e => { comissaoState.dataInicio = e.target.value; loadComissoesPage(true); });
  document.getElementById('comFilterFim').addEventListener('change', e => { comissaoState.dataFim = e.target.value; loadComissoesPage(true); });
  document.getElementById('comissaoLoadMoreBtn').addEventListener('click', () => loadComissoesPage(false));

  async function abrirComissoes() {
    const gerir = podeGerirComissoes();
    document.getElementById('newComissaoBtn').hidden = !gerir;
    document.getElementById('comFilterVendedor').hidden = !gerir;
    document.getElementById('comissaoConfigWrap').hidden = !gerir;
    document.getElementById('comissaoHint').textContent = gerir
      ? 'Cada comissão pode ser um percentual sobre o valor da venda ou um valor fixo. Ao marcar como paga, o sistema gera automaticamente a despesa correspondente no fluxo de caixa.'
      : 'Estas são as suas comissões. Só gerentes e administradores podem criar, alterar ou pagar comissões.';

    if (gerir && !vendedoresCache.length) await carregarVendedores();
    await loadComissoesPage(true);
    if (gerir) renderConfigComissaoTable();
  }

  async function carregarVendedores() {
    try {
      vendedoresCache = await HM.getVendedores();
      const opcoes = vendedoresCache.map(v => `<option value="${v.id}">${escapeHtml(v.nome)}</option>`).join('');
      document.getElementById('comFilterVendedor').innerHTML = '<option value="">Todos os vendedores</option>' + opcoes;
      document.getElementById('kVendedor').innerHTML = opcoes;
    } catch (err) {
      console.error('[admin] Falha ao carregar vendedores.', err);
    }
  }

  async function loadComissoesPage(reset) {
    const requestToken = ++comissaoRequestToken;
    const pageToLoad = reset ? 0 : comissaoState.page + 1;
    const btn = document.getElementById('comissaoLoadMoreBtn');
    btn.disabled = true;
    try {
      const { rows, total } = await HM.getComissoes({
        page: pageToLoad, pageSize: comissaoState.pageSize, search: comissaoState.search,
        vendedorId: comissaoState.vendedorId, status: comissaoState.status,
        dataInicio: comissaoState.dataInicio, dataFim: comissaoState.dataFim,
      });
      if (requestToken !== comissaoRequestToken) return;
      comissaoState.page = pageToLoad;
      comissaoState.rows = reset ? rows : comissaoState.rows.concat(rows);
      comissaoState.total = total;
      renderComissoesTable();
    } catch (err) {
      if (requestToken !== comissaoRequestToken) return;
      console.error('[admin] Falha ao carregar comissões.', err);
      toast('Não foi possível carregar as comissões.', 'error');
    } finally {
      if (requestToken === comissaoRequestToken) btn.disabled = false;
    }
  }

  function renderComissoesTable() {
    const linhas = comissaoState.rows;
    const tbody = document.getElementById('comissaoTableBody');
    const gerir = podeGerirComissoes();

    if (!linhas.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>Nenhuma comissão encontrada.</p></div></td></tr>`;
    } else {
      const podeExcluir = roleAtLeast('administrador');
      tbody.innerHTML = linhas.map(c => `
        <tr>
          <td class="fin-td-nowrap">${HM.formatDateBR(c.dataReferencia)}</td>
          <td><div class="td-name">${escapeHtml(c.vendedorNome)}</div></td>
          <td>${escapeHtml(c.descricao)}</td>
          <td class="fin-td-muted">${c.tipoCalculo === 'percentual' ? `${c.percentual || 0}% de ${HM.formatPrice(c.valorBase)}` : 'Valor fixo'}</td>
          <td class="fin-td-valor">${HM.formatPrice(c.valor)}</td>
          <td>${COMISSAO_STATUS_BADGE[c.status] || c.status}</td>
          <td>
            <div class="actions">
              ${gerir && c.status === 'pendente' ? `<button class="btn-icon toggle" type="button" data-com-pagar="${c.id}" data-label="${escapeHtml(c.descricao)}" aria-label="Pagar comissão de ${escapeHtml(c.descricao)}">${ICON_CHECK}</button>` : ''}
              ${gerir ? `<button class="btn-icon edit" type="button" data-com-edit="${c.id}" aria-label="Editar ${escapeHtml(c.descricao)}">${ICON_EDIT}</button>` : ''}
              ${gerir && podeExcluir ? `<button class="btn-icon del" type="button" data-com-del="${c.id}" data-label="${escapeHtml(c.descricao)}" aria-label="Excluir ${escapeHtml(c.descricao)}">${ICON_DEL}</button>` : ''}
              ${!gerir ? '<span class="fin-td-muted">—</span>' : ''}
            </div>
          </td>
        </tr>`).join('');
      tbody.querySelectorAll('[data-com-edit]').forEach(b => b.addEventListener('click', () => openComissaoModal(b.dataset.comEdit, b)));
      tbody.querySelectorAll('[data-com-del]').forEach(b => b.addEventListener('click', () => confirmDelete('comissao', b.dataset.comDel, b.dataset.label, b)));
      tbody.querySelectorAll('[data-com-pagar]').forEach(b => b.addEventListener('click', () => pagarComissao(b.dataset.comPagar, b.dataset.label)));
    }

    const totais = linhas.reduce((acc, c) => {
      if (c.status === 'paga') acc.pagas += c.valor;
      else if (c.status === 'pendente') acc.pendentes += c.valor;
      return acc;
    }, { pagas: 0, pendentes: 0 });
    document.getElementById('comissaoResumo').innerHTML = `
      <div class="stat-card green"><div class="stat-card-label">Comissões pagas</div><div class="stat-card-val">${HM.formatPrice(totais.pagas)}</div><div class="stat-card-sub">nesta lista</div></div>
      <div class="stat-card yellow"><div class="stat-card-label">Comissões pendentes</div><div class="stat-card-val">${HM.formatPrice(totais.pendentes)}</div><div class="stat-card-sub">nesta lista</div></div>`;

    document.getElementById('comissaoListCount').textContent = linhas.length ? `Mostrando ${linhas.length} de ${comissaoState.total}` : '';
    document.getElementById('comissaoLoadMoreBtn').hidden = linhas.length >= comissaoState.total;
  }

  async function pagarComissao(id, label) {
    try {
      await HM.pagarComissao(id);
      await loadComissoesPage(true);
      toast(`Comissão "${label}" paga — a despesa foi lançada no fluxo de caixa.`, 'success');
    } catch (err) {
      console.error('[admin] Falha ao pagar comissão.', err);
      toast(err.message || 'Não foi possível pagar esta comissão.', 'error');
    }
  }

  /* ── Configuração de comissão por vendedor ── */
  function renderConfigComissaoTable() {
    const tbody = document.getElementById('comissaoConfigBody');
    if (!vendedoresCache.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>Nenhum usuário cadastrado.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = vendedoresCache.map(v => `
      <tr>
        <td><div class="td-name">${escapeHtml(v.nome)}</div><div class="td-sub">${escapeHtml(ROLE_LABELS[v.role] || v.role)}</div></td>
        <td>
          <select class="filter-select" data-cfg-tipo="${v.id}">
            <option value="percentual" ${v.comissaoTipo === 'percentual' ? 'selected' : ''}>Percentual</option>
            <option value="fixo" ${v.comissaoTipo === 'fixo' ? 'selected' : ''}>Valor fixo</option>
          </select>
        </td>
        <td><input class="search-input fin-input-curto" data-cfg-valor="${v.id}" value="${v.comissaoValor}" inputmode="decimal"></td>
        <td><input class="search-input fin-input-curto" data-cfg-meta="${v.id}" value="${v.metaMensal}" inputmode="decimal"></td>
        <td><button class="btn-secondary" type="button" data-cfg-salvar="${v.id}">Salvar</button></td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-cfg-salvar]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.cfgSalvar;
      btn.disabled = true;
      try {
        await HM.updateConfigComissao(id, {
          comissaoTipo: tbody.querySelector(`[data-cfg-tipo="${id}"]`).value,
          comissaoValor: Number(String(tbody.querySelector(`[data-cfg-valor="${id}"]`).value).replace(',', '.')) || 0,
          metaMensal: Number(String(tbody.querySelector(`[data-cfg-meta="${id}"]`).value).replace(',', '.')) || 0,
        });
        await carregarVendedores();
        toast('Configuração de comissão atualizada.', 'success');
      } catch (err) {
        console.error('[admin] Falha ao salvar configuração de comissão.', err);
        toast('Não foi possível salvar a configuração.', 'error');
      } finally {
        btn.disabled = false;
      }
    }));
  }

  /* ── Modal de comissão ── */
  const comissaoOverlay = document.getElementById('comissaoModalOverlay');

  document.getElementById('newComissaoBtn').addEventListener('click', e => openComissaoModal(null, e.currentTarget));
  document.getElementById('comissaoModalCloseBtn').addEventListener('click', closeComissaoModal);
  document.getElementById('comissaoCancelBtn').addEventListener('click', closeComissaoModal);
  document.getElementById('comissaoSaveBtn').addEventListener('click', saveComissao);
  comissaoOverlay.addEventListener('click', e => { if (e.target === e.currentTarget) closeComissaoModal(); });
  ['kTipoCalculo', 'kValorBase', 'kPercentual', 'kValorFixo'].forEach(id => {
    document.getElementById(id).addEventListener('input', atualizarPreviaComissao);
    document.getElementById(id).addEventListener('change', atualizarPreviaComissao);
  });
  document.getElementById('kVendedor').addEventListener('change', aplicarPadraoDoVendedor);

  function valoresComissaoDoFormulario() {
    return {
      tipoCalculo: document.getElementById('kTipoCalculo').value,
      valorBase: HM.parsePrice(document.getElementById('kValorBase').value),
      percentual: Number(document.getElementById('kPercentual').value) || 0,
      valorFixo: HM.parsePrice(document.getElementById('kValorFixo').value),
    };
  }

  /** Mostra o valor final antes de salvar, calculado pela mesma função que o
   * salvamento usa — o que aparece na prévia é exatamente o que é gravado. */
  function atualizarPreviaComissao() {
    const dados = valoresComissaoDoFormulario();
    const ehPercentual = dados.tipoCalculo === 'percentual';
    document.getElementById('kBaseField').hidden = !ehPercentual;
    document.getElementById('kPercentualField').hidden = !ehPercentual;
    document.getElementById('kValorFixoField').hidden = ehPercentual;
    document.getElementById('kPrevia').textContent = `Comissão: ${HM.formatPrice(HM.calcularComissao(dados))}`;
  }

  /** Ao escolher o vendedor, já traz a configuração padrão dele (percentual
   * ou valor fixo) em vez de obrigar a redigitar a cada comissão. */
  function aplicarPadraoDoVendedor() {
    if (document.getElementById('kId').value) return;
    const vendedor = vendedoresCache.find(v => v.id === document.getElementById('kVendedor').value);
    if (!vendedor) return;
    document.getElementById('kTipoCalculo').value = vendedor.comissaoTipo;
    if (vendedor.comissaoTipo === 'percentual') document.getElementById('kPercentual').value = vendedor.comissaoValor;
    else document.getElementById('kValorFixo').value = HM.formatPrice(vendedor.comissaoValor);
    atualizarPreviaComissao();
  }

  async function carregarVeiculosParaComissao(selecionadoId) {
    const sel = document.getElementById('kVeiculo');
    try {
      const { rows } = await HM.getVehicles({ page: 0, pageSize: 100, orderBy: 'recentes' });
      sel.innerHTML = '<option value="">Nenhum</option>' + rows.map(v =>
        `<option value="${v.id}" ${v.id === selecionadoId ? 'selected' : ''}>${escapeHtml(`${v.make} ${v.model} ${v.year}`)}</option>`).join('');
    } catch (err) {
      console.error('[admin] Falha ao carregar veículos para a comissão.', err);
      sel.innerHTML = '<option value="">Nenhum</option>';
    }
  }

  async function openComissaoModal(id, triggerEl) {
    if (!vendedoresCache.length) await carregarVendedores();
    lastFocusedEl = triggerEl || document.activeElement;
    document.getElementById('comissaoFormError').textContent = '';
    document.getElementById('kPagaHint').hidden = true;
    document.getElementById('comissaoSaveBtn').disabled = false;

    ['kId', 'kUpdatedAt', 'kDescricao', 'kValorBase', 'kPercentual', 'kValorFixo', 'kObservacoes'].forEach(f => { document.getElementById(f).value = ''; });
    document.getElementById('kDataReferencia').value = new Date().toISOString().slice(0, 10);
    document.getElementById('kTipoCalculo').value = 'percentual';
    document.getElementById('kStatus').value = 'pendente';
    document.getElementById('comissaoModalTitle').textContent = id ? 'Editar Comissão' : 'Nova Comissão';

    const comissao = id ? comissaoState.rows.find(c => c.id === id) : null;
    if (id && !comissao) {
      // Sem a linha em memória não dá pra preencher o formulário — melhor
      // avisar do que abrir um "editar" que na prática criaria outra comissão.
      toast('Não foi possível abrir esta comissão. Recarregue a lista.', 'error');
      return;
    }
    await carregarVeiculosParaComissao(comissao?.veiculoId);

    if (comissao) {
      document.getElementById('kId').value = comissao.id;
      document.getElementById('kUpdatedAt').value = comissao.updatedAt || '';
      document.getElementById('kVendedor').value = comissao.vendedorId;
      document.getElementById('kDescricao').value = comissao.descricao;
      document.getElementById('kDataReferencia').value = comissao.dataReferencia || '';
      document.getElementById('kTipoCalculo').value = comissao.tipoCalculo;
      document.getElementById('kValorBase').value = HM.formatPrice(comissao.valorBase);
      document.getElementById('kPercentual').value = comissao.percentual ?? '';
      if (comissao.tipoCalculo === 'fixo') document.getElementById('kValorFixo').value = HM.formatPrice(comissao.valor);
      document.getElementById('kObservacoes').value = comissao.observacoes || '';
      document.getElementById('kStatus').value = comissao.status === 'paga' ? 'pendente' : comissao.status;
      if (comissao.status === 'paga') {
        // Alterar uma comissão paga desencontraria o valor dela do lançamento
        // já gerado no fluxo de caixa — o caminho certo é excluir e refazer.
        const hint = document.getElementById('kPagaHint');
        hint.hidden = false;
        hint.textContent = 'Esta comissão já foi paga e gerou uma despesa no fluxo de caixa, por isso não pode mais ser editada.';
        document.getElementById('comissaoSaveBtn').disabled = true;
      }
    } else {
      aplicarPadraoDoVendedor();
    }
    atualizarPreviaComissao();
    openModal(comissaoOverlay, document.getElementById('kDescricao'));
  }
  function closeComissaoModal() { closeModalEl(comissaoOverlay); }

  async function saveComissao() {
    const errEl = document.getElementById('comissaoFormError');
    const vendedorId = document.getElementById('kVendedor').value;
    const descricao = document.getElementById('kDescricao').value.trim();
    if (!vendedorId || !descricao) { errEl.textContent = 'Escolha o vendedor e informe a descrição.'; return; }

    const dados = valoresComissaoDoFormulario();
    const valor = HM.calcularComissao(dados);
    if (valor <= 0) { errEl.textContent = 'A comissão calculada precisa ser maior que zero.'; return; }
    errEl.textContent = '';

    const editId = document.getElementById('kId').value;
    const payload = {
      vendedorId,
      descricao,
      valorBase: dados.tipoCalculo === 'percentual' ? dados.valorBase : 0,
      tipoCalculo: dados.tipoCalculo,
      percentual: dados.percentual,
      valor,
      status: document.getElementById('kStatus').value,
      dataReferencia: document.getElementById('kDataReferencia').value || null,
      veiculoId: document.getElementById('kVeiculo').value || null,
      observacoes: document.getElementById('kObservacoes').value.trim(),
    };

    const saveBtn = document.getElementById('comissaoSaveBtn');
    saveBtn.disabled = true;
    try {
      if (editId) {
        payload.expectedUpdatedAt = document.getElementById('kUpdatedAt').value || null;
        await HM.updateComissao(editId, payload);
        toast('Comissão atualizada!', 'success');
      } else {
        await HM.createComissao(payload);
        toast('Comissão registrada!', 'success');
      }
      await loadComissoesPage(true);
      closeComissaoModal();
    } catch (err) {
      console.error('[admin] Falha ao salvar comissão.', err);
      errEl.textContent = (err instanceof HM.ConcurrencyError) ? err.message : 'Não foi possível salvar a comissão. Tente novamente.';
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   * RELATÓRIOS
   * ------------------------------------------------------------------------
   * Todos os relatórios chegam do banco no mesmo formato
   * {titulo, colunas, linhas, resumo}, então a tela e os três exportadores
   * são genéricos — nada aqui sabe qual relatório está sendo mostrado.
   * ════════════════════════════════════════════════════════════════════ */

  let relatorioAtual = null;

  /** Colunas cujo conteúdo numérico representa dinheiro. Sem isso, uma
   * contagem ("3 lançamentos") sairia formatada como "R$ 3,00". */
  const REL_COLUNA_MOEDA = /^(valor|pago|em aberto|base|receitas|despesas|lucro|total.*|preço)$/i;
  /** Números que não levam separador de milhar — "Ano" viraria "2.023". */
  const REL_COLUNA_CRUA = /^(ano)$/i;

  function relFormatarCelula(valor, coluna) {
    if (valor === null || valor === undefined) return '—';
    if (typeof valor === 'number') {
      if (REL_COLUNA_CRUA.test(coluna)) return String(valor);
      return REL_COLUNA_MOEDA.test(coluna)
        ? valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : valor.toLocaleString('pt-BR');
    }
    return String(valor);
  }

  document.getElementById('relGerarBtn').addEventListener('click', gerarRelatorio);

  async function gerarRelatorio() {
    const btn = document.getElementById('relGerarBtn');
    const tipo = document.getElementById('relTipo').value;
    const inicio = document.getElementById('relInicio').value || null;
    const fim = document.getElementById('relFim').value || null;
    if (inicio && fim && inicio > fim) {
      toast('A data inicial não pode ser depois da data final.', 'error');
      return;
    }
    btn.disabled = true;
    try {
      relatorioAtual = await HM.getRelatorio(tipo, inicio, fim);
      renderRelatorio();
    } catch (err) {
      console.error('[admin] Falha ao gerar relatório.', err);
      toast('Não foi possível gerar o relatório.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function renderRelatorio() {
    const { colunas, linhas, resumo } = relatorioAtual;
    document.getElementById('relThead').innerHTML = colunas.map(c => `<th scope="col">${escapeHtml(c)}</th>`).join('');
    document.getElementById('relTbody').innerHTML = linhas.length
      ? linhas.map(linha => `<tr>${linha.map((celula, i) => `<td>${escapeHtml(relFormatarCelula(celula, colunas[i]))}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${colunas.length}"><div class="empty-state"><p>Nenhum dado no período selecionado.</p></div></td></tr>`;

    const cards = Object.entries(resumo || {}).filter(([chave]) => chave !== 'Aviso');
    document.getElementById('relResumo').innerHTML = cards.map(([rotulo, valor]) => `
      <div class="stat-card blue">
        <div class="stat-card-label">${escapeHtml(rotulo)}</div>
        <div class="stat-card-val">${escapeHtml(relFormatarCelula(valor, rotulo))}</div>
      </div>`).join('');

    document.getElementById('relInfo').textContent = resumo?.Aviso
      ? resumo.Aviso
      : `${linhas.length} linha(s) — ${relatorioAtual.titulo}`;
    document.getElementById('relExport').hidden = !linhas.length;
  }

  function relNomeArquivo(extensao) {
    const base = (relatorioAtual?.titulo || 'relatorio').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
    return `holanda-motors-${base}-${new Date().toISOString().slice(0, 10)}.${extensao}`;
  }

  function baixarArquivo(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Carrega uma biblioteca de exportação só quando ela é usada de fato —
   * quem nunca exporta Excel/PDF não paga o download. */
  function carregarScriptExterno(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-lib="${src}"]`)) return resolve();
      const tag = document.createElement('script');
      tag.src = src;
      tag.dataset.lib = src;
      tag.onload = () => resolve();
      tag.onerror = () => reject(new Error(`Não foi possível carregar ${src}`));
      document.head.appendChild(tag);
    });
  }

  document.getElementById('relCsvBtn').addEventListener('click', () => {
    if (!relatorioAtual) return;
    // Ponto e vírgula e vírgula decimal: é o que o Excel em português abre
    // direto, sem passar pelo assistente de importação. O BOM no início
    // preserva os acentos.
    const escapar = (valor) => {
      const texto = valor === null || valor === undefined ? ''
        : typeof valor === 'number' ? String(valor).replace('.', ',')
        : String(valor);
      return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
    };
    const linhas = [relatorioAtual.colunas, ...relatorioAtual.linhas];
    const csv = '﻿' + linhas.map(l => l.map(escapar).join(';')).join('\r\n');
    baixarArquivo(new Blob([csv], { type: 'text/csv;charset=utf-8' }), relNomeArquivo('csv'));
    toast('CSV gerado — confira sua pasta de downloads.', 'success');
  });

  document.getElementById('relXlsxBtn').addEventListener('click', async () => {
    if (!relatorioAtual) return;
    const btn = document.getElementById('relXlsxBtn');
    btn.disabled = true;
    try {
      await carregarScriptExterno('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
      const planilha = XLSX.utils.aoa_to_sheet([relatorioAtual.colunas, ...relatorioAtual.linhas]);
      const pasta = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(pasta, planilha, 'Relatório');
      XLSX.writeFile(pasta, relNomeArquivo('xlsx'));
      toast('Excel gerado — confira sua pasta de downloads.', 'success');
    } catch (err) {
      console.error('[admin] Falha ao gerar Excel.', err);
      toast('Não foi possível gerar o Excel. Verifique sua conexão.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('relPdfBtn').addEventListener('click', async () => {
    if (!relatorioAtual) return;
    const btn = document.getElementById('relPdfBtn');
    btn.disabled = true;
    try {
      await carregarScriptExterno('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
      await carregarScriptExterno('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js');
      const doc = new window.jspdf.jsPDF({ orientation: relatorioAtual.colunas.length > 5 ? 'landscape' : 'portrait' });
      const periodo = [document.getElementById('relInicio').value, document.getElementById('relFim').value]
        .filter(Boolean).map(HM.formatDateBR).join(' a ');

      doc.setFontSize(14);
      doc.text(`Holanda Motors — ${relatorioAtual.titulo}`, 14, 16);
      doc.setFontSize(9);
      doc.text(periodo ? `Período: ${periodo}` : 'Período: todos os registros', 14, 22);

      doc.autoTable({
        startY: 27,
        head: [relatorioAtual.colunas],
        body: relatorioAtual.linhas.map(l => l.map((celula, i) => relFormatarCelula(celula, relatorioAtual.colunas[i]))),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [200, 16, 46] },
      });
      doc.save(relNomeArquivo('pdf'));
      toast('PDF gerado — confira sua pasta de downloads.', 'success');
    } catch (err) {
      console.error('[admin] Falha ao gerar PDF.', err);
      toast('Não foi possível gerar o PDF. Verifique sua conexão.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

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
        await loadVehiclePage(true);
        toast('Veículo excluído.', 'success');
      } else if (type === 'consig') {
        await HM.deleteConsig(id);
        await loadConsigPage(true);
        toast('Consignação excluída.', 'success');
      } else if (type === 'lancamento') {
        await HM.deleteLancamento(id);
        await recarregarFinViewAtiva();
        toast('Lançamento excluído.', 'success');
      } else if (type === 'comissao') {
        await HM.deleteComissao(id);
        await loadComissoesPage(true);
        toast('Comissão excluída.', 'success');
      }
      if (type === 'vehicle' || type === 'consig') await renderDashboard();
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
    document.getElementById('cfg-parcelamento-ativo').checked = !!cfg.parcelamentoAtivo;
    document.getElementById('cfg-parcelamento-juros').value = cfg.parcelamentoJuros;
    document.getElementById('cfg-parcelamento-entrada').value = cfg.parcelamentoEntrada;
    document.getElementById('cfg-parcelamento-max').value = cfg.parcelamentoMaxParcelas;
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
      parcelamentoAtivo: document.getElementById('cfg-parcelamento-ativo').checked,
      parcelamentoJuros: Number(document.getElementById('cfg-parcelamento-juros').value) || 0,
      parcelamentoEntrada: Number(document.getElementById('cfg-parcelamento-entrada').value) || 0,
      parcelamentoMaxParcelas: Math.round(Number(document.getElementById('cfg-parcelamento-max').value)) || 1,
    };
    if (cfg.parcelamentoEntrada < 0 || cfg.parcelamentoEntrada > 100) {
      toast('A entrada padrão do simulador precisa ficar entre 0 e 100%.', 'error');
      return;
    }
    if (cfg.parcelamentoMaxParcelas < 1 || cfg.parcelamentoMaxParcelas > 120) {
      toast('O máximo de parcelas do simulador precisa ficar entre 1 e 120.', 'error');
      return;
    }
    try {
      await HM.saveConfig(cfg);
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

  /* ── BACKUP E RESTAURAÇÃO ── */
  document.getElementById('backupExportBtn').addEventListener('click', async () => {
    const btn = document.getElementById('backupExportBtn');
    btn.disabled = true;
    try {
      const backup = await HM.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `holanda-motors-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Backup gerado — confira sua pasta de downloads.', 'success');
    } catch (err) {
      console.error('[admin] Falha ao gerar backup.', err);
      toast('Não foi possível gerar o backup.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('backupRestoreBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('backupFileInput');
    const logEl = document.getElementById('backupLog');
    const file = fileInput.files[0];
    if (!file) { toast('Selecione um arquivo de backup primeiro.', 'error'); return; }
    const btn = document.getElementById('backupRestoreBtn');
    btn.disabled = true;
    logEl.innerHTML = '';
    try {
      const backup = JSON.parse(await file.text());
      await HM.restoreBackup(backup, (msg) => {
        const li = document.createElement('li');
        li.textContent = msg;
        li.className = msg.startsWith('✓') ? 'log-ok' : 'log-err';
        logEl.appendChild(li);
      });
      toast('Restauração concluída — confira o resultado de cada item abaixo.', 'success');
      await Promise.all([loadVehiclePage(true), loadConsigPage(true), renderDashboard(), loadConfigForm()]);
    } catch (err) {
      console.error('[admin] Falha ao restaurar backup.', err);
      toast('Arquivo de backup inválido ou corrompido.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  /* ── BACKUP FINANCEIRO (arquivo separado do backup do estoque) ── */
  document.getElementById('backupFinExportBtn').addEventListener('click', async () => {
    const btn = document.getElementById('backupFinExportBtn');
    btn.disabled = true;
    try {
      const backup = await HM.exportBackupFinanceiro();
      baixarArquivo(
        new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
        `holanda-motors-financeiro-${new Date().toISOString().slice(0, 10)}.json`
      );
      toast('Backup financeiro gerado — confira sua pasta de downloads.', 'success');
    } catch (err) {
      console.error('[admin] Falha ao gerar backup financeiro.', err);
      toast('Não foi possível gerar o backup financeiro.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('backupFinRestoreBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('backupFinFileInput');
    const logEl = document.getElementById('backupFinLog');
    const file = fileInput.files[0];
    if (!file) { toast('Selecione um arquivo de backup financeiro primeiro.', 'error'); return; }
    const btn = document.getElementById('backupFinRestoreBtn');
    btn.disabled = true;
    logEl.innerHTML = '';
    try {
      const backup = JSON.parse(await file.text());
      await HM.restoreBackupFinanceiro(backup, (msg) => {
        const li = document.createElement('li');
        li.textContent = msg;
        li.className = msg.startsWith('✓') ? 'log-ok' : msg.startsWith('✗') ? 'log-err' : '';
        logEl.appendChild(li);
      });
      toast('Restauração financeira concluída — confira o resultado de cada etapa abaixo.', 'success');
      await recarregarFinViewAtiva();
    } catch (err) {
      console.error('[admin] Falha ao restaurar backup financeiro.', err);
      toast(err.message || 'Arquivo de backup financeiro inválido ou corrompido.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  /* ── USUÁRIOS (níveis de acesso) ── */
  async function renderUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = `<tr><td colspan="4">Carregando…</td></tr>`;
    try {
      const users = await HM.getUsers();
      tbody.innerHTML = users.map(u => `
        <tr>
          <td>${escapeHtml(u.nome || '—')}</td>
          <td>${escapeHtml(u.email || '—')}</td>
          <td>
            <select class="filter-select" data-role-select="${u.id}" ${u.id === currentUserId ? 'disabled' : ''}>
              <option value="vendedor" ${u.role === 'vendedor' ? 'selected' : ''}>Vendedor</option>
              <option value="gerente" ${u.role === 'gerente' ? 'selected' : ''}>Gerente</option>
              <option value="administrador" ${u.role === 'administrador' ? 'selected' : ''}>Administrador</option>
            </select>
          </td>
          <td>${u.id === currentUserId ? '<span style="color:var(--gray);font-size:12px">Você</span>' : `<button class="btn-secondary" type="button" data-save-role="${u.id}">Salvar</button>`}</td>
        </tr>
      `).join('');
      tbody.querySelectorAll('[data-save-role]').forEach(btn => btn.addEventListener('click', async () => {
        const id = btn.dataset.saveRole;
        const select = tbody.querySelector(`[data-role-select="${id}"]`);
        btn.disabled = true;
        try {
          await HM.updateUserRole(id, select.value);
          toast('Nível de acesso atualizado.', 'success');
        } catch (err) {
          console.error('[admin] Falha ao atualizar nível de acesso.', err);
          toast('Não foi possível atualizar o nível de acesso.', 'error');
        } finally {
          btn.disabled = false;
        }
      }));
    } catch (err) {
      console.error('[admin] Falha ao carregar usuários.', err);
      tbody.innerHTML = `<tr><td colspan="4">Não foi possível carregar os usuários.</td></tr>`;
    }
  }

  /* ── E-MAILS AUTORIZADOS A ENTRAR COM GOOGLE ── */
  async function renderAllowedEmailsTable() {
    const tbody = document.getElementById('allowedEmailsTableBody');
    tbody.innerHTML = `<tr><td colspan="3">Carregando…</td></tr>`;
    try {
      const emails = await HM.getAllowedEmails();
      tbody.innerHTML = emails.length ? emails.map(e => `
        <tr>
          <td>${escapeHtml(e.email)}</td>
          <td style="font-size:12px;color:var(--gray)">${new Date(e.created_at).toLocaleDateString('pt-BR')}</td>
          <td><button class="btn-icon del" type="button" data-remove-email="${escapeHtml(e.email)}" aria-label="Remover autorização de ${escapeHtml(e.email)}">${ICON_DEL}</button></td>
        </tr>
      `).join('') : `<tr><td colspan="3"><div class="empty-state"><p>Nenhum e-mail autorizado ainda.</p></div></td></tr>`;
      tbody.querySelectorAll('[data-remove-email]').forEach(btn => btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await HM.removeAllowedEmail(btn.dataset.removeEmail);
          renderAllowedEmailsTable();
        } catch (err) {
          console.error('[admin] Falha ao remover e-mail autorizado.', err);
          toast('Não foi possível remover o e-mail.', 'error');
          btn.disabled = false;
        }
      }));
    } catch (err) {
      console.error('[admin] Falha ao carregar e-mails autorizados.', err);
      tbody.innerHTML = `<tr><td colspan="3">Não foi possível carregar a lista.</td></tr>`;
    }
  }

  document.getElementById('allowedEmailAddBtn').addEventListener('click', async () => {
    const input = document.getElementById('allowedEmailInput');
    const errEl = document.getElementById('allowedEmailError');
    const email = input.value.trim();
    errEl.textContent = '';
    if (!email) { errEl.textContent = 'Informe um e-mail.'; return; }
    try {
      await HM.addAllowedEmail(email);
      input.value = '';
      renderAllowedEmailsTable();
      toast('E-mail autorizado.', 'success');
    } catch (err) {
      console.error('[admin] Falha ao autorizar e-mail.', err);
      errEl.textContent = err.message?.includes('duplicate') ? 'Esse e-mail já está autorizado.' : 'Não foi possível autorizar esse e-mail.';
    }
  });

  /* ── LOGS (trilha de auditoria completa) ── */
  let logsState = { page: 0, pageSize: 25, entidade: '', rows: [], total: 0 };
  document.getElementById('filterLogEntidade').addEventListener('change', e => { logsState.entidade = e.target.value; loadLogsPage(true); });
  document.getElementById('logsLoadMoreBtn').addEventListener('click', () => loadLogsPage(false));

  let logsRequestToken = 0;

  async function loadLogsPage(reset) {
    const requestToken = ++logsRequestToken;
    const pageToLoad = reset ? 0 : logsState.page + 1;
    const btn = document.getElementById('logsLoadMoreBtn');
    btn.disabled = true;
    try {
      const { rows, total } = await HM.getLogs({ page: pageToLoad, pageSize: logsState.pageSize, entidade: logsState.entidade });
      if (requestToken !== logsRequestToken) return;
      logsState.page = pageToLoad;
      logsState.rows = reset ? rows : logsState.rows.concat(rows);
      logsState.total = total;
      renderLogsTable();
    } catch (err) {
      if (requestToken !== logsRequestToken) return;
      console.error('[admin] Falha ao carregar logs.', err);
      toast('Não foi possível carregar os logs.', 'error');
    } finally {
      if (requestToken === logsRequestToken) btn.disabled = false;
    }
  }

  function renderLogsTable() {
    const tbody = document.getElementById('logsTableBody');
    const rows = logsState.rows;
    tbody.innerHTML = rows.length ? rows.map(l => `
      <tr>
        <td style="white-space:nowrap;font-size:12px;color:var(--gray)">${new Date(l.created_at).toLocaleString('pt-BR')}</td>
        <td>${escapeHtml(l.usuario_email || '—')}</td>
        <td style="text-transform:capitalize">${escapeHtml(l.acao)} <span style="color:var(--gray)">· ${escapeHtml(l.entidade)}</span></td>
        <td>${escapeHtml((l.detalhes && l.detalhes.resumo) || '—')}</td>
      </tr>
    `).join('') : `<tr><td colspan="4"><div class="empty-state"><p>Nenhum log encontrado.</p></div></td></tr>`;
    document.getElementById('logsListCount').textContent = rows.length ? `Mostrando ${rows.length} de ${logsState.total}` : '';
    document.getElementById('logsLoadMoreBtn').hidden = rows.length >= logsState.total;
  }

  /* ── FORMATAÇÃO DE PREÇO (aplica em qualquer campo de preço do painel) ── */
  ['vPrice', 'cValue', 'lValor', 'baixaValor', 'kValorBase', 'kValorFixo'].forEach(id => {
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
      else if (overlay === lancamentoOverlay) closeLancamentoModal();
      else if (overlay === baixaOverlay) closeBaixaModal();
      else if (overlay === comissaoOverlay) closeComissaoModal();
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
