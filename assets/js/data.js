/**
 * data.js — Camada de dados compartilhada (Holanda Motors)
 * -----------------------------------------------------------
 * Fonte única de verdade para o site público (index.html) e o painel do
 * gestor (admin.html). Os dois arquivos só acessam dados através do objeto
 * global HM — nenhum dos dois fala com o Supabase diretamente. Isso é o que
 * mantém os dois sincronizados e é o único lugar que precisaria mudar caso
 * o backend mude novamente no futuro.
 *
 * Toda a persistência é feita no Supabase (Postgres + Auth + Storage) —
 * não há mais nenhum dado de aplicação salvo no localStorage. Toda função
 * que acessa o banco é assíncrona (retorna Promise); quem chama precisa
 * usar `await`.
 *
 * Requer que supabase-client.js tenha sido carregado antes deste arquivo
 * (ele expõe a constante `supabaseClient`).
 */

const HM = (function () {
  'use strict';

  const FOTOS_BUCKET = 'veiculos-fotos';

  /** Formata um número em Real (ex: 119900 → "R$ 119.900"). */
  function formatPrice(n) {
    return 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }

  /** Extrai o valor numérico de uma string formatada (ex: "R$ 119.900" → 119900). */
  function parsePrice(str) {
    return Number(String(str || '').replace(/[^\d]/g, '')) || 0;
  }

  /** Formata km com separador de milhar em pt-BR (ex: 18400 → "18.400 km"). */
  function formatKm(n) {
    return Number(n || 0).toLocaleString('pt-BR') + ' km';
  }

  /** Monta o link do WhatsApp (wa.me) já com a mensagem pré-preenchida. */
  function wppLink(message, wppNumber) {
    if (!wppNumber) throw new Error('[HM] wppLink requer um número de WhatsApp.');
    return `https://wa.me/${wppNumber}?text=${encodeURIComponent(message)}`;
  }

  // ── Mapeamento linha do banco → formato usado pelas telas ──
  // Mantém site.js e admin.js praticamente inalterados: eles continuam
  // recebendo objetos com os mesmos campos de antes (make, model, tipo,
  // price já formatado, img como URL etc.), só que agora vindos do Supabase.

  function mapVehicleRow(row) {
    const fotos = row.midias_veiculo || [];
    const foto = fotos.find(f => f.principal) || fotos[0];
    return {
      id: row.id,
      tipo: row.categorias ? row.categorias.slug : null,
      make: row.marcas ? row.marcas.nome : '',
      model: row.modelo,
      year: row.ano,
      km: row.km,
      price: formatPrice(row.preco),
      cambio: row.cambio || '',
      combustivel: row.combustivel || '',
      cor: row.cor || '',
      badge: row.badge,
      ativo: row.ativo,
      img: foto ? foto.url : '',
      desc: row.descricao || '',
    };
  }

  function mapConsigRow(row) {
    return {
      id: row.id,
      owner: row.proprietario,
      contact: row.contato,
      vehicle: row.veiculo_descricao,
      plate: row.placa || '',
      value: row.valor != null ? formatPrice(row.valor) : '',
      date: row.data_entrada || '',
      status: row.status,
      commission: row.comissao || '',
      notes: row.observacoes || '',
    };
  }

  function mapConfigRow(row) {
    return {
      name: row.nome,
      address: row.endereco,
      wpp: row.whatsapp,
      insta: row.instagram,
      h1: row.horario_semana,
      h2: row.horario_sabado,
      about: row.sobre,
      hero: row.mostrar_hero,
      consig: row.mostrar_consignacao,
      floatwpp: row.botao_whatsapp_flutuante,
      nophoto: row.ocultar_sem_foto,
    };
  }

  function unwrap({ data, error }) {
    if (error) throw error;
    return data;
  }

  // ── VEÍCULOS ──

  async function getVehicles() {
    const data = unwrap(await supabaseClient
      .from('veiculos')
      .select('*, marcas(nome), categorias(slug), midias_veiculo(url, principal)')
      .order('created_at', { ascending: false }));
    return data.map(mapVehicleRow);
  }

  async function getCategoriaId(slug) {
    const data = unwrap(await supabaseClient.from('categorias').select('id').eq('slug', slug).single());
    return data.id;
  }

  /** Busca a marca pelo nome (sem diferenciar maiúsculas/minúsculas) ou cria uma nova. */
  async function ensureMarca(nome) {
    const nomeTrim = String(nome || '').trim();
    if (!nomeTrim) throw new Error('Marca é obrigatória.');
    const existente = unwrap(await supabaseClient.from('marcas').select('id').ilike('nome', nomeTrim).maybeSingle());
    if (existente) return existente.id;
    const criada = unwrap(await supabaseClient.from('marcas').insert({ nome: nomeTrim }).select('id').single());
    return criada.id;
  }

  /** Só um veículo pode ser "destaque" por vez — desmarca os demais. */
  async function clearDestaque(exceptId) {
    let query = supabaseClient.from('veiculos').update({ badge: 'seminovo' }).eq('badge', 'destaque');
    if (exceptId) query = query.neq('id', exceptId);
    unwrap(await query);
  }

  function dataUrlToBlob(dataUrl) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error('Formato de imagem inválido.');
    const mime = match[1];
    const bytes = atob(match[2]);
    const buffer = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
    return { blob: new Blob([buffer], { type: mime }), ext: mime.split('/')[1].replace('jpeg', 'jpg') };
  }

  async function uploadVehicleImage(vehicleId, dataUrl) {
    const { blob, ext } = dataUrlToBlob(dataUrl);
    const path = `${vehicleId}/${Date.now()}.${ext}`;
    unwrap(await supabaseClient.storage.from(FOTOS_BUCKET).upload(path, blob, { contentType: blob.type, upsert: true }));
    const { data } = supabaseClient.storage.from(FOTOS_BUCKET).getPublicUrl(path);
    return { path, url: data.publicUrl };
  }

  /** Remove a(s) foto(s) atual(is) do veículo (arquivo + registro) e grava a nova, se houver. */
  async function replaceVehiclePhoto(vehicleId, img) {
    const antigas = unwrap(await supabaseClient.from('midias_veiculo').select('id, storage_path').eq('veiculo_id', vehicleId));
    const paths = antigas.filter(m => m.storage_path).map(m => m.storage_path);
    if (paths.length) unwrap(await supabaseClient.storage.from(FOTOS_BUCKET).remove(paths));
    if (antigas.length) unwrap(await supabaseClient.from('midias_veiculo').delete().eq('veiculo_id', vehicleId));

    if (!img) return;
    let storagePath = null;
    let url = img;
    if (img.startsWith('data:')) {
      const uploaded = await uploadVehicleImage(vehicleId, img);
      storagePath = uploaded.path;
      url = uploaded.url;
    }
    unwrap(await supabaseClient.from('midias_veiculo').insert({ veiculo_id: vehicleId, storage_path: storagePath, url, principal: true }));
  }

  function vehiclePayload(input, categoriaId, marcaId) {
    return {
      categoria_id: categoriaId,
      marca_id: marcaId,
      modelo: input.model,
      ano: input.year,
      km: input.km,
      preco: parsePrice(input.price),
      cambio: input.cambio,
      combustivel: input.combustivel,
      cor: input.cor,
      badge: input.badge,
      ativo: !!input.ativo,
      descricao: input.desc,
      updated_at: new Date().toISOString(),
    };
  }

  async function createVehicle(input) {
    const [categoriaId, marcaId] = await Promise.all([getCategoriaId(input.tipo), ensureMarca(input.make)]);
    if (input.badge === 'destaque') await clearDestaque(null);
    const created = unwrap(await supabaseClient.from('veiculos').insert(vehiclePayload(input, categoriaId, marcaId)).select('id').single());
    await replaceVehiclePhoto(created.id, input.img);
    return created.id;
  }

  async function updateVehicle(id, input) {
    const [categoriaId, marcaId] = await Promise.all([getCategoriaId(input.tipo), ensureMarca(input.make)]);
    if (input.badge === 'destaque') await clearDestaque(id);
    unwrap(await supabaseClient.from('veiculos').update(vehiclePayload(input, categoriaId, marcaId)).eq('id', id));

    const fotoAtual = unwrap(await supabaseClient.from('midias_veiculo').select('url').eq('veiculo_id', id).eq('principal', true).maybeSingle());
    const urlAtual = fotoAtual ? fotoAtual.url : '';
    if (urlAtual !== (input.img || '')) await replaceVehiclePhoto(id, input.img);
  }

  async function deleteVehicle(id) {
    const fotos = unwrap(await supabaseClient.from('midias_veiculo').select('storage_path').eq('veiculo_id', id));
    const paths = fotos.filter(f => f.storage_path).map(f => f.storage_path);
    if (paths.length) unwrap(await supabaseClient.storage.from(FOTOS_BUCKET).remove(paths));
    unwrap(await supabaseClient.from('veiculos').delete().eq('id', id));
  }

  async function toggleVehicleAtivo(id, ativo) {
    unwrap(await supabaseClient.from('veiculos').update({ ativo, updated_at: new Date().toISOString() }).eq('id', id));
  }

  // ── CONSIGNAÇÕES ──

  async function getConsigs() {
    const data = unwrap(await supabaseClient.from('consignacoes').select('*').order('created_at', { ascending: false }));
    return data.map(mapConsigRow);
  }

  function consigPayload(input) {
    return {
      proprietario: input.owner,
      contato: input.contact,
      veiculo_descricao: input.vehicle,
      placa: input.plate,
      valor: input.value ? parsePrice(input.value) : null,
      data_entrada: input.date || null,
      status: input.status,
      comissao: input.commission,
      observacoes: input.notes,
      updated_at: new Date().toISOString(),
    };
  }

  async function createConsig(input) {
    unwrap(await supabaseClient.from('consignacoes').insert(consigPayload(input)));
  }
  async function updateConsig(id, input) {
    unwrap(await supabaseClient.from('consignacoes').update(consigPayload(input)).eq('id', id));
  }
  async function deleteConsig(id) {
    unwrap(await supabaseClient.from('consignacoes').delete().eq('id', id));
  }

  // ── CONFIGURAÇÕES DA LOJA ──

  async function getConfig() {
    const data = unwrap(await supabaseClient.from('configuracoes_loja').select('*').eq('id', 1).single());
    return mapConfigRow(data);
  }

  async function saveConfig(cfg) {
    unwrap(await supabaseClient.from('configuracoes_loja').update({
      nome: cfg.name,
      endereco: cfg.address,
      whatsapp: cfg.wpp,
      instagram: cfg.insta,
      horario_semana: cfg.h1,
      horario_sabado: cfg.h2,
      sobre: cfg.about,
      mostrar_hero: cfg.hero,
      mostrar_consignacao: cfg.consig,
      botao_whatsapp_flutuante: cfg.floatwpp,
      ocultar_sem_foto: cfg.nophoto,
      updated_at: new Date().toISOString(),
    }).eq('id', 1));
  }

  // ── ATIVIDADE (dashboard) ──

  async function getActivity() {
    const data = unwrap(await supabaseClient.from('atividades').select('*').order('created_at', { ascending: false }).limit(20));
    return data.map(a => ({
      msg: a.mensagem,
      color: a.cor,
      time: new Date(a.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    }));
  }

  async function logActivity(msg, color) {
    unwrap(await supabaseClient.from('atividades').insert({ mensagem: msg, cor: color }));
    // mantém a tabela enxuta, guardando só as últimas 50 entradas
    const antigas = unwrap(await supabaseClient.from('atividades').select('id').order('created_at', { ascending: false }).range(50, 999));
    if (antigas.length) unwrap(await supabaseClient.from('atividades').delete().in('id', antigas.map(a => a.id)));
  }

  // ── AUTENTICAÇÃO (Supabase Auth) ──

  async function login(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  }

  async function logout() {
    await supabaseClient.auth.signOut();
  }

  async function getSession() {
    const { data } = await supabaseClient.auth.getSession();
    return data.session;
  }

  function onAuthStateChange(callback) {
    return supabaseClient.auth.onAuthStateChange((_event, session) => callback(session));
  }

  async function changePassword(newPassword) {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  return {
    // veículos
    getVehicles,
    createVehicle,
    updateVehicle,
    deleteVehicle,
    toggleVehicleAtivo,
    // consignações
    getConsigs,
    createConsig,
    updateConsig,
    deleteConsig,
    // configurações
    getConfig,
    saveConfig,
    // atividade
    getActivity,
    logActivity,
    // autenticação
    login,
    logout,
    getSession,
    onAuthStateChange,
    changePassword,
    // utilitários
    wppLink,
    formatKm,
    formatPrice,
  };
})();
