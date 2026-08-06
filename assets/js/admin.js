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
  }

  /* ── NAVEGAÇÃO ── */
  const titles = { dashboard: 'Dashboard', veiculos: 'Veículos', consignacoes: 'Consignações', 'fin-dashboard': 'Dashboard Financeiro', 'fin-fluxo': 'Fluxo de Caixa', usuarios: 'Usuários', logs: 'Logs', configuracoes: 'Configurações' };
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
    if (page === 'fin-fluxo') { if (!finCategoriasCarregadas) populateFinCategoriaFilters(); loadLancamentosPage(true); }
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

  /* ── Fluxo de Caixa (lista paginada de lançamentos) ── */
  let lancamentoState = { page: 0, pageSize: 25, search: '', tipo: '', status: '', formaPagamento: '', categoriaId: '', dataInicio: '', dataFim: '', rows: [], total: 0 };
  let lancamentoRequestToken = 0;
  let finCategoriasCarregadas = false;
  let finCategoriasEntrada = [];
  let finCategoriasSaida = [];
  let finSearchDebounceTimer;

  async function populateFinCategoriaFilters() {
    try {
      const [entrada, saida] = await Promise.all([HM.getCategoriasFinanceiras('entrada'), HM.getCategoriasFinanceiras('saida')]);
      finCategoriasEntrada = entrada;
      finCategoriasSaida = saida;
      finCategoriasCarregadas = true;
      const raizes = [...entrada, ...saida].filter(c => !c.categoria_pai_id).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      document.getElementById('finFilterCategoria').innerHTML = '<option value="">Todas as categorias</option>'
        + raizes.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('');
    } catch (err) {
      console.error('[admin] Falha ao carregar categorias financeiras.', err);
    }
  }

  document.getElementById('finSearch').addEventListener('input', e => {
    clearTimeout(finSearchDebounceTimer);
    const valor = e.target.value;
    finSearchDebounceTimer = setTimeout(() => { lancamentoState.search = valor; loadLancamentosPage(true); }, 250);
  });
  document.getElementById('finFilterTipo').addEventListener('change', e => { lancamentoState.tipo = e.target.value; loadLancamentosPage(true); });
  document.getElementById('finFilterStatus').addEventListener('change', e => { lancamentoState.status = e.target.value; loadLancamentosPage(true); });
  document.getElementById('finFilterCategoria').addEventListener('change', e => { lancamentoState.categoriaId = e.target.value; loadLancamentosPage(true); });
  document.getElementById('finFilterForma').addEventListener('change', e => { lancamentoState.formaPagamento = e.target.value; loadLancamentosPage(true); });
  document.getElementById('finFilterInicio').addEventListener('change', e => { lancamentoState.dataInicio = e.target.value; loadLancamentosPage(true); });
  document.getElementById('finFilterFim').addEventListener('change', e => { lancamentoState.dataFim = e.target.value; loadLancamentosPage(true); });
  document.getElementById('lancamentoLoadMoreBtn').addEventListener('click', () => loadLancamentosPage(false));

  async function loadLancamentosPage(reset) {
    const requestToken = ++lancamentoRequestToken;
    const pageToLoad = reset ? 0 : lancamentoState.page + 1;
    const btn = document.getElementById('lancamentoLoadMoreBtn');
    btn.disabled = true;
    try {
      const { rows, total } = await HM.getLancamentos({
        page: pageToLoad, pageSize: lancamentoState.pageSize, search: lancamentoState.search,
        tipo: lancamentoState.tipo, status: lancamentoState.status, formaPagamento: lancamentoState.formaPagamento,
        categoriaId: lancamentoState.categoriaId, dataInicio: lancamentoState.dataInicio, dataFim: lancamentoState.dataFim,
      });
      if (requestToken !== lancamentoRequestToken) return;
      lancamentoState.page = pageToLoad;
      lancamentoState.rows = reset ? rows : lancamentoState.rows.concat(rows);
      lancamentoState.total = total;
      renderLancamentosTable();
    } catch (err) {
      if (requestToken !== lancamentoRequestToken) return;
      console.error('[admin] Falha ao carregar lançamentos.', err);
      toast('Não foi possível carregar o fluxo de caixa.', 'error');
    } finally {
      if (requestToken === lancamentoRequestToken) btn.disabled = false;
    }
  }

  function lancamentoStatusBadge(l) {
    if (l.status === 'cancelado') return `<span class="badge badge-inativo">Cancelado</span>`;
    if (l.status === 'pago') return `<span class="badge badge-ativo">Pago</span>`;
    if (l.vencida) return `<span class="badge badge-vencido">Vencido</span>`;
    return `<span class="badge badge-negociando">Pendente</span>`;
  }

  function lancamentoRowHtml(l) {
    const podeExcluir = roleAtLeast('administrador');
    return `
      <tr>
        <td style="white-space:nowrap;font-size:12px;color:var(--gray)">${HM.formatDateBR(l.dataLancamento)}</td>
        <td><div class="td-name">${escapeHtml(l.descricao)}</div>${l.formaPagamento ? `<div class="td-sub">${FIN_FORMA_LABELS[l.formaPagamento] || l.formaPagamento}</div>` : ''}</td>
        <td style="font-size:12px;color:var(--gray)">${escapeHtml(l.categoriaNome || '—')}</td>
        <td><span class="badge ${l.tipo === 'entrada' ? 'badge-ativo' : 'badge-vendido'}">${l.tipo === 'entrada' ? 'Entrada' : 'Saída'}</span></td>
        <td class="${l.tipo === 'entrada' ? 'fin-valor-entrada' : 'fin-valor-saida'}" style="font-weight:700">${l.tipo === 'entrada' ? '+' : '−'} ${HM.formatPrice(l.valor)}</td>
        <td>${lancamentoStatusBadge(l)}</td>
        <td>
          <div class="actions">
            ${l.status === 'pendente' ? `<button class="btn-icon toggle" type="button" data-baixa="${l.id}" aria-label="Registrar pagamento de ${escapeHtml(l.descricao)}">${ICON_CHECK}</button>` : ''}
            ${l.status === 'pago' ? `<button class="btn-icon" type="button" data-reabrir="${l.id}" data-label="${escapeHtml(l.descricao)}" aria-label="Reabrir cobrança de ${escapeHtml(l.descricao)}">${ICON_UNDO}</button>` : ''}
            <button class="btn-icon edit" type="button" data-fin-edit="${l.id}" aria-label="Editar ${escapeHtml(l.descricao)}">${ICON_EDIT}</button>
            ${podeExcluir ? `<button class="btn-icon del" type="button" data-fin-del="${l.id}" data-label="${escapeHtml(l.descricao)}" aria-label="Excluir ${escapeHtml(l.descricao)}">${ICON_DEL}</button>` : ''}
          </div>
        </td>
      </tr>`;
  }

  function renderLancamentosTable() {
    const ls = lancamentoState.rows;
    const tbody = document.getElementById('lancamentoTableBody');
    if (!ls.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>Nenhum lançamento encontrado.</p></div></td></tr>`;
    } else {
      tbody.innerHTML = ls.map(lancamentoRowHtml).join('');
      tbody.querySelectorAll('[data-fin-edit]').forEach(b => b.addEventListener('click', () => openLancamentoModal(b.dataset.finEdit, b)));
      tbody.querySelectorAll('[data-fin-del]').forEach(b => b.addEventListener('click', () => confirmDelete('lancamento', b.dataset.finDel, b.dataset.label, b)));
      tbody.querySelectorAll('[data-baixa]').forEach(b => b.addEventListener('click', () => openBaixaModal(b.dataset.baixa, b)));
      tbody.querySelectorAll('[data-reabrir]').forEach(b => b.addEventListener('click', () => reabrirLancamento(b.dataset.reabrir, b.dataset.label)));
    }
    document.getElementById('lancamentoListCount').textContent = ls.length ? `Mostrando ${ls.length} de ${lancamentoState.total}` : '';
    document.getElementById('lancamentoLoadMoreBtn').hidden = ls.length >= lancamentoState.total;
  }

  async function reabrirLancamento(id, label) {
    try {
      await HM.reabrirLancamento(id);
      await loadLancamentosPage(true);
      toast(`Cobrança de "${label}" reaberta.`, 'success');
    } catch (err) {
      console.error('[admin] Falha ao reabrir lançamento.', err);
      toast('Não foi possível reabrir esta cobrança.', 'error');
    }
  }

  /* ── Modal de lançamento (criar/editar) ── */
  const lancamentoOverlay = document.getElementById('lancamentoModalOverlay');
  let finTipoAtual = 'entrada';

  document.getElementById('newLancamentoBtn').addEventListener('click', e => openLancamentoModal(null, e.currentTarget));
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
    populateLancamentoCategoriaSelect();
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

  async function openLancamentoModal(id, triggerEl) {
    if (!finCategoriasCarregadas) await populateFinCategoriaFilters();
    lastFocusedEl = triggerEl || document.activeElement;
    document.getElementById('lancamentoFormError').textContent = '';
    document.getElementById('lValorPagoHint').hidden = true;

    ['lId', 'lUpdatedAt', 'lNumeroDocumento', 'lObservacoes', 'lValor', 'lDataVencimento', 'lFormaPagamento'].forEach(f => { document.getElementById(f).value = ''; });
    document.getElementById('lDataLancamento').value = new Date().toISOString().slice(0, 10);
    document.getElementById('lStatus').value = 'pendente';
    document.getElementById('lOrigem').value = 'manual';
    document.getElementById('lDescricao').value = '';
    setLancamentoTipo('entrada');
    document.getElementById('lancamentoModalTitle').textContent = id ? 'Editar Lançamento' : 'Novo Lançamento';

    if (id) {
      const l = lancamentoState.rows.find(x => x.id === id) || await HM.getLancamentoById(id);
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
      document.getElementById('lObservacoes').value = l.observacoes || '';
      setLancamentoTipo(l.tipo);
      populateLancamentoCategoriaSelect(l.categoriaId, l.subcategoriaId);
      if (l.valorPago > 0 && l.valorPago < l.valor) {
        const hint = document.getElementById('lValorPagoHint');
        hint.hidden = false;
        hint.textContent = `Já foi baixado ${HM.formatPrice(l.valorPago)} deste lançamento (saldo em aberto: ${HM.formatPrice(l.saldo)}). Para dar mais uma baixa, use "Registrar pagamento" na lista em vez de editar o valor aqui.`;
      }
    }
    openModal(lancamentoOverlay, document.getElementById('lDescricao'));
  }
  function closeLancamentoModal() { closeModalEl(lancamentoOverlay); }

  async function saveLancamento() {
    const descricao = document.getElementById('lDescricao').value.trim();
    const valorStr = document.getElementById('lValor').value.trim();
    const errEl = document.getElementById('lancamentoFormError');
    if (!descricao || !valorStr) { errEl.textContent = 'Preencha a descrição e o valor.'; return; }
    if (HM.parsePrice(valorStr) <= 0) { errEl.textContent = 'Informe um valor maior que zero.'; return; }
    errEl.textContent = '';

    const editId = document.getElementById('lId').value;
    const status = document.getElementById('lStatus').value;
    const valor = HM.parsePrice(valorStr);
    const data = {
      tipo: finTipoAtual,
      descricao,
      valor,
      valorPago: status === 'pago' ? valor : 0,
      categoriaId: document.getElementById('lCategoria').value || null,
      subcategoriaId: document.getElementById('lSubcategoria').value || null,
      dataLancamento: document.getElementById('lDataLancamento').value || null,
      dataVencimento: document.getElementById('lDataVencimento').value || null,
      dataPagamento: status === 'pago' ? new Date().toISOString().slice(0, 10) : null,
      formaPagamento: document.getElementById('lFormaPagamento').value || null,
      status,
      origem: document.getElementById('lOrigem').value,
      numeroDocumento: document.getElementById('lNumeroDocumento').value.trim(),
      observacoes: document.getElementById('lObservacoes').value.trim(),
    };

    const saveBtn = document.getElementById('lancamentoSaveBtn');
    saveBtn.disabled = true;
    try {
      if (editId) {
        data.expectedUpdatedAt = document.getElementById('lUpdatedAt').value || null;
        await HM.updateLancamento(editId, data);
        toast('Lançamento atualizado!', 'success');
      } else {
        await HM.createLancamento(data);
        toast('Lançamento registrado!', 'success');
      }
      await Promise.all([loadLancamentosPage(true), renderDashboardFinanceiro()]);
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

  document.getElementById('baixaCancelBtn').addEventListener('click', closeBaixaModal);
  document.getElementById('baixaConfirmBtn').addEventListener('click', confirmBaixa);
  baixaOverlay.addEventListener('click', e => { if (e.target === e.currentTarget) closeBaixaModal(); });

  function openBaixaModal(id, triggerEl) {
    const l = lancamentoState.rows.find(x => x.id === id);
    if (!l) return;
    baixaLancamentoId = id;
    lastFocusedEl = triggerEl || document.activeElement;
    document.getElementById('baixaModalTitle').textContent = l.tipo === 'entrada' ? 'Registrar recebimento' : 'Registrar pagamento';
    document.getElementById('baixaModalSaldo').textContent = `Saldo em aberto: ${HM.formatPrice(l.saldo)} de ${HM.formatPrice(l.valor)}`;
    document.getElementById('baixaValor').value = HM.formatPrice(l.saldo);
    document.getElementById('baixaData').value = new Date().toISOString().slice(0, 10);
    document.getElementById('baixaFormError').textContent = '';
    openModal(baixaOverlay, document.getElementById('baixaValor'));
  }
  function closeBaixaModal() { closeModalEl(baixaOverlay); baixaLancamentoId = null; }

  async function confirmBaixa() {
    const errEl = document.getElementById('baixaFormError');
    const valor = HM.parsePrice(document.getElementById('baixaValor').value);
    if (valor <= 0) { errEl.textContent = 'Informe um valor maior que zero.'; return; }
    const btn = document.getElementById('baixaConfirmBtn');
    btn.disabled = true;
    try {
      await HM.registrarPagamento(baixaLancamentoId, valor, document.getElementById('baixaData').value || null);
      await Promise.all([loadLancamentosPage(true), renderDashboardFinanceiro()]);
      closeBaixaModal();
      toast('Baixa registrada!', 'success');
    } catch (err) {
      console.error('[admin] Falha ao registrar baixa.', err);
      errEl.textContent = 'Não foi possível registrar essa baixa. Tente novamente.';
    } finally {
      btn.disabled = false;
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
        await loadVehiclePage(true);
        toast('Veículo excluído.', 'success');
      } else if (type === 'consig') {
        await HM.deleteConsig(id);
        await loadConsigPage(true);
        toast('Consignação excluída.', 'success');
      } else if (type === 'lancamento') {
        await HM.deleteLancamento(id);
        await loadLancamentosPage(true);
        toast('Lançamento excluído.', 'success');
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
  ['vPrice', 'cValue', 'lValor', 'baixaValor'].forEach(id => {
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
