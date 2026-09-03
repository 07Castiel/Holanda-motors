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

  /**
   * Extrai o valor numérico de uma string formatada (ex: "R$ 119.900" → 119900).
   *
   * A vírgula é tratada como separador decimal do pt-BR: tudo depois dela são
   * centavos e é descartado. Sem esse corte, "R$ 119.900,00" virava 11990000
   * (cem vezes o valor real) — o ponto de milhar e a vírgula eram removidos
   * como se fossem o mesmo tipo de separador.
   */
  function parsePrice(str) {
    let s = String(str || '').replace(/[^\d.,]/g, '');
    const virgula = s.lastIndexOf(',');
    if (virgula !== -1) s = s.slice(0, virgula);
    return Number(s.replace(/\D/g, '')) || 0;
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
    // A ordem de exibição (galeria/carrossel) segue "ordem" — controlada pelo
    // gestor arrastando as fotos no painel. A capa (principal) é escolhida à
    // parte, independente da posição: pode estar em qualquer lugar da ordem.
    const fotos = (row.midias_veiculo || []).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
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
      reservado: !!row.reservado,
      carroceria: row.carrocerias ? row.carrocerias.slug : null,
      carroceriaNome: row.carrocerias ? row.carrocerias.nome : '',
      img: principal ? principal.url : '',
      imagens: fotos.map(f => ({ id: f.id, url: f.url, principal: f.principal })),
      desc: row.descricao || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapVehicleForBackup(row) {
    const fotos = (row.midias_veiculo || []).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    return {
      id: row.id,
      tipo: row.categorias ? row.categorias.slug : null,
      carroceria: row.carrocerias ? row.carrocerias.slug : null,
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
      reservado: !!row.reservado,
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
      // Número dedicado ao interesse em veículo específico. Vazio = usa o
      // WhatsApp geral, então o site funciona mesmo antes da migração rodar.
      wppVendas: row.whatsapp_vendas || '',
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
      parcelamentoMaxParcelasCarro: row.parcelamento_max_parcelas_carro,
      parcelamentoMaxParcelasMoto: row.parcelamento_max_parcelas_moto,
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
    ativar: 'verde', desativar: 'amarelo', vender: 'verde', reservar: 'amarelo',
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

  /** As 8 carrocerias fixas (SUV, Hatch, Sedã...) — usadas tanto no filtro de categoria quanto no formulário de cadastro/edição. */
  async function getCarrocerias() {
    return unwrap(await supabaseClient.from('carrocerias').select('id, slug, nome').order('nome'));
  }

  async function getCarroceriaId(slug) {
    if (!slug) return null;
    const data = unwrap(await supabaseClient.from('carrocerias').select('id').eq('slug', slug).maybeSingle());
    return data ? data.id : null;
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

  /** Cores em uso pelo estoque — para o filtro de cor. O site público só lista cores de veículos ativos/à venda (mesmo critério de getMarcasDisponiveis); o painel vê todas, já que o gestor filtra o estoque inteiro. */
  async function getCoresDisponiveis(apenasAtivos = true) {
    let query = supabaseClient.from('veiculos').select('cor').not('cor', 'is', null);
    if (apenasAtivos) query = query.eq('ativo', true).eq('vendido', false);
    const rows = unwrap(await query);
    const vistas = new Set(rows.map(r => r.cor).filter(Boolean));
    return Array.from(vistas).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  /** Só um veículo pode ser "destaque" por vez — desmarca os demais. */
  async function clearDestaque(exceptId) {
    let query = supabaseClient.from('veiculos').update({ badge: 'seminovo' }).eq('badge', 'destaque');
    if (exceptId) query = query.neq('id', exceptId);
    unwrap(await query);
  }

  /** Envia uma foto ao Storage, com novas tentativas em falha de rede/gateway.
   *
   * Achado no incidente de 31/08/2026: subindo ~19 fotos de uma vez a partir de
   * uma conexão residencial, o gateway derrubava as requisições mais lentas com
   * HTTP 520 (resposta vazia da origem) mesmo com o arquivo chegando ao destino.
   * Sem repetição, uma única foto perdida derrubava o cadastro inteiro.
   *
   * Cada tentativa usa um caminho novo — se a anterior tiver de fato gravado o
   * arquivo antes de o gateway cortar, o retry não esbarra em "objeto já existe"
   * (o arquivo a mais vira lixo no bucket, mas nunca uma foto perdida). */
  const UPLOAD_TENTATIVAS = 3;
  async function uploadVehicleImage(fileOrBlob, vehicleId) {
    const ext = (fileOrBlob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    let ultimoErro;
    for (let tentativa = 1; tentativa <= UPLOAD_TENTATIVAS; tentativa++) {
      const path = `${vehicleId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabaseClient.storage.from(FOTOS_BUCKET).upload(path, fileOrBlob, { contentType: fileOrBlob.type });
      if (!error) {
        const { data } = supabaseClient.storage.from(FOTOS_BUCKET).getPublicUrl(path);
        return { path, url: data.publicUrl };
      }
      ultimoErro = error;
      console.warn(`[HM] Falha ao enviar foto (tentativa ${tentativa}/${UPLOAD_TENTATIVAS}).`, error);
      if (tentativa < UPLOAD_TENTATIVAS) await new Promise(r => setTimeout(r, 700 * tentativa));
    }
    throw ultimoErro;
  }

  /** Executa as tarefas com no máximo `limite` em andamento ao mesmo tempo.
   * Ao contrário de Promise.all, nenhuma tarefa é abandonada quando outra
   * falha: o retorno traz uma entrada por tarefa, com `ok` dizendo se deu certo. */
  async function comLimiteDeConcorrencia(tarefas, limite) {
    const resultados = new Array(tarefas.length);
    let proxima = 0;
    async function trabalhador() {
      while (proxima < tarefas.length) {
        const i = proxima++;
        try { resultados[i] = { ok: true, valor: await tarefas[i]() }; }
        catch (err) { resultados[i] = { ok: false, erro: err }; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limite, tarefas.length) }, trabalhador));
    return resultados;
  }

  /**
   * Sincroniza a galeria de fotos de um veículo com o estado final desejado.
   * `images`: [{ id?: uuid (foto já existente a manter), file?: Blob (foto nova
   * a enviar), url?: string (URL já existente ou colada), principal: boolean }]
   *
   * Retorna { enviadas, falhas } em vez de lançar erro quando alguma foto não
   * sobe: o veículo em si já está gravado nesse ponto, então derrubar a
   * operação inteira por causa de uma foto fazia o painel dizer "não foi
   * possível salvar" para um cadastro que existia — e o gestor, ao clicar de
   * novo, criava uma duplicata. Agora o chamador recebe a contagem e avisa que
   * N fotos ficaram de fora, sem perder o resto do trabalho. Só erro de banco
   * (não de upload) continua sendo lançado.
   *
   * Ordem importante (achado na auditoria): as fotos novas são enviadas ANTES
   * de remover as antigas — se o upload falhar no meio do caminho, o veículo
   * não fica sem nenhuma foto por causa disso.
   */
  const UPLOADS_SIMULTANEOS = 3;
  async function saveVehicleImages(vehicleId, images) {
    const existentes = unwrap(await supabaseClient.from('midias_veiculo').select('id, storage_path').eq('veiculo_id', vehicleId));

    // Defesa contra ids de OUTRO veículo (acontecia quando uma tentativa de
    // salvar falhava, o modal continuava aberto com os ids já atribuídos e o
    // clique seguinte criava um veículo novo: as fotos da tentativa anterior
    // eram tratadas como "já existentes" e a ordem/capa acabava sendo gravada
    // nas linhas do veículo errado). Só ids que pertencem a ESTE veículo valem.
    const idsDesteVeiculo = new Set(existentes.map(e => e.id));
    images.forEach(img => { if (img.id && !idsDesteVeiculo.has(img.id)) img.id = null; });

    const mantidosIds = new Set(images.filter(i => i.id).map(i => i.id));
    const removidos = existentes.filter(e => !mantidosIds.has(e.id));

    const novos = images.filter(i => !i.id);
    const resultados = await comLimiteDeConcorrencia(novos.map(img => async () => {
      let storagePath = null;
      let url = img.url;
      if (img.file) {
        const uploaded = await uploadVehicleImage(img.file, vehicleId);
        storagePath = uploaded.path;
        url = uploaded.url;
      }
      const inserida = unwrap(await supabaseClient.from('midias_veiculo').insert({ veiculo_id: vehicleId, storage_path: storagePath, url, principal: false }).select('id').single());
      img.id = inserida.id;
    }), UPLOADS_SIMULTANEOS);

    const falhas = resultados.filter(r => !r.ok);
    falhas.forEach(f => console.error('[HM] Foto não pôde ser enviada.', f.erro));

    // Fotos que não subiram continuam no array sem id — tirar daqui evita que
    // os passos de ordem/capa abaixo tentem atualizar uma linha inexistente.
    const gravadas = images.filter(i => i.id);

    // Excluir as fotos tiradas da galeria só quando TUDO que era para entrar
    // entrou. Se alguma subida falhou, a remoção espera o próximo Salvar — assim
    // uma troca de fotos com internet ruim nunca deixa o anúncio mais pobre do
    // que começou (mesma ideia do "enviar antes de remover" acima).
    if (removidos.length && !falhas.length) {
      const paths = removidos.filter(r => r.storage_path).map(r => r.storage_path);
      if (paths.length) unwrap(await supabaseClient.storage.from(FOTOS_BUCKET).remove(paths));
      unwrap(await supabaseClient.from('midias_veiculo').delete().in('id', removidos.map(r => r.id)));
    }

    if (gravadas.length) {
      // Ordem de exibição: reflete a posição atual no array — é isso que o
      // gestor controla arrastando as fotos no painel. Sem restrição de
      // unicidade na coluna, então as N atualizações rodam em paralelo com segurança.
      await Promise.all(gravadas.map(async (img, idx) => {
        unwrap(await supabaseClient.from('midias_veiculo').update({ ordem: idx }).eq('id', img.id));
      }));

      // Garante exatamente uma foto "principal" (a marcada pela UI, ou a primeira
      // que sobrar) — sempre zera tudo antes de marcar uma, nunca há duas
      // marcadas ao mesmo tempo (respeita a constraint única do banco, por isso
      // roda em sequência, diferente do bloco de ordem acima).
      const principalEscolhida = gravadas.find(i => i.principal) || gravadas[0];
      unwrap(await supabaseClient.from('midias_veiculo').update({ principal: false }).eq('veiculo_id', vehicleId));
      unwrap(await supabaseClient.from('midias_veiculo').update({ principal: true }).eq('id', principalEscolhida.id));
    }

    return { enviadas: resultados.length - falhas.length, falhas: falhas.length };
  }

  function vehiclePayload(input, categoriaId, marcaId, carroceriaId) {
    return {
      categoria_id: categoriaId,
      marca_id: marcaId,
      carroceria_id: carroceriaId,
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
      reservado: !!input.reservado,
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
  const ORDENACOES = {
    'recentes': { column: 'created_at', ascending: false },
    'menor-preco': { column: 'preco', ascending: true },
    'maior-preco': { column: 'preco', ascending: false },
    'menor-km': { column: 'km', ascending: true },
    'ano-novo': { column: 'ano', ascending: false },
  };

  // Status do painel (Disponível/Reservado/Vendido/Indisponível) — traduzido
  // para a combinação equivalente de ativo/vendido/reservado, os 3 campos que
  // já existem no banco. Não é uma coluna própria: evita duplicar o estado
  // que ativo/vendido já representam.
  const STATUS_FILTROS = {
    disponivel: { ativo: true, vendido: false, reservado: false },
    reservado: { vendido: false, reservado: true },
    vendido: { vendido: true },
    indisponivel: { ativo: false, vendido: false, reservado: false },
  };

  async function getVehicles({
    page = 0, pageSize = 20, search = '', tipo = '', badge = '',
    ativo, vendido, reservado, status,
    comFoto = false, incompletos = false,
    marcaId = '', carroceriaId = '', cambio = '', combustivel = '', cor = '',
    precoMin, precoMax, anoMin, anoMax, kmMax,
    dataCadastroDe, dataCadastroAte, dataAtualizacaoDe, dataAtualizacaoAte, estoqueParadoDias,
    orderBy = 'recentes',
  } = {}) {
    // "midias_veiculo!inner" (em vez do embed normal) transforma o join em
    // INNER — só entram veículos com pelo menos uma foto — resolvido no
    // servidor, então funciona corretamente junto com a paginação (ao
    // contrário de filtrar depois de já ter baixado a página).
    const midiasEmbed = comFoto ? 'midias_veiculo!inner(id, url, principal, ordem)' : 'midias_veiculo(id, url, principal, ordem)';
    let query = supabaseClient
      .from('veiculos')
      .select(`*, marcas(nome), categorias(slug), carrocerias(slug, nome), ${midiasEmbed}`, { count: 'exact' });

    const ordenacao = ORDENACOES[orderBy] || ORDENACOES.recentes;
    query = query.order(ordenacao.column, { ascending: ordenacao.ascending });

    // "status" (painel) tem prioridade sobre ativo/vendido/reservado
    // explícitos, mas só substitui o que ele próprio define — ativo/vendido
    // continuam explícitos aqui (não só confiados ao RLS) porque esta mesma
    // função é usada tanto pelo painel (autenticado, vê tudo) quanto pelo
    // site público — sem isso, um gestor logado que abrisse o site público
    // no mesmo navegador veria também veículos ocultos/vendidos.
    const statusFiltro = (status && STATUS_FILTROS[status]) || {};
    const ativoFiltro = 'ativo' in statusFiltro ? statusFiltro.ativo : ativo;
    const vendidoFiltro = 'vendido' in statusFiltro ? statusFiltro.vendido : vendido;
    const reservadoFiltro = 'reservado' in statusFiltro ? statusFiltro.reservado : reservado;

    if (typeof ativoFiltro === 'boolean') query = query.eq('ativo', ativoFiltro);
    if (typeof vendidoFiltro === 'boolean') query = query.eq('vendido', vendidoFiltro);
    if (typeof reservadoFiltro === 'boolean') query = query.eq('reservado', reservadoFiltro);
    if (tipo) query = query.eq('categoria_id', await getCategoriaId(tipo));
    if (badge) query = query.eq('badge', badge);
    if (marcaId) query = query.eq('marca_id', marcaId);
    if (carroceriaId) query = query.eq('carroceria_id', carroceriaId);
    if (cambio) query = query.eq('cambio', cambio);
    if (combustivel) query = query.eq('combustivel', combustivel);
    if (cor) query = query.eq('cor', cor);
    if (typeof precoMin === 'number') query = query.gte('preco', precoMin);
    if (typeof precoMax === 'number') query = query.lte('preco', precoMax);
    if (typeof anoMin === 'number') query = query.gte('ano', anoMin);
    if (typeof anoMax === 'number') query = query.lte('ano', anoMax);
    if (typeof kmMax === 'number') query = query.lte('km', kmMax);
    if (dataCadastroDe) query = query.gte('created_at', `${dataCadastroDe}T00:00:00`);
    if (dataCadastroAte) query = query.lte('created_at', `${dataCadastroAte}T23:59:59.999`);
    if (dataAtualizacaoDe) query = query.gte('updated_at', `${dataAtualizacaoDe}T00:00:00`);
    if (dataAtualizacaoAte) query = query.lte('updated_at', `${dataAtualizacaoAte}T23:59:59.999`);

    // "Estoque parado": cadastrado há pelo menos N dias — só força
    // vendido=false se o chamador não tiver escolhido outro status
    // explicitamente (senão "parado + vendido" nunca bateria com nada).
    if (typeof estoqueParadoDias === 'number') {
      query = query.lte('created_at', new Date(Date.now() - estoqueParadoDias * 86400000).toISOString());
      if (typeof vendidoFiltro !== 'boolean') query = query.eq('vendido', false);
    }

    // Remove vírgulas/parênteses: têm significado estrutural no filtro
    // ".or()" do PostgREST e quebrariam a sintaxe se viessem do texto digitado.
    const termo = search.trim().replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (termo) {
      const marcasAchadas = unwrap(await supabaseClient.from('marcas').select('id').ilike('nome', `%${termo}%`));
      const partes = [`modelo.ilike.%${termo}%`, `placa.ilike.%${termo}%`, `cor.ilike.%${termo}%`];
      if (marcasAchadas.length) partes.push(`marca_id.in.(${marcasAchadas.map(m => m.id).join(',')})`);
      query = query.or(partes.join(','));
    }

    // "Dados incompletos" (sem foto, sem descrição ou preço zerado) — mesma
    // técnica de dois passos usada acima na busca textual: o PostgREST não
    // filtra diretamente por ausência de linhas relacionadas, então resolve
    // primeiro quem TEM foto e exclui esses ids no OR principal. Um segundo
    // ".or()" na mesma consulta funciona em AND com o de cima (cada um vira
    // um parâmetro "or" próprio, o PostgREST combina os parâmetros com AND).
    if (incompletos) {
      const comFotoRows = unwrap(await supabaseClient.from('midias_veiculo').select('veiculo_id'));
      const idsComFoto = Array.from(new Set(comFotoRows.map(r => r.veiculo_id)));
      const partesIncompletos = ['descricao.is.null', 'descricao.eq.', 'preco.eq.0'];
      if (idsComFoto.length) partesIncompletos.push(`id.not.in.(${idsComFoto.join(',')})`);
      query = query.or(partesIncompletos.join(','));
    }

    const from = page * pageSize;
    const { data, error, count } = await query.range(from, from + pageSize - 1);
    if (error) {
      // PGRST103 = faixa pedida além do fim do resultado (HTTP 416). Acontece
      // quando o total é múltiplo exato do tamanho da página e o painel pede a
      // página seguinte: em vez de quebrar a listagem inteira, devolve vazio.
      // O total é exatamente "from" — só se chega aqui quando não há nada além
      // do que já foi carregado —, então o botão "carregar mais" some sozinho.
      if (error.code === 'PGRST103') return { rows: [], total: from, page, pageSize };
      throw error;
    }
    return { rows: data.map(mapVehicleRow), total: count || 0, page, pageSize };
  }

  /** Busca um veículo específico pelo id — usado pelo link direto (?veiculo=) quando o veículo compartilhado não está na página atualmente carregada. Só retorna se estiver visível ao público (mesma regra do catálogo). */
  async function getVehicleById(id) {
    const select = '*, marcas(nome), categorias(slug), carrocerias(slug, nome), midias_veiculo(id, url, principal, ordem)';
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

  /** Quantos veículos há em cada aba da tela de Veículos. As combinações são
   * exatamente as de STATUS_FILTROS, então cada veículo cai em uma aba e só
   * uma — a soma das quatro é sempre o total do estoque. */
  async function getVehicleStatusCounts() {
    const contar = async (builder) => {
      const { count, error } = await builder;
      if (error) throw error;
      return count || 0;
    };
    const base = () => supabaseClient.from('veiculos').select('id', { count: 'exact', head: true });
    const aplicar = (filtros) => Object.entries(filtros).reduce((q, [col, val]) => q.eq(col, val), base());
    const chaves = Object.keys(STATUS_FILTROS);
    const valores = await Promise.all(chaves.map(k => contar(aplicar(STATUS_FILTROS[k]))));
    const counts = { todos: 0 };
    chaves.forEach((k, i) => { counts[k] = valores[i]; counts.todos += valores[i]; });
    return counts;
  }

  /** Retorna { id, updatedAt, fotos: { enviadas, falhas } } — o chamador usa
   * `id`/`updatedAt` para converter o formulário aberto em modo de edição e não
   * criar uma duplicata se o gestor clicar em Salvar de novo. */
  async function createVehicle(input) {
    const [categoriaId, marcaId, carroceriaId] = await Promise.all([getCategoriaId(input.tipo), ensureMarca(input.make), getCarroceriaId(input.carroceria)]);
    if (input.badge === 'destaque') await clearDestaque(null);
    const created = unwrap(await supabaseClient.from('veiculos').insert(vehiclePayload(input, categoriaId, marcaId, carroceriaId)).select('id, updated_at').single());
    let fotos = { enviadas: 0, falhas: 0 };
    try {
      if (input.images) fotos = await saveVehicleImages(created.id, input.images);
    } finally {
      // Registra a criação mesmo se as fotos derem problema — o veículo existe
      // a partir daqui, e um histórico sem esse registro foi o que escondeu o
      // cadastro duplicado do incidente de 31/08/2026.
      await logAction('criar', 'veiculo', created.id, { resumo: `cadastrou ${input.make} ${input.model}` });
    }
    return { id: created.id, updatedAt: created.updated_at, fotos };
  }

  /** Retorna { updatedAt, fotos: { enviadas, falhas } }. O `updatedAt` novo tem
   * de voltar para o formulário: como todo update grava um carimbo novo, manter
   * o antigo em tela fazia o clique seguinte bater em 0 linhas e acusar um
   * conflito de edição que nunca existiu. */
  async function updateVehicle(id, input) {
    const [categoriaId, marcaId, carroceriaId] = await Promise.all([getCategoriaId(input.tipo), ensureMarca(input.make), getCarroceriaId(input.carroceria)]);
    if (input.badge === 'destaque') await clearDestaque(id);

    let query = supabaseClient.from('veiculos').update(vehiclePayload(input, categoriaId, marcaId, carroceriaId)).eq('id', id);
    if (input.expectedUpdatedAt) query = query.eq('updated_at', input.expectedUpdatedAt);
    const { data, error } = await query.select('id, updated_at');
    if (error) throw error;
    if (input.expectedUpdatedAt && (!data || !data.length)) {
      // Recupera o carimbo atual e devolve junto do erro para o painel poder
      // se ressincronizar — sem isso o formulário ficava travado para sempre.
      const atual = unwrap(await supabaseClient.from('veiculos').select('updated_at').eq('id', id).maybeSingle());
      const err = new ConcurrencyError(atual
        ? 'Este veículo foi alterado depois que você abriu a edição. Recarregamos os dados — confira e clique em Salvar de novo.'
        : 'Este veículo não existe mais. Recarregue a lista.');
      err.updatedAt = atual ? atual.updated_at : null;
      throw err;
    }

    let fotos = { enviadas: 0, falhas: 0 };
    try {
      if (input.images) fotos = await saveVehicleImages(id, input.images);
    } finally {
      await logAction('atualizar', 'veiculo', id, { resumo: `atualizou ${input.make} ${input.model}` });
    }
    return { updatedAt: data[0].updated_at, fotos };
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

  /** Marca/desmarca um veículo como reservado — status intermediário do painel, não altera "ativo" (a visibilidade no site continua sendo decidida pelo toggle existente). */
  async function setVehicleReservado(id, reservado, label) {
    unwrap(await supabaseClient.from('veiculos').update({ reservado, updated_at: new Date().toISOString() }).eq('id', id));
    await logAction(reservado ? 'reservar' : 'atualizar', 'veiculo', id, {
      resumo: reservado ? `marcou ${label || 'um veículo'} como reservado` : `removeu a reserva de ${label || 'um veículo'}`,
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
      whatsapp_vendas: cfg.wppVendas,
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
      parcelamento_max_parcelas_carro: cfg.parcelamentoMaxParcelasCarro,
      parcelamento_max_parcelas_moto: cfg.parcelamentoMaxParcelasMoto,
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

    const [categoriaId, marcaId, carroceriaId] = await Promise.all([getCategoriaId(legacy.tipo), ensureMarca(legacy.make), getCarroceriaId('outros')]);
    if (legacy.badge === 'destaque') await clearDestaque(null);

    const payload = vehiclePayload(legacy, categoriaId, marcaId, carroceriaId);
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
      supabaseClient.from('veiculos').select('*, marcas(nome), categorias(slug), midias_veiculo(url, principal, ordem)').order('created_at'),
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
    // Backups antigos (anteriores a este recurso) não têm "carroceria" — cai em "outros", igual à migração do estoque já cadastrado.
    const [categoriaId, marcaId, carroceriaId] = await Promise.all([getCategoriaId(v.tipo), ensureMarca(v.make), getCarroceriaId(v.carroceria || 'outros')]);
    const payload = {
      id: v.id,
      categoria_id: categoriaId,
      marca_id: marcaId,
      carroceria_id: carroceriaId,
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
      reservado: !!v.reservado,
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
    getVehicleStatusCounts,
    getVehicleById,
    getMarcasDisponiveis,
    getCoresDisponiveis,
    getCategorias,
    getCarrocerias,
    createVehicle,
    updateVehicle,
    deleteVehicle,
    toggleVehicleAtivo,
    setVehicleVendido,
    setVehicleReservado,
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
    compressImage,
  };
})();
