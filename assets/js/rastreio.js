/**
 * rastreio.js — medição própria de visitas, origem e cliques em WhatsApp
 * (tabela "eventos_site", ver supabase/schema.sql → PARTE 13).
 *
 * Carregado tanto na home (index.html) quanto na página de veículo (função
 * da Vercel em api/veiculo.js) — por isso NÃO depende do supabase-js (que só
 * existe na home): fala direto com o REST do Supabase via fetch, com sua
 * própria cópia fixa de URL/chave anon, no mesmo padrão já usado pela Edge
 * Function vehicle-preview (ver README → "Preview ao compartilhar"). Se
 * trocar de projeto Supabase, atualize também este arquivo.
 *
 * Sem cookies e sem dado pessoal (não lê IP nem grava o user agent) — só usa
 * sessionStorage para não repetir "sessão"/"página" a cada recarregamento.
 *
 * Auto-inicializa sozinho ao carregar: não precisa ser chamado de fora. A
 * página de veículo só precisa declarar <body data-veiculo-id="...">.
 */
(function () {
  'use strict';

  var REST_URL = 'https://bqtfnnglwampyijmwdgm.supabase.co';
  var REST_KEY = 'sb_publishable_vaitarKonQCntB4mmzltLg_UMYpWaV3';

  var HM = window.HM = window.HM || {};

  /** Nunca lança erro pro chamador — uma falha de rede aqui não pode atrapalhar a navegação de quem só está olhando o site. */
  function enviar(tabela, payload) {
    try {
      fetch(REST_URL + '/rest/v1/' + tabela, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: REST_KEY,
          Authorization: 'Bearer ' + REST_KEY,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(payload),
        // keepalive (em vez de navigator.sendBeacon): o clique de WhatsApp abre
        // outra aba (target="_blank"), então a página atual nem chega a descarregar
        // — mas sendBeacon não permite os headers "apikey"/"Authorization" que o
        // REST do Supabase exige, então fetch com keepalive é a opção que sobra.
        keepalive: true,
      }).catch(function (err) { console.error('[rastreio] Falha ao registrar evento.', err); });
    } catch (err) {
      console.error('[rastreio] Falha ao registrar evento.', err);
    }
  }

  function dispositivo() {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  }

  function classificarUtmSource(valor) {
    var s = String(valor).toLowerCase();
    if (s.indexOf('insta') !== -1) return 'instagram';
    if (s.indexOf('google') !== -1 || s.indexOf('gmb') !== -1 || s.indexOf('maps') !== -1) return 'google';
    if (s.indexOf('face') !== -1 || s.indexOf('fb') !== -1) return 'facebook';
    if (s.indexOf('whats') !== -1 || s.indexOf('wa') !== -1) return 'whatsapp';
    return 'outro';
  }

  /** null = mesmo domínio (o chamador decide o que fazer: manter a origem já salva). */
  function classificarReferrer(ref) {
    if (!ref) return 'direto';
    var host;
    try { host = new URL(ref).hostname.toLowerCase(); } catch (err) { return 'outro'; }
    if (host === location.hostname) return null;
    if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
    if (/(^|\.)google\.[a-z.]+$/.test(host)) return 'google';
    if (/(^|\.)facebook\.com$/.test(host)) return 'facebook';
    return 'outro';
  }

  /** Calculada uma vez por sessão e guardada em sessionStorage — chamadas seguintes (inclusive em outra página do mesmo domínio) reaproveitam o valor já salvo. */
  function obterOrigem() {
    try {
      var salva = sessionStorage.getItem('hm_origem');
      if (salva) return salva;
    } catch (err) { /* sessionStorage indisponível (aba anônima bloqueada etc.) — segue sem cache */ }

    var utmSource = new URLSearchParams(location.search).get('utm_source');
    var origem = utmSource ? classificarUtmSource(utmSource) : (classificarReferrer(document.referrer) || 'direto');

    try { sessionStorage.setItem('hm_origem', origem); } catch (err) { /* ignorado */ }
    return origem;
  }

  function utmAtual() {
    var params = new URLSearchParams(location.search);
    return {
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
    };
  }

  function jaEnviado(chave) {
    try { return sessionStorage.getItem(chave) === '1'; } catch (err) { return false; }
  }
  function marcarEnviado(chave) {
    try { sessionStorage.setItem(chave, '1'); } catch (err) { /* ignorado */ }
  }

  function baseEvento() {
    var utm = utmAtual();
    return {
      origem: obterOrigem(),
      dispositivo: dispositivo(),
      utm_source: utm.utm_source,
      utm_medium: utm.utm_medium,
      utm_campaign: utm.utm_campaign,
    };
  }

  /** Um evento "sessao" no primeiro carregamento da sessão (qualquer página). */
  function registrarSessao() {
    if (jaEnviado('hm_sessao_enviada')) return;
    marcarEnviado('hm_sessao_enviada');
    var payload = baseEvento();
    payload.tipo = 'sessao';
    payload.pagina = location.pathname;
    enviar('eventos_site', payload);
  }

  /** Um evento "pagina" por caminho por sessão — reabrir o mesmo caminho (ex: fechar e abrir o modal de novo) não conta de novo. */
  function registrarPagina(veiculoId) {
    var chave = 'hm_pagina_' + location.pathname;
    if (jaEnviado(chave)) return;
    marcarEnviado(chave);
    var payload = baseEvento();
    payload.tipo = 'pagina';
    payload.pagina = location.pathname;
    payload.veiculo_id = veiculoId || null;
    enviar('eventos_site', payload);
  }

  function registrarWhatsapp(local, veiculoId) {
    var payload = baseEvento();
    payload.tipo = 'whatsapp';
    payload.pagina = location.pathname;
    payload.local = local || null;
    payload.veiculo_id = veiculoId || null;
    enviar('eventos_site', payload);
  }

  /** interacoes_veiculo (Parte 5) é o contador de "interesse" por veículo que já alimenta o painel — a página de veículo grava nela também, para os números do painel continuarem batendo (ver README). A home já faz isso via HM.logInteresse em site.js, então só duplicaria a contagem se repetíssemos aqui — por isso só entra em jogo com local "pagina_veiculo", exclusivo desta página. */
  function registrarInteresseVeiculo(veiculoId, tipo) {
    enviar('interacoes_veiculo', { veiculo_id: veiculoId, tipo: tipo });
  }

  /** Clique em qualquer botão de WhatsApp do site — delegado no document, então funciona mesmo para botões renderizados depois (cards do catálogo). */
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[href^="https://wa.me/"]');
    if (!link) return;
    var local = link.dataset.wppLocal || null;
    var veiculoId = link.dataset.wppVeiculo || null;
    registrarWhatsapp(local, veiculoId);
    if (local === 'pagina_veiculo' && veiculoId) registrarInteresseVeiculo(veiculoId, 'whatsapp');
  });

  HM.rastrear = { registrarSessao: registrarSessao, registrarPagina: registrarPagina, registrarWhatsapp: registrarWhatsapp };

  function init() {
    var veiculoId = document.body.dataset.veiculoId || null;
    registrarSessao();
    registrarPagina(veiculoId);
    // Página de veículo dedicada (server-side, sem o modal/HM.logInteresse da
    // home): conta como "visualização" pro mesmo contador que já existia.
    if (veiculoId) registrarInteresseVeiculo(veiculoId, 'visualizacao');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
