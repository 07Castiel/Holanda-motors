/**
 * data.js — Camada de dados compartilhada (Holanda Motors)
 * -----------------------------------------------------------
 * Fonte única de verdade para o site público (index.html) e o painel do
 * gestor (admin/index.html). Os dois arquivos só acessam dados através do objeto
 * global HM — nenhum dos dois fala com o Supabase diretamente.
 *
 * Toda a persistência é feita no Supabase (Postgres + Auth + Storage). Toda
 * função que acessa o banco é assíncrona (retorna Promise).
 *
 * Toda ação de escrita é registrada em "logs_acoes" (auditoria) através de
 * logAction() — é daí que vêm tanto o feed "Atividade recente" do dashboard
 * quanto o histórico por veículo e a tela de Logs. Não existe mais uma
 * rotina de log separada por tela: centralizar aqui evita esquecer de
 * registrar uma ação nova em algum lugar do painel.
 *
 * Requer que supabase-client.js tenha sido carregado antes deste arquivo.
 */

const HM = (function () {
  'use strict';

  const FOTOS_BUCKET = 'veiculos-fotos';

  /** Erro específico de conflito de concorrência (alguém mais alterou o registro primeiro). */
  class ConcurrencyError extends Error {}

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

  /**
   * Redimensiona (máx. 1600px no lado maior) e recomprime uma imagem para
   * JPEG antes do upload — reduz drasticamente o tamanho de fotos de
   * celular (que costumam vir com vários MB) e é o que evita o projeto
   * voltar a esbarrar em limites de armazenamento no futuro.
   */
  async function compressImage(file, { maxDimension = 1600, quality = 0.82 } = {}) {
    try {
      const bitmap = await createImageBitmap(file);
      let { width, height } = bitmap;
      if (width > maxDimension || height > maxDimension) {
        const scale = maxDimension / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      return blob || file;
    } catch (err) {
      console.error('[HM] Falha ao comprimir imagem — enviando o arquivo original.', err);
      return file;
    }
  }

  // ── Mapeamento linha do banco → formato usado pelas telas ──

  function mapVehicleRow(row) {
    const fotos = (row.midias_veiculo || []).slice().sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0));
    const principal = fotos.find(f => f.principal) || fotos[0];
    return {
      id: row.id,
      tipo: row.categorias ? row.categorias.slug : null,
      make: row.marcas ? row.marcas.nome : '',
      model: row.modelo,
      year: row.ano,
      km: row.km,
      price: formatPrice(row.preco),
      precoNumerico: Number(row.preco) || 0,
      cambio: row.cambio || '',
      combustivel: row.combustivel || '',
      cor: row.cor || '',
      placa: row.placa || '',
      badge: row.badge,
      ativo: row.ativo,
      vendido: !!row.vendido,
      img: principal ? principal.url : '',
      imagens: fotos.map(f => ({ id: f.id, url: f.url, principal: f.principal })),
      desc: row.descricao || '',
      updatedAt: row.updated_at,
    };
  }

  function mapVehicleForBackup(row) {
    const fotos = row.midias_veiculo || [];
    return {
      id: row.id,
      tipo: row.categorias ? row.categorias.slug : null,
      make: row.marcas ? row.marcas.nome : '',
      model: row.modelo,
      year: row.ano,
      km: row.km,
      price: formatPrice(row.preco),
      cambio: row.cambio,
      combustivel: row.combustivel,
      cor: row.cor,
      placa: row.placa,
      badge: row.badge,
      ativo: row.ativo,
      vendido: !!row.vendido,
      desc: row.descricao,
      imagens: fotos.map(f => ({ url: f.url, principal: f.principal })),
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
      updatedAt: row.updated_at,
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
      parcelamentoAtivo: row.parcelamento_ativo,
      parcelamentoJuros: Number(row.parcelamento_juros_mensal),
      parcelamentoEntrada: Number(row.parcelamento_entrada_padrao),
      parcelamentoMaxParcelas: row.parcelamento_max_parcelas,
    };
  }

  function unwrap({ data, error }) {
    if (error) throw error;
    return data;
  }

  // ── AUDITORIA (logs_acoes) — usada pelo feed do dashboard, pelo
  // histórico por veículo e pela tela de Logs. ──

  const ACTION_COLORS = {
    criar: 'verde', atualizar: 'azul', excluir: 'vermelho',
    ativar: 'verde', desativar: 'amarelo', vender: 'verde',
    config: 'azul', senha: 'azul', papel: 'azul', login: 'azul',
  };

  /** Registra uma ação na trilha de auditoria. Nunca lança erro para não interromper a operação principal. */
  async function logAction(acao, entidade, entidadeId, detalhes) {
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return;
      const { error } = await supabaseClient.from('logs_acoes').insert({
        usuario_id: user.id,
        usuario_email: user.email,
        acao, entidade, entidade_id: entidadeId || null,
        detalhes: detalhes || null,
      });
      if (error) console.error('[HM] Falha ao registrar log de auditoria.', error);
    } catch (err) {
      console.error('[HM] Falha ao registrar log de auditoria.', err);
    }
  }

  async function getLogs({ page = 0, pageSize = 20, entidade, entidadeId } = {}) {
    let query = supabaseClient.from('logs_acoes').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (entidade) query = query.eq('entidade', entidade);
    if (entidadeId) query = query.eq('entidade_id', entidadeId);
    const from = page * pageSize;
    const { data, error, count } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    return { rows: data, total: count || 0, page, pageSize };
  }

  /** Feed "Atividade recente" do dashboard — derivado dos logs de auditoria, não é mais uma tabela própria. */
  async function getActivity(limit = 8) {
    const { rows } = await getLogs({ page: 0, pageSize: limit });
    return rows.map(l => ({
      msg: `${l.usuario_email ? l.usuario_email.split('@')[0] : 'Alguém'} ${(l.detalhes && l.detalhes.resumo) || l.acao}`,
      color: ACTION_COLORS[l.acao] || 'azul',
      time: new Date(l.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    }));
  }

  // ── VEÍCULOS ──

  async function getCategorias() {
    return unwrap(await supabaseClient.from('categorias').select('id, slug, nome').order('nome'));
  }

  async function getCategoriaId(slug) {
    const data = unwrap(await supabaseClient.from('categorias').select('id').eq('slug', slug).single());
    return data.id;
  }

  /** Busca a marca pelo nome (sem diferenciar maiúsculas/minúsculas) ou cria uma nova, tolerando corrida entre dois admins criando a mesma marca ao mesmo tempo. */
  async function ensureMarca(nome) {
    const nomeTrim = String(nome || '').trim();
    if (!nomeTrim) throw new Error('Marca é obrigatória.');
    const existente = unwrap(await supabaseClient.from('marcas').select('id').ilike('nome', nomeTrim).maybeSingle());
    if (existente) return existente.id;
    const { data, error } = await supabaseClient.from('marcas').insert({ nome: nomeTrim }).select('id').single();
    if (!error) return data.id;
    if (error.code === '23505') {
      // outro admin criou a mesma marca entre a leitura e a escrita acima
      const retry = unwrap(await supabaseClient.from('marcas').select('id').ilike('nome', nomeTrim).maybeSingle());
      if (retry) return retry.id;
    }
    throw error;
  }

  /** Marcas com pelo menos um veículo ativo/à venda — para o filtro do site público (não lista marcas sem nenhum anúncio visível). */
  async function getMarcasDisponiveis() {
    const rows = unwrap(await supabaseClient.from('veiculos').select('marca_id, marcas(id, nome)').eq('ativo', true).eq('vendido', false));
    const vistas = new Map();
    rows.forEach(r => { if (r.marcas) vistas.set(r.marcas.id, r.marcas.nome); });
    return Array.from(vistas, ([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  /** Só um veículo pode ser "destaque" por vez — desmarca os demais. */
  async function clearDestaque(exceptId) {
    let query = supabaseClient.from('veiculos').update({ badge: 'seminovo' }).eq('badge', 'destaque');
    if (exceptId) query = query.neq('id', exceptId);
    unwrap(await query);
  }

  async function uploadVehicleImage(fileOrBlob, vehicleId) {
    const ext = (fileOrBlob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const path = `${vehicleId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    unwrap(await supabaseClient.storage.from(FOTOS_BUCKET).upload(path, fileOrBlob, { contentType: fileOrBlob.type }));
    const { data } = supabaseClient.storage.from(FOTOS_BUCKET).getPublicUrl(path);
    return { path, url: data.publicUrl };
  }

  /**
   * Sincroniza a galeria de fotos de um veículo com o estado final desejado.
   * `images`: [{ id?: uuid (foto já existente a manter), file?: Blob (foto nova
   * a enviar), url?: string (URL já existente ou colada), principal: boolean }]
   *
   * Ordem importante (achado na auditoria): as fotos novas são enviadas ANTES
   * de remover as antigas — se o upload falhar no meio do caminho, o veículo
   * não fica sem nenhuma foto por causa disso.
   */
  async function saveVehicleImages(vehicleId, images) {
    const existentes = unwrap(await supabaseClient.from('midias_veiculo').select('id, storage_path').eq('veiculo_id', vehicleId));
    const mantidosIds = new Set(images.filter(i => i.id).map(i => i.id));
    const removidos = existentes.filter(e => !mantidosIds.has(e.id));

    const novos = images.filter(i => !i.id);
    await Promise.all(novos.map(async img => {
      let storagePath = null;
      let url = img.url;
      if (img.file) {
        const uploaded = await uploadVehicleImage(img.file, vehicleId);
        storagePath = uploaded.path;
        url = uploaded.url;
      }
      const inserida = unwrap(await supabaseClient.from('midias_veiculo').insert({ veiculo_id: vehicleId, storage_path: storagePath, url, principal: false }).select('id').single());
      img.id = inserida.id;
    }));

    if (removidos.length) {
      const paths = removidos.filter(r => r.storage_path).map(r => r.storage_path);
      if (paths.length) unwrap(await supabaseClient.storage.from(FOTOS_BUCKET).remove(paths));
      unwrap(await supabaseClient.from('midias_veiculo').delete().in('id', removidos.map(r => r.id)));
    }

    // Garante exatamente uma foto "principal" (a marcada pela UI, ou a primeira
    // que sobrar) — sempre zera tudo antes de marcar uma, nunca há duas
    // marcadas ao mesmo tempo (respeita a constraint única do banco).
    if (images.length) {
      const principalEscolhida = images.find(i => i.principal) || images[0];
      unwrap(await supabaseClient.from('midias_veiculo').update({ principal: false }).eq('veiculo_id', vehicleId));
      if (principalEscolhida.id) {
        unwrap(await supabaseClient.from('midias_veiculo').update({ principal: true }).eq('id', principalEscolhida.id));
      }
    }
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
      placa: input.placa || null,
      badge: input.badge,
      ativo: !!input.ativo,
      vendido: !!input.vendido,
      descricao: input.desc,
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Lista paginada de veículos, com busca instantânea (marca, modelo ou
   * placa) e filtros por tipo/badge resolvidos no servidor — assim o
   * desempenho não degrada conforme o estoque cresce, já que só a página
   * atual (e não o catálogo inteiro) trafega a cada consulta.
   */
  async function getVehicles({ page = 0, pageSize = 20, search = '', tipo = '', badge = '', ativo, vendido, comFoto = false, marcaId = '', precoMin, precoMax, orderBy = 'recentes' } = {}) {
    // "midias_veiculo!inner" (em vez do embed normal) transforma o join em
    // INNER — só entram veículos com pelo menos uma foto — resolvido no
    // servidor, então funciona corretamente junto com a paginação (ao
    // contrário de filtrar depois de já ter baixado a página).
    const midiasEmbed = comFoto ? 'midias_veiculo!inner(id, url, principal)' : 'midias_veiculo(id, url, principal)';
    let query = supabaseClient
      .from('veiculos')
      .select(`*, marcas(nome), categorias(slug), ${midiasEmbed}`, { count: 'exact' });

    const ORDENACOES = {
      'recentes': { column: 'created_at', ascending: false },
      'menor-preco': { column: 'preco', ascending: true },
      'maior-preco': { column: 'preco', ascending: false },
    };
    const ordenacao = ORDENACOES[orderBy] || ORDENACOES.recentes;
    query = query.order(ordenacao.column, { ascending: ordenacao.ascending });

    // ativo/vendido são explícitos aqui (não só confiados ao RLS) porque
    // esta mesma função é usada tanto pelo painel (autenticado, vê tudo)
    // quanto pelo site público — sem isso, um gestor logado que abrisse o
    // site público no mesmo navegador veria também veículos ocultos/vendidos.
    if (typeof ativo === 'boolean') query = query.eq('ativo', ativo);
    if (typeof vendido === 'boolean') query = query.eq('vendido', vendido);
    if (tipo) query = query.eq('categoria_id', await getCategoriaId(tipo));
    if (badge) query = query.eq('badge', badge);
    if (marcaId) query = query.eq('marca_id', marcaId);
    if (typeof precoMin === 'number') query = query.gte('preco', precoMin);
    if (typeof precoMax === 'number') query = query.lte('preco', precoMax);

    // Remove vírgulas/parênteses: têm significado estrutural no filtro
    // ".or()" do PostgREST e quebrariam a sintaxe se viessem do texto digitado.
    const termo = search.trim().replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (termo) {
      const marcasAchadas = unwrap(await supabaseClient.from('marcas').select('id').ilike('nome', `%${termo}%`));
      const partes = [`modelo.ilike.%${termo}%`, `placa.ilike.%${termo}%`, `cor.ilike.%${termo}%`];
      if (marcasAchadas.length) partes.push(`marca_id.in.(${marcasAchadas.map(m => m.id).join(',')})`);
      query = query.or(partes.join(','));
    }

    const from = page * pageSize;
    const { data, error, count } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    return { rows: data.map(mapVehicleRow), total: count || 0, page, pageSize };
  }

  /** Um único veículo em destaque para o hero do site (ou o mais recente, se nenhum estiver marcado) — evita baixar o catálogo inteiro só para montar o hero. */
  async function getFeaturedVehicle() {
    const select = '*, marcas(nome), categorias(slug), midias_veiculo(id, url, principal)';
    const destaque = unwrap(await supabaseClient.from('veiculos').select(select).eq('ativo', true).eq('vendido', false).eq('badge', 'destaque').limit(1).maybeSingle());
    if (destaque) return mapVehicleRow(destaque);
    const recente = unwrap(await supabaseClient.from('veiculos').select(select).eq('ativo', true).eq('vendido', false).order('created_at', { ascending: false }).limit(1).maybeSingle());
    return recente ? mapVehicleRow(recente) : null;
  }

  /** Busca um veículo específico pelo id — usado pelo link direto (?veiculo=) quando o veículo compartilhado não está na página atualmente carregada. Só retorna se estiver visível ao público (mesma regra do catálogo). */
  async function getVehicleById(id) {
    const select = '*, marcas(nome), categorias(slug), midias_veiculo(id, url, principal)';
    const row = unwrap(await supabaseClient.from('veiculos').select(select).eq('id', id).eq('ativo', true).eq('vendido', false).maybeSingle());
    return row ? mapVehicleRow(row) : null;
  }

  /** Contagens para os cards do dashboard — usa `count: 'exact', head: true` (só o número, sem baixar as linhas). */
  async function getVehicleStats() {
    const categorias = await getCategorias();
    const carroId = (categorias.find(c => c.slug === 'carro') || {}).id;
    const motoId = (categorias.find(c => c.slug === 'moto') || {}).id;
    const contar = async (builder) => {
      const { count, error } = await builder;
      if (error) throw error;
      return count || 0;
    };
    const base = () => supabaseClient.from('veiculos').select('id', { count: 'exact', head: true });
    const [total, ativos, carros, motos, consignados, destaque, vendidos] = await Promise.all([
      contar(base()),
      contar(base().eq('ativo', true)),
      carroId ? contar(base().eq('categoria_id', carroId)) : 0,
      motoId ? contar(base().eq('categoria_id', motoId)) : 0,
      contar(base().eq('badge', 'consignado')),
      contar(base().eq('badge', 'destaque')),
      contar(base().eq('vendido', true)),
    ]);
    return { total, ativos, carros, motos, consignados, destaque, vendidos };
  }

  async function createVehicle(input) {
    const [categoriaId, marcaId] = await Promise.all([getCategoriaId(input.tipo), ensureMarca(input.make)]);
    if (input.badge === 'destaque') await clearDestaque(null);
    const created = unwrap(await supabaseClient.from('veiculos').insert(vehiclePayload(input, categoriaId, marcaId)).select('id').single());
    if (input.images) await saveVehicleImages(created.id, input.images);
    await logAction('criar', 'veiculo', created.id, { resumo: `cadastrou ${input.make} ${input.model}` });
    return created.id;
  }

  async function updateVehicle(id, input) {
    const [categoriaId, marcaId] = await Promise.all([getCategoriaId(input.tipo), ensureMarca(input.make)]);
    if (input.badge === 'destaque') await clearDestaque(id);

    let query = supabaseClient.from('veiculos').update(vehiclePayload(input, categoriaId, marcaId)).eq('id', id);
    if (input.expectedUpdatedAt) query = query.eq('updated_at', input.expectedUpdatedAt);
    const { data, error } = await query.select('id');
    if (error) throw error;
    if (input.expectedUpdatedAt && (!data || !data.length)) {
      throw new ConcurrencyError('Este veículo foi alterado por outra pessoa enquanto você editava. Recarregue a lista e tente novamente.');
    }

    if (input.images) await saveVehicleImages(id, input.images);
    await logAction('atualizar', 'veiculo', id, { resumo: `atualizou ${input.make} ${input.model}` });
  }

  async function deleteVehicle(id) {
    const fotos = unwrap(await supabaseClient.from('midias_veiculo').select('storage_path').eq('veiculo_id', id));
    const paths = fotos.filter(f => f.storage_path).map(f => f.storage_path);
    if (paths.length) unwrap(await supabaseClient.storage.from(FOTOS_BUCKET).remove(paths));
    unwrap(await supabaseClient.from('veiculos').delete().eq('id', id));
    await logAction('excluir', 'veiculo', id, { resumo: 'excluiu um veículo do estoque' });
  }

  /** Alterna visibilidade de forma atômica no banco (RPC) — evita o "toggle" perder uma mudança feita por outra pessoa entre a leitura e a escrita. */
  async function toggleVehicleAtivo(id) {
    const { data, error } = await supabaseClient.rpc('toggle_veiculo_ativo', { p_id: id });
    if (error) throw error;
    await logAction(data ? 'ativar' : 'desativar', 'veiculo', id, { resumo: `${data ? 'exibiu' : 'ocultou'} um veículo no site` });
    return data;
  }

  /** Marca/desmarca um veículo como vendido — ao marcar como vendido, também some do site (ativo = false). */
  async function setVehicleVendido(id, vendido, label) {
    const payload = { vendido, updated_at: new Date().toISOString() };
    if (vendido) payload.ativo = false;
    unwrap(await supabaseClient.from('veiculos').update(payload).eq('id', id));
    await logAction(vendido ? 'vender' : 'atualizar', 'veiculo', id, {
      resumo: vendido ? `marcou ${label || 'um veículo'} como vendido` : `reverteu ${label || 'um veículo'} para disponível`,
    });
  }

  // ── CONSIGNAÇÕES ──

  async function getConsigs({ page = 0, pageSize = 20 } = {}) {
    const from = page * pageSize;
    const { data, error, count } = await supabaseClient
      .from('consignacoes').select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    return { rows: data.map(mapConsigRow), total: count || 0, page, pageSize };
  }

  async function getConsigStats() {
    const base = () => supabaseClient.from('consignacoes').select('id', { count: 'exact', head: true });
    const [{ count: total, error: e1 }, { count: ativas, error: e2 }] = await Promise.all([base(), base().eq('status', 'ativo')]);
    if (e1) throw e1;
    if (e2) throw e2;
    return { total: total || 0, ativas: ativas || 0 };
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
    const created = unwrap(await supabaseClient.from('consignacoes').insert(consigPayload(input)).select('id').single());
    await logAction('criar', 'consignacao', created.id, { resumo: `registrou consignação de ${input.owner}` });
  }

  async function updateConsig(id, input) {
    let query = supabaseClient.from('consignacoes').update(consigPayload(input)).eq('id', id);
    if (input.expectedUpdatedAt) query = query.eq('updated_at', input.expectedUpdatedAt);
    const { data, error } = await query.select('id');
    if (error) throw error;
    if (input.expectedUpdatedAt && (!data || !data.length)) {
      throw new ConcurrencyError('Esta consignação foi alterada por outra pessoa enquanto você editava. Recarregue a lista e tente novamente.');
    }
    await logAction('atualizar', 'consignacao', id, { resumo: `atualizou a consignação de ${input.owner}` });
  }

  async function deleteConsig(id) {
    unwrap(await supabaseClient.from('consignacoes').delete().eq('id', id));
    await logAction('excluir', 'consignacao', id, { resumo: 'excluiu uma consignação' });
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
      parcelamento_ativo: cfg.parcelamentoAtivo,
      parcelamento_juros_mensal: cfg.parcelamentoJuros,
      parcelamento_entrada_padrao: cfg.parcelamentoEntrada,
      parcelamento_max_parcelas: cfg.parcelamentoMaxParcelas,
      updated_at: new Date().toISOString(),
    }).eq('id', 1));
    await logAction('config', 'config', null, { resumo: 'atualizou as configurações da loja' });
  }

  // ── AUTENTICAÇÃO (Supabase Auth) ──

  async function login(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  }

  /** Redireciona para o consentimento do Google; a sessão volta pronta na
   * mesma URL quando o navegador retorna (supabase-js lê o token da URL). */
  async function loginWithGoogle() {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  }

  /** Registra "entrou no painel" uma vez por sessão nova de fato — chamada
   * pelo evento SIGNED_IN do onAuthStateChange, não por dentro de login()/
   * loginWithGoogle(), já que o login por Google só "termina" depois de um
   * redirecionamento de página inteira (não dentro da função que o inicia). */
  async function logSessionEntry() {
    await logAction('login', 'sessao', null, { resumo: 'entrou no painel' });
  }

  async function logout() {
    await supabaseClient.auth.signOut();
  }

  async function getSession() {
    const { data } = await supabaseClient.auth.getSession();
    return data.session;
  }

  function onAuthStateChange(callback) {
    return supabaseClient.auth.onAuthStateChange((_event, session) => callback(session, _event));
  }

  async function changePassword(newPassword) {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
    await logAction('senha', 'usuario', null, { resumo: 'alterou a própria senha' });
  }

  // ── USUÁRIOS E NÍVEIS DE ACESSO ──

  async function getCurrentUserProfile() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return null;
    const perfil = unwrap(await supabaseClient.from('usuarios').select('id, nome, email, role').eq('id', user.id).maybeSingle());
    return perfil || { id: user.id, nome: user.email, email: user.email, role: 'vendedor' };
  }

  async function getUsers() {
    return unwrap(await supabaseClient.from('usuarios').select('id, nome, email, role, created_at').order('created_at', { ascending: true }));
  }

  async function updateUserRole(userId, role) {
    unwrap(await supabaseClient.from('usuarios').update({ role }).eq('id', userId));
    await logAction('papel', 'usuario', userId, { resumo: `alterou o nível de acesso de um usuário para ${role}` });
  }

  // ── E-MAILS AUTORIZADOS A ENTRAR VIA LOGIN SOCIAL (GOOGLE) ──

  async function getAllowedEmails() {
    return unwrap(await supabaseClient.from('emails_permitidos').select('email, created_at').order('created_at', { ascending: true }));
  }

  async function addAllowedEmail(email) {
    unwrap(await supabaseClient.from('emails_permitidos').insert({ email: email.trim().toLowerCase() }));
    await logAction('permitir', 'usuario', null, { resumo: `autorizou o e-mail ${email} a entrar com Google` });
  }

  async function removeAllowedEmail(email) {
    unwrap(await supabaseClient.from('emails_permitidos').delete().eq('email', email));
    await logAction('revogar', 'usuario', null, { resumo: `removeu a autorização do e-mail ${email} para entrar com Google` });
  }

  // ══════════════════════════════════════════════════════════════════════
  // MÓDULO FINANCEIRO
  // ------------------------------------------------------------------------
  // Um único ledger (lancamentos_financeiros) cobre Fluxo de Caixa, Contas a
  // Receber, Contas a Pagar, Despesas e Receitas — são filtros diferentes
  // sobre a mesma tabela, não cadastros separados. Auditoria (valor
  // anterior/novo) é automática via trigger de banco, não precisa de
  // logAction() manual aqui. Restrito a gerente/administrador via RLS —
  // essas funções simplesmente falham com erro de permissão pra vendedor.
  // ══════════════════════════════════════════════════════════════════════

  const LANCAMENTO_SELECT = `
    *,
    categoria:categorias_financeiras!lancamentos_financeiros_categoria_id_fkey(id, nome),
    subcategoria:categorias_financeiras!lancamentos_financeiros_subcategoria_id_fkey(id, nome),
    cliente:clientes(id, nome, cpf_cnpj, telefone),
    fornecedor:fornecedores(id, nome, cpf_cnpj, telefone)
  `;

  function mapLancamentoRow(row) {
    return {
      id: row.id,
      tipo: row.tipo,
      descricao: row.descricao,
      categoriaId: row.categoria_id,
      categoriaNome: row.categoria?.nome || '',
      subcategoriaId: row.subcategoria_id,
      subcategoriaNome: row.subcategoria?.nome || '',
      valor: Number(row.valor) || 0,
      valorPago: Number(row.valor_pago) || 0,
      saldo: Number(row.saldo) || 0,
      dataLancamento: row.data_lancamento,
      dataVencimento: row.data_vencimento,
      dataPagamento: row.data_pagamento,
      formaPagamento: row.forma_pagamento,
      status: row.status,
      vencida: row.status === 'pendente' && row.data_vencimento && row.data_vencimento < new Date().toISOString().slice(0, 10),
      origem: row.origem,
      veiculoId: row.veiculo_id,
      consignacaoId: row.consignacao_id,
      clienteId: row.cliente_id,
      clienteNome: row.cliente?.nome || '',
      fornecedorId: row.fornecedor_id,
      fornecedorNome: row.fornecedor?.nome || '',
      responsavelId: row.responsavel_id,
      numeroDocumento: row.numero_documento,
      numeroParcela: row.numero_parcela,
      totalParcelas: row.total_parcelas,
      centroCusto: row.centro_custo,
      observacoes: row.observacoes,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    };
  }

  function lancamentoPayload(input) {
    return {
      tipo: input.tipo,
      descricao: input.descricao,
      categoria_id: input.categoriaId || null,
      subcategoria_id: input.subcategoriaId || null,
      valor: typeof input.valor === 'number' ? input.valor : parsePrice(input.valor),
      data_lancamento: input.dataLancamento || new Date().toISOString().slice(0, 10),
      data_vencimento: input.dataVencimento || null,
      forma_pagamento: input.formaPagamento || null,
      status: input.status || 'pendente',
      origem: input.origem || 'manual',
      veiculo_id: input.veiculoId || null,
      consignacao_id: input.consignacaoId || null,
      cliente_id: input.clienteId || null,
      fornecedor_id: input.fornecedorId || null,
      responsavel_id: input.responsavelId || null,
      numero_documento: input.numeroDocumento || null,
      numero_parcela: input.numeroParcela || null,
      total_parcelas: input.totalParcelas || null,
      centro_custo: input.centroCusto || null,
      observacoes: input.observacoes || null,
      updated_at: new Date().toISOString(),
    };
  }

  /** Lista paginada com os mesmos filtros que alimentam Fluxo de Caixa,
   * Contas a Receber/Pagar, Despesas e Receitas — cada tela chama isto com
   * um recorte diferente de `tipo`/`status`/`origem`. */
  async function getLancamentos({
    page = 0, pageSize = 25, search = '',
    tipo = '', status = '', formaPagamento = '', categoriaId = '',
    clienteId = '', fornecedorId = '', veiculoId = '', responsavelId = '',
    dataInicio = '', dataFim = '', valorMin, valorMax,
    orderBy = 'recentes',
  } = {}) {
    let query = supabaseClient.from('lancamentos_financeiros').select(LANCAMENTO_SELECT, { count: 'exact' });

    const ORDENACOES = {
      recentes: { column: 'data_lancamento', ascending: false },
      'vencimento-proximo': { column: 'data_vencimento', ascending: true },
      'maior-valor': { column: 'valor', ascending: false },
      'menor-valor': { column: 'valor', ascending: true },
    };
    const ordenacao = ORDENACOES[orderBy] || ORDENACOES.recentes;
    query = query.order(ordenacao.column, { ascending: ordenacao.ascending, nullsFirst: false });

    if (search) query = query.ilike('descricao', `%${search}%`);
    if (tipo) query = query.eq('tipo', tipo);
    if (status) query = query.eq('status', status);
    if (formaPagamento) query = query.eq('forma_pagamento', formaPagamento);
    if (categoriaId) query = query.eq('categoria_id', categoriaId);
    if (clienteId) query = query.eq('cliente_id', clienteId);
    if (fornecedorId) query = query.eq('fornecedor_id', fornecedorId);
    if (veiculoId) query = query.eq('veiculo_id', veiculoId);
    if (responsavelId) query = query.eq('responsavel_id', responsavelId);
    if (dataInicio) query = query.gte('data_lancamento', dataInicio);
    if (dataFim) query = query.lte('data_lancamento', dataFim);
    if (typeof valorMin === 'number') query = query.gte('valor', valorMin);
    if (typeof valorMax === 'number') query = query.lte('valor', valorMax);

    query = query.range(page * pageSize, page * pageSize + pageSize - 1);
    const { data, error, count } = await query;
    if (error) throw error;
    return { rows: data.map(mapLancamentoRow), total: count || 0, page, pageSize };
  }

  async function getLancamentoById(id) {
    const row = unwrap(await supabaseClient.from('lancamentos_financeiros').select(LANCAMENTO_SELECT).eq('id', id).maybeSingle());
    return row ? mapLancamentoRow(row) : null;
  }

  /**
   * `valor_pago` nunca é escrito direto: quem manda no quanto foi pago é a
   * tabela pagamentos_financeiros, sempre via registrar_pagamento(). Por
   * isso um lançamento marcado como "pago" no formulário nasce pendente e
   * recebe a baixa logo em seguida — assim ele aparece no histórico e nos
   * totais do dashboard como qualquer outra baixa, em vez de virar um valor
   * pago que ninguém sabe quando entrou.
   */
  async function createLancamento(input) {
    const quitarNaCriacao = input.status === 'pago';
    const payload = { ...lancamentoPayload(input), status: quitarNaCriacao ? 'pendente' : (input.status || 'pendente') };
    const row = unwrap(await supabaseClient.from('lancamentos_financeiros').insert(payload).select('id').single());
    if (quitarNaCriacao) {
      await registrarPagamento(row.id, payload.valor, {
        dataPagamento: input.dataPagamento || payload.data_lancamento,
        formaPagamento: input.formaPagamento,
      });
    }
    return row.id;
  }

  /** `input.expectedUpdatedAt` ativa a checagem de concorrência otimista —
   * mesmo padrão de updateVehicle/updateConsig: se o lançamento mudou entre
   * a leitura e a gravação, lança ConcurrencyError em vez de sobrescrever.
   * Mudar o status no formulário reconcilia o histórico de baixas: marcar
   * como "pago" quita o saldo em aberto, voltar para "pendente" desfaz as
   * baixas — nos dois casos passando pelas mesmas RPCs do botão de baixa. */
  async function updateLancamento(id, input) {
    const atual = await getLancamentoById(id);
    if (!atual) throw new Error('Lançamento não encontrado.');

    const payload = lancamentoPayload(input);
    const statusPedido = input.status || 'pendente';
    // Quanto ficaria em aberto com o valor novo, considerando o que já foi
    // baixado — é isso que decide se ainda falta quitar alguma coisa.
    const saldoRestante = payload.valor - atual.valorPago;
    const vaiQuitar = statusPedido === 'pago' && saldoRestante > 0;
    const vaiReabrir = statusPedido === 'pendente' && atual.valorPago > 0;

    // Quando ainda falta quitar, o UPDATE grava "pendente" e quem fecha para
    // "pago" é o registrar_pagamento logo abaixo. Se já estava quitado, o
    // status pedido vale como está — sem isso, editar só a descrição de um
    // lançamento pago o rebaixaria para pendente.
    let query = supabaseClient
      .from('lancamentos_financeiros')
      .update({ ...payload, status: vaiQuitar ? 'pendente' : statusPedido })
      .eq('id', id);
    if (input.expectedUpdatedAt) query = query.eq('updated_at', input.expectedUpdatedAt);
    const { data, error } = await query.select('id');
    if (error) throw error;
    if (input.expectedUpdatedAt && (!data || !data.length)) {
      throw new ConcurrencyError('Este lançamento foi alterado por outra pessoa enquanto você editava. Recarregue a lista e tente novamente.');
    }

    if (vaiQuitar) {
      await registrarPagamento(id, saldoRestante, { dataPagamento: input.dataPagamento, formaPagamento: input.formaPagamento });
    } else if (vaiReabrir) {
      await reabrirLancamento(id);
    }
  }

  async function deleteLancamento(id) {
    unwrap(await supabaseClient.from('lancamentos_financeiros').delete().eq('id', id));
  }

  /** Baixa (recebimento/pagamento) parcial ou total via RPC atômica —
   * `registrar_pagamento` trava a linha, grava o evento no histórico e soma
   * o acumulado numa transação só, então duas baixas simultâneas no mesmo
   * lançamento nunca se perdem nem estouram o saldo. */
  async function registrarPagamento(id, valor, { dataPagamento, formaPagamento, observacoes } = {}) {
    const { data, error } = await supabaseClient.rpc('registrar_pagamento', {
      p_id: id,
      p_valor: valor,
      p_data_pagamento: dataPagamento || new Date().toISOString().slice(0, 10),
      p_forma_pagamento: formaPagamento || null,
      p_observacoes: observacoes || null,
    });
    if (error) throw error;
    return mapLancamentoRow(data);
  }

  /** Desfaz todas as baixas de um lançamento (apaga o histórico dele e volta
   * pro estado "pendente") — usado quando uma cobrança foi baixada por engano. */
  async function reabrirLancamento(id) {
    const { error } = await supabaseClient.rpc('reabrir_lancamento', { p_id: id });
    if (error) throw error;
  }

  /** Histórico de baixas de um lançamento — um item por recebimento/pagamento. */
  async function getPagamentosLancamento(lancamentoId) {
    const rows = unwrap(await supabaseClient
      .from('pagamentos_financeiros')
      .select('id, valor, data_pagamento, forma_pagamento, observacoes, created_at')
      .eq('lancamento_id', lancamentoId)
      .order('data_pagamento', { ascending: false })
      .order('created_at', { ascending: false }));
    return rows.map(p => ({
      id: p.id,
      valor: Number(p.valor) || 0,
      dataPagamento: p.data_pagamento,
      formaPagamento: p.forma_pagamento,
      observacoes: p.observacoes,
      createdAt: p.created_at,
    }));
  }

  async function getCategoriasFinanceiras(tipo) {
    let query = supabaseClient.from('categorias_financeiras').select('id, tipo, nome, categoria_pai_id').order('nome', { ascending: true });
    if (tipo) query = query.eq('tipo', tipo);
    return unwrap(await query);
  }

  async function createCategoriaFinanceira(tipo, nome, categoriaPaiId) {
    const row = unwrap(await supabaseClient.from('categorias_financeiras').insert({ tipo, nome, categoria_pai_id: categoriaPaiId || null }).select('id').single());
    return row.id;
  }

  async function getClientes(search) {
    let query = supabaseClient.from('clientes').select('id, nome, cpf_cnpj, telefone').order('nome', { ascending: true }).limit(50);
    if (search) query = query.ilike('nome', `%${search}%`);
    return unwrap(await query);
  }

  async function createCliente(input) {
    const row = unwrap(await supabaseClient.from('clientes').insert({ nome: input.nome, cpf_cnpj: input.cpfCnpj || null, telefone: input.telefone || null }).select('id').single());
    return row.id;
  }

  async function getFornecedores(search) {
    let query = supabaseClient.from('fornecedores').select('id, nome, cpf_cnpj, telefone, categoria').order('nome', { ascending: true }).limit(50);
    if (search) query = query.ilike('nome', `%${search}%`);
    return unwrap(await query);
  }

  async function createFornecedor(input) {
    const row = unwrap(await supabaseClient.from('fornecedores').insert({ nome: input.nome, cpf_cnpj: input.cpfCnpj || null, telefone: input.telefone || null, categoria: input.categoria || null }).select('id').single());
    return row.id;
  }

  /**
   * Cliente/fornecedor criado sob demanda a partir do nome digitado no
   * lançamento — mesmo comportamento de ensureMarca() no cadastro de
   * veículos: o gestor não precisa parar pra cadastrar antes, e nomes
   * repetidos reaproveitam o registro existente em vez de duplicar.
   */
  function criarEnsurePessoa(tabela) {
    return async function ensurePessoa(nome) {
      const nomeTrim = String(nome || '').trim();
      if (!nomeTrim) return null;
      const existente = unwrap(await supabaseClient.from(tabela).select('id').ilike('nome', nomeTrim).limit(1).maybeSingle());
      if (existente) return existente.id;
      const { data, error } = await supabaseClient.from(tabela).insert({ nome: nomeTrim }).select('id').single();
      if (!error) return data.id;
      if (error.code === '23505') {
        const retry = unwrap(await supabaseClient.from(tabela).select('id').ilike('nome', nomeTrim).limit(1).maybeSingle());
        if (retry) return retry.id;
      }
      throw error;
    };
  }
  const ensureCliente = criarEnsurePessoa('clientes');
  const ensureFornecedor = criarEnsurePessoa('fornecedores');

  /** Cards e séries do Dashboard Financeiro — uma única chamada RPC agregada
   * no banco, não baixa lançamento nenhum pro navegador pra somar aqui. */
  async function getDashboardFinanceiro() {
    const { data, error } = await supabaseClient.rpc('dashboard_financeiro');
    if (error) throw error;
    return data;
  }

  /** Formata data ISO ("2026-08-06") para pt-BR ("06/08/2026") — usada em
   * qualquer tela nova pra não repetir `toLocaleDateString('pt-BR')` com a
   * correção de fuso (meio-dia UTC) espalhada pelo código. */
  function formatDateBR(isoDate) {
    if (!isoDate) return '—';
    return new Date(isoDate + 'T12:00:00').toLocaleDateString('pt-BR');
  }

  // ── COMISSÕES ──
  // Vendedor é o próprio usuário do painel (tabela usuarios), não um cadastro
  // à parte. A RLS deixa o vendedor ver só as comissões dele; criar, editar e
  // pagar continua restrito a gerente/administrador.

  function mapComissaoRow(row) {
    return {
      id: row.id,
      vendedorId: row.vendedor_id,
      vendedorNome: row.vendedor?.nome || row.vendedor?.email || '—',
      veiculoId: row.veiculo_id,
      descricao: row.descricao,
      valorBase: Number(row.valor_base) || 0,
      tipoCalculo: row.tipo_calculo,
      percentual: row.percentual == null ? null : Number(row.percentual),
      valor: Number(row.valor) || 0,
      status: row.status,
      dataReferencia: row.data_referencia,
      dataPagamento: row.data_pagamento,
      lancamentoId: row.lancamento_id,
      observacoes: row.observacoes,
      updatedAt: row.updated_at,
    };
  }

  /** Regra de cálculo compartilhada entre a tela e o que é gravado, pra
   * comissão exibida e comissão salva nunca divergirem. */
  function calcularComissao({ tipoCalculo, valorBase, percentual, valorFixo }) {
    if (tipoCalculo === 'fixo') return Math.max(0, Number(valorFixo) || 0);
    const base = Number(valorBase) || 0;
    const pct = Number(percentual) || 0;
    return Math.round(base * (pct / 100) * 100) / 100;
  }

  async function getComissoes({ page = 0, pageSize = 25, search = '', vendedorId = '', status = '', dataInicio = '', dataFim = '' } = {}) {
    let query = supabaseClient
      .from('comissoes')
      .select('*, vendedor:usuarios(nome, email)', { count: 'exact' })
      .order('data_referencia', { ascending: false });

    if (search) query = query.ilike('descricao', `%${search}%`);
    if (vendedorId) query = query.eq('vendedor_id', vendedorId);
    if (status) query = query.eq('status', status);
    if (dataInicio) query = query.gte('data_referencia', dataInicio);
    if (dataFim) query = query.lte('data_referencia', dataFim);

    query = query.range(page * pageSize, page * pageSize + pageSize - 1);
    const { data, error, count } = await query;
    if (error) throw error;
    return { rows: data.map(mapComissaoRow), total: count || 0, page, pageSize };
  }

  function comissaoPayload(input) {
    return {
      vendedor_id: input.vendedorId,
      veiculo_id: input.veiculoId || null,
      descricao: input.descricao,
      valor_base: typeof input.valorBase === 'number' ? input.valorBase : parsePrice(input.valorBase || 0),
      tipo_calculo: input.tipoCalculo || 'percentual',
      percentual: input.tipoCalculo === 'fixo' ? null : (Number(input.percentual) || 0),
      valor: input.valor,
      status: input.status || 'pendente',
      data_referencia: input.dataReferencia || new Date().toISOString().slice(0, 10),
      observacoes: input.observacoes || null,
      updated_at: new Date().toISOString(),
    };
  }

  async function createComissao(input) {
    const row = unwrap(await supabaseClient.from('comissoes').insert(comissaoPayload(input)).select('id').single());
    return row.id;
  }

  async function updateComissao(id, input) {
    let query = supabaseClient.from('comissoes').update(comissaoPayload(input)).eq('id', id);
    if (input.expectedUpdatedAt) query = query.eq('updated_at', input.expectedUpdatedAt);
    const { data, error } = await query.select('id');
    if (error) throw error;
    if (input.expectedUpdatedAt && (!data || !data.length)) {
      throw new ConcurrencyError('Esta comissão foi alterada por outra pessoa enquanto você editava. Recarregue a lista e tente novamente.');
    }
  }

  async function deleteComissao(id) {
    unwrap(await supabaseClient.from('comissoes').delete().eq('id', id));
  }

  /** Paga a comissão e gera, na mesma transação, a despesa correspondente no
   * fluxo de caixa — o dinheiro que sai pra comissão não fica só num módulo
   * à parte. */
  async function pagarComissao(id, { dataPagamento, formaPagamento } = {}) {
    const { data, error } = await supabaseClient.rpc('pagar_comissao', {
      p_id: id,
      p_data: dataPagamento || new Date().toISOString().slice(0, 10),
      p_forma_pagamento: formaPagamento || null,
    });
    if (error) throw error;
    return data;
  }

  /** Usuários que podem receber comissão, com a configuração padrão de cada
   * um (tipo, valor/percentual e meta mensal). */
  async function getVendedores() {
    const rows = unwrap(await supabaseClient
      .from('usuarios')
      .select('id, nome, email, role, comissao_tipo, comissao_valor, meta_mensal')
      .order('nome', { ascending: true }));
    return rows.map(u => ({
      id: u.id,
      nome: u.nome || u.email || '—',
      email: u.email,
      role: u.role,
      comissaoTipo: u.comissao_tipo,
      comissaoValor: Number(u.comissao_valor) || 0,
      metaMensal: Number(u.meta_mensal) || 0,
    }));
  }

  /** Passa por RPC em vez de UPDATE direto: a política de "usuarios" só
   * deixa cada um escrever na própria linha (ou o administrador em
   * qualquer uma), então um gerente gravando direto na tabela casaria com
   * zero linhas e a tela diria "salvo" sem ter salvo nada. A função confere
   * o papel de quem chamou antes de gravar. */
  async function updateConfigComissao(userId, { comissaoTipo, comissaoValor, metaMensal }) {
    const { error } = await supabaseClient.rpc('definir_comissao_vendedor', {
      p_user_id: userId,
      p_tipo: comissaoTipo,
      p_valor: comissaoValor,
      p_meta: metaMensal,
    });
    if (error) throw error;
    await logAction('papel', 'usuario', userId, { resumo: 'ajustou a configuração de comissão de um vendedor' });
  }

  // ── RELATÓRIOS ──

  /** Todos os relatórios voltam no mesmo formato {titulo, colunas, linhas,
   * resumo}, agregados no banco — a tela e os exportadores tratam qualquer
   * relatório do mesmo jeito, sem código por tipo. */
  async function getRelatorio(tipo, dataInicio, dataFim) {
    const { data, error } = await supabaseClient.rpc('relatorio_financeiro', {
      p_tipo: tipo,
      p_inicio: dataInicio || null,
      p_fim: dataFim || null,
    });
    if (error) throw error;
    return data;
  }

  // ── BACKUP FINANCEIRO ──

  /** Exporta o módulo financeiro inteiro em JSON. Separado do backup do
   * estoque porque são responsabilidades diferentes — e porque dado
   * financeiro costuma ser exportado num ritmo próprio (fechamento). */
  async function exportBackupFinanceiro() {
    const [categorias, clientes, fornecedores, lancamentos, pagamentos, comissoes] = await Promise.all([
      supabaseClient.from('categorias_financeiras').select('*').order('created_at'),
      supabaseClient.from('clientes').select('*').order('created_at'),
      supabaseClient.from('fornecedores').select('*').order('created_at'),
      supabaseClient.from('lancamentos_financeiros').select('*').order('created_at'),
      supabaseClient.from('pagamentos_financeiros').select('*').order('created_at'),
      supabaseClient.from('comissoes').select('*').order('created_at'),
    ]);
    [categorias, clientes, fornecedores, lancamentos, pagamentos, comissoes].forEach(unwrap);

    await logAction('exportar', 'backup', null, { resumo: 'exportou um backup financeiro' });
    return {
      versao: 1,
      tipo: 'financeiro',
      exportado_em: new Date().toISOString(),
      categorias_financeiras: categorias.data,
      clientes: clientes.data,
      fornecedores: fornecedores.data,
      lancamentos_financeiros: lancamentos.data,
      pagamentos_financeiros: pagamentos.data,
      comissoes: comissoes.data,
    };
  }

  /**
   * Restaura um backup financeiro preservando os ids originais (upsert), pra
   * os vínculos entre lançamento, pagamento e comissão continuarem válidos.
   * É uma restauração aditiva: registros que existem são atualizados, os que
   * não existem são criados — nada é apagado.
   */
  async function restoreBackupFinanceiro(backup, onProgress) {
    const log = (msg) => { if (onProgress) onProgress(msg); };
    if (backup.tipo !== 'financeiro') {
      throw new Error('Este arquivo não é um backup financeiro.');
    }

    // A ordem importa: cada etapa depende das anteriores por chave estrangeira.
    const etapas = [
      ['categorias_financeiras', 'Categorias'],
      ['clientes', 'Clientes'],
      ['fornecedores', 'Fornecedores'],
      ['lancamentos_financeiros', 'Lançamentos'],
      ['pagamentos_financeiros', 'Pagamentos'],
      ['comissoes', 'Comissões'],
    ];

    for (const [tabela, rotulo] of etapas) {
      const linhas = backup[tabela] || [];
      if (!linhas.length) { log(`— ${rotulo}: nada no arquivo.`); continue; }
      try {
        // "saldo" é coluna gerada pelo banco: não pode ser enviada de volta.
        const limpas = linhas.map(({ saldo, ...resto }) => resto);
        const { error } = await supabaseClient.from(tabela).upsert(limpas, { onConflict: 'id' });
        if (error) throw error;
        log(`✓ ${rotulo}: ${linhas.length} registro(s) restaurado(s).`);
      } catch (err) {
        log(`✗ ${rotulo}: ${err.message}`);
      }
    }
    await logAction('atualizar', 'backup', null, { resumo: 'restaurou um backup financeiro' });
  }

  // ── INTERESSE POR VEÍCULO (visualizações e cliques em WhatsApp) ──

  /**
   * Registra uma interação de um visitante do site público (anônimo) —
   * "visualizacao" quando abre o modal de detalhes, "whatsapp" quando
   * clica em qualquer botão de WhatsApp daquele veículo. Nunca lança erro
   * pro chamador: uma falha aqui não pode atrapalhar a navegação de
   * quem só está olhando o site.
   */
  async function logInteresse(veiculoId, tipo) {
    try {
      const { error } = await supabaseClient.from('interacoes_veiculo').insert({ veiculo_id: veiculoId, tipo });
      if (error) console.error('[HM] Falha ao registrar interesse.', error);
    } catch (err) {
      console.error('[HM] Falha ao registrar interesse.', err);
    }
  }

  /** Contagem de visualizações/WhatsApp por veículo, para os ids informados — usado pela tabela de veículos do painel. Requer autenticação (RLS). */
  async function getInteresseVeiculos(ids) {
    const resumo = {};
    ids.forEach(id => { resumo[id] = { visualizacoes: 0, whatsapp: 0 }; });
    if (!ids.length) return resumo;
    const rows = unwrap(await supabaseClient.from('interacoes_veiculo').select('veiculo_id, tipo').in('veiculo_id', ids));
    rows.forEach(r => {
      if (!resumo[r.veiculo_id]) resumo[r.veiculo_id] = { visualizacoes: 0, whatsapp: 0 };
      if (r.tipo === 'visualizacao') resumo[r.veiculo_id].visualizacoes++;
      else if (r.tipo === 'whatsapp') resumo[r.veiculo_id].whatsapp++;
    });
    return resumo;
  }

  /** Os N veículos com mais visualizações — para o "Mais vistos" do dashboard. */
  async function getMaisVistos(limite = 5) {
    const rows = unwrap(await supabaseClient.from('interacoes_veiculo').select('veiculo_id').eq('tipo', 'visualizacao'));
    const contagem = new Map();
    rows.forEach(r => contagem.set(r.veiculo_id, (contagem.get(r.veiculo_id) || 0) + 1));
    const idsOrdenados = Array.from(contagem.entries()).sort((a, b) => b[1] - a[1]).slice(0, limite);
    if (!idsOrdenados.length) return [];
    const ids = idsOrdenados.map(([id]) => id);
    const veiculos = unwrap(await supabaseClient
      .from('veiculos')
      .select('id, modelo, marcas(nome)')
      .in('id', ids));
    const porId = new Map(veiculos.map(v => [v.id, v]));
    return idsOrdenados
      .filter(([id]) => porId.has(id))
      .map(([id, visualizacoes]) => ({
        id,
        nome: `${(porId.get(id).marcas || {}).nome || ''} ${porId.get(id).modelo}`.trim(),
        visualizacoes,
      }));
  }

  // ── MIGRAÇÃO IDEMPOTENTE A PARTIR DO LOCALSTORAGE (sistema antigo) ──
  // Usada por migrar-localstorage.html. Cada registro migrado grava seu id
  // original do localStorage em "legacy_id" (coluna com índice único
  // parcial no banco) — é isso que torna seguro rodar a migração de novo
  // (ex: depois de cadastrar mais veículos no site antigo por engano):
  // quem já foi importado é pulado, nunca duplicado.

  function legacyDataUrlToBlob(dataUrl) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
    if (!match) return null;
    const bytes = atob(match[2]);
    const buffer = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
    return new Blob([buffer], { type: match[1] });
  }

  /** Converte o campo único "img" do sistema antigo (Base64 ou URL externa) para o formato de galeria, comprimindo fotos enviadas por upload. */
  async function legacyImgToImages(img) {
    if (!img) return [];
    if (img.startsWith('data:')) {
      const blob = legacyDataUrlToBlob(img);
      if (!blob) return [];
      return [{ id: null, file: await compressImage(blob), url: '', principal: true }];
    }
    return [{ id: null, file: null, url: img, principal: true }];
  }

  /**
   * Importa um veículo do formato antigo (chave "hm_vehicles" do
   * localStorage). Resolve/cria marca e categoria, envia a foto ao
   * Storage se for Base64, e é seguro chamar de novo com o mesmo `legacy`
   * — a segunda chamada é pulada (`skipped: true`) em vez de duplicar.
   */
  async function importLegacyVehicle(legacy) {
    if (legacy.id == null) throw new Error('Veículo sem id no localStorage — não é possível migrar com segurança.');
    const legacyId = String(legacy.id);

    const existente = unwrap(await supabaseClient.from('veiculos').select('id').eq('legacy_id', legacyId).maybeSingle());
    if (existente) return { skipped: true, id: existente.id };

    const [categoriaId, marcaId] = await Promise.all([getCategoriaId(legacy.tipo), ensureMarca(legacy.make)]);
    if (legacy.badge === 'destaque') await clearDestaque(null);

    const payload = vehiclePayload(legacy, categoriaId, marcaId);
    payload.legacy_id = legacyId;
    const created = unwrap(await supabaseClient.from('veiculos').insert(payload).select('id').single());

    const images = await legacyImgToImages(legacy.img);
    if (images.length) await saveVehicleImages(created.id, images);

    await logAction('criar', 'veiculo', created.id, { resumo: `migrou ${legacy.make} ${legacy.model} do localStorage` });
    return { created: true, id: created.id };
  }

  /** Mesma lógica de importLegacyVehicle, para consignações (chave "hm_consig"). */
  async function importLegacyConsig(legacy) {
    if (legacy.id == null) throw new Error('Consignação sem id no localStorage — não é possível migrar com segurança.');
    const legacyId = String(legacy.id);

    const existente = unwrap(await supabaseClient.from('consignacoes').select('id').eq('legacy_id', legacyId).maybeSingle());
    if (existente) return { skipped: true, id: existente.id };

    const payload = consigPayload(legacy);
    payload.legacy_id = legacyId;
    const created = unwrap(await supabaseClient.from('consignacoes').insert(payload).select('id').single());

    await logAction('criar', 'consignacao', created.id, { resumo: `migrou consignação de ${legacy.owner} do localStorage` });
    return { created: true, id: created.id };
  }

  // ── BACKUP E RESTAURAÇÃO ──
  // Exporta/restaura os dados de aplicação (veículos, fotos referenciadas
  // por URL, consignações, marcas e configurações) como um JSON portável,
  // usando as mesmas operações autenticadas do resto do painel (não requer
  // e nunca usa a chave service_role). Isso complementa — não substitui —
  // os backups automáticos do próprio Supabase (ver README).

  async function exportBackup() {
    // Categorias não entram no backup: são um catálogo fixo (carro/moto)
    // já recriado pelo seed do schema.sql, não um dado editável do usuário.
    const [marcasRes, veiculosRes, consigRes, configRes] = await Promise.all([
      supabaseClient.from('marcas').select('nome'),
      supabaseClient.from('veiculos').select('*, marcas(nome), categorias(slug), midias_veiculo(url, principal)').order('created_at'),
      supabaseClient.from('consignacoes').select('*').order('created_at'),
      supabaseClient.from('configuracoes_loja').select('*').eq('id', 1).single(),
    ]);
    [marcasRes, veiculosRes, consigRes, configRes].forEach(unwrap);

    return {
      versao: 1,
      exportado_em: new Date().toISOString(),
      marcas: marcasRes.data,
      veiculos: veiculosRes.data.map(mapVehicleForBackup),
      consignacoes: consigRes.data.map(mapConsigRow),
      configuracao: mapConfigRow(configRes.data),
    };
  }

  async function createVehicleFromBackup(v) {
    const [categoriaId, marcaId] = await Promise.all([getCategoriaId(v.tipo), ensureMarca(v.make)]);
    const payload = {
      id: v.id,
      categoria_id: categoriaId,
      marca_id: marcaId,
      modelo: v.model,
      ano: v.year,
      km: v.km,
      preco: parsePrice(v.price),
      cambio: v.cambio,
      combustivel: v.combustivel,
      cor: v.cor,
      placa: v.placa || null,
      badge: 'seminovo', // ajustado abaixo se necessário — evita violar o índice de "destaque único" durante a restauração
      ativo: !!v.ativo,
      vendido: !!v.vendido,
      descricao: v.desc,
    };
    const { data, error } = await supabaseClient.from('veiculos').upsert(payload, { onConflict: 'id' }).select('id').single();
    if (error) throw error;
    if (v.badge === 'destaque') {
      await clearDestaque(data.id);
      unwrap(await supabaseClient.from('veiculos').update({ badge: 'destaque' }).eq('id', data.id));
    } else if (v.badge && v.badge !== payload.badge) {
      unwrap(await supabaseClient.from('veiculos').update({ badge: v.badge }).eq('id', data.id));
    }
    const images = (v.imagens || []).map(img => ({ id: null, file: null, url: img.url, principal: img.principal }));
    if (images.length) await saveVehicleImages(data.id, images);
  }

  async function createConsigFromBackup(c) {
    const payload = { id: c.id, ...consigPayload(c) };
    const { error } = await supabaseClient.from('consignacoes').upsert(payload, { onConflict: 'id' });
    if (error) throw error;
  }

  /**
   * Restaura um backup gerado por exportBackup(). Continua mesmo se um
   * item específico falhar (ex: marca inválida) — cada falha é reportada
   * via `onProgress`, e o restante do backup ainda é processado.
   */
  async function restoreBackup(backup, onProgress) {
    const log = (msg) => { if (onProgress) onProgress(msg); };
    for (const m of backup.marcas || []) {
      try { await ensureMarca(m.nome); } catch (err) { log(`✗ Marca "${m.nome}": ${err.message}`); }
    }
    for (const v of backup.veiculos || []) {
      try { await createVehicleFromBackup(v); log(`✓ Veículo restaurado: ${v.make} ${v.model}`); }
      catch (err) { log(`✗ Falha ao restaurar "${v.make} ${v.model}": ${err.message}`); }
    }
    for (const c of backup.consignacoes || []) {
      try { await createConsigFromBackup(c); log(`✓ Consignação restaurada: ${c.owner}`); }
      catch (err) { log(`✗ Falha ao restaurar consignação de "${c.owner}": ${err.message}`); }
    }
    if (backup.configuracao) {
      try { await saveConfig(backup.configuracao); log('✓ Configurações da loja restauradas.'); }
      catch (err) { log(`✗ Falha ao restaurar configurações: ${err.message}`); }
    }
    await logAction('atualizar', 'backup', null, { resumo: 'restaurou um backup pelo painel' });
  }

  return {
    ConcurrencyError,
    // veículos
    getVehicles,
    getVehicleStats,
    getFeaturedVehicle,
    getVehicleById,
    getMarcasDisponiveis,
    getCategorias,
    createVehicle,
    updateVehicle,
    deleteVehicle,
    toggleVehicleAtivo,
    setVehicleVendido,
    // consignações
    getConsigs,
    getConsigStats,
    createConsig,
    updateConsig,
    deleteConsig,
    // configurações
    getConfig,
    saveConfig,
    // auditoria
    getActivity,
    getLogs,
    // autenticação e usuários
    login,
    loginWithGoogle,
    logSessionEntry,
    logout,
    getSession,
    onAuthStateChange,
    changePassword,
    getCurrentUserProfile,
    getUsers,
    updateUserRole,
    getAllowedEmails,
    addAllowedEmail,
    removeAllowedEmail,
    // financeiro
    getLancamentos,
    getLancamentoById,
    createLancamento,
    updateLancamento,
    deleteLancamento,
    registrarPagamento,
    reabrirLancamento,
    getPagamentosLancamento,
    getCategoriasFinanceiras,
    createCategoriaFinanceira,
    getClientes,
    createCliente,
    ensureCliente,
    getFornecedores,
    createFornecedor,
    ensureFornecedor,
    getDashboardFinanceiro,
    formatDateBR,
    // comissões
    getComissoes,
    createComissao,
    updateComissao,
    deleteComissao,
    pagarComissao,
    calcularComissao,
    getVendedores,
    updateConfigComissao,
    // relatórios e backup financeiro
    getRelatorio,
    exportBackupFinanceiro,
    restoreBackupFinanceiro,
    // interesse por veículo
    logInteresse,
    getInteresseVeiculos,
    getMaisVistos,
    // migração idempotente a partir do localStorage
    importLegacyVehicle,
    importLegacyConsig,
    // backup
    exportBackup,
    restoreBackup,
    // utilitários
    wppLink,
    formatKm,
    formatPrice,
    parsePrice,
    compressImage,
  };
})();
