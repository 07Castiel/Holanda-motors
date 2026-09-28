// api/veiculo.js — página própria de cada veículo (/veiculo/:slug), servida
// pela Vercel. Site estático, sem build: função Node "pura" (sem dependências
// no front nem aqui), fala direto com o REST do Supabase via fetch nativo.
//
// Por quê: rastreadores de link (WhatsApp, Google) e o próprio Google não
// executam o JavaScript do site público — sem isto, nenhum veículo teria uma
// URL própria indexável nem um preview com foto/preço ao compartilhar.
//
// O RLS de "veiculos" (supabase/schema.sql) já só expõe veículos com
// ativo=true e vendido=false pra quem não está autenticado — a chave usada
// aqui é a mesma "anon" pública do front, então não é preciso repetir esse
// filtro na consulta: veículo inexistente, vendido ou oculto simplesmente não
// vem na resposta, e os três casos caem no mesmo 404 abaixo.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bqtfnnglwampyijmwdgm.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_vaitarKonQCntB4mmzltLg_UMYpWaV3';
const SITE_URL = 'https://www.holandamotors.com.br';
const DEFAULT_IMAGE = SITE_URL + '/assets/img/og-holanda.jpg';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** JSON-LD vai dentro de um <script>: escapar "<" evita que um texto como "</script>" vindo do banco (descrição, modelo...) feche a tag mais cedo. */
function jsonLdSafe(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function formatPrice(n) {
  return 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function wppLink(message, numero) {
  return `https://wa.me/${numero}?text=${encodeURIComponent(message)}`;
}

async function restGet(path) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!resp.ok) throw new Error(`Supabase REST ${resp.status} em ${path}`);
  return resp.json();
}

/** Tamanho real do arquivo, pra decidir se precisa passar pelo otimizador de imagem da Vercel antes de virar og:image (WhatsApp costuma não mostrar preview de imagens grandes demais). null = não deu pra medir (trata como "grande demais", por segurança). */
async function tamanhoDoArquivo(url) {
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    const len = resp.headers.get('content-length');
    return len ? Number(len) : null;
  } catch (err) {
    return null;
  }
}

const VEICULO_SELECT = 'id,modelo,ano,km,preco,cambio,combustivel,cor,placa,descricao,reservado,slug,updated_at,' +
  'marcas(nome),categorias(slug),carrocerias(slug),midias_veiculo(url,principal,ordem)';

function paginaNaoEncontrada(res) {
  res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Veículo não encontrado | Holanda Motors</title>
<link rel="stylesheet" href="/assets/css/base.css?v=5">
<link rel="stylesheet" href="/assets/css/site.css?v=8">
</head>
<body>
<main style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 20px;gap:20px">
  <h1 style="font-family:var(--font-display);font-size:32px;text-transform:uppercase">Veículo indisponível</h1>
  <p style="color:var(--gray-light);max-width:420px">Esse veículo já foi vendido ou não está mais disponível.</p>
  <a href="/#estoque" class="btn-primary">Ver todo o estoque</a>
</main>
</body>
</html>`);
}

module.exports = async (req, res) => {
  const slugOuId = String(req.query.slug || '');
  if (!slugOuId) return paginaNaoEncontrada(res);

  try {
    if (UUID_RE.test(slugOuId)) {
      const rows = await restGet(`veiculos?id=eq.${slugOuId}&select=slug&limit=1`);
      if (rows[0] && rows[0].slug) {
        res.writeHead(301, { Location: `/veiculo/${rows[0].slug}` });
        return res.end();
      }
      return paginaNaoEncontrada(res);
    }

    const [veiculos, configRows] = await Promise.all([
      restGet(`veiculos?slug=eq.${encodeURIComponent(slugOuId)}&select=${VEICULO_SELECT}&limit=1`),
      restGet('configuracoes_loja?id=eq.1&select=whatsapp,whatsapp_vendas,botao_whatsapp_flutuante&limit=1'),
    ]);
    const v = veiculos[0];
    if (!v) return paginaNaoEncontrada(res);

    const cfg = configRows[0] || { whatsapp: '', whatsapp_vendas: '', botao_whatsapp_flutuante: true };
    const wppVendas = cfg.whatsapp_vendas || cfg.whatsapp;

    const marca = v.marcas ? v.marcas.nome : '';
    const categoriaSlug = v.categorias ? v.categorias.slug : 'carro';
    const carroceriaNome = v.carrocerias ? v.carrocerias.slug : '';
    const fotos = (v.midias_veiculo || []).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    const principal = fotos.find((f) => f.principal) || fotos[0];

    let ogImage = principal ? principal.url : DEFAULT_IMAGE;
    if (principal) {
      const bytes = await tamanhoDoArquivo(principal.url);
      if (bytes === null || bytes > 300 * 1024) {
        ogImage = `${SITE_URL}/_vercel/image?url=${encodeURIComponent(principal.url)}&w=1200&q=75`;
      }
    }

    const titulo = `${marca} ${v.modelo} ${v.ano} em Sobral-CE | Holanda Motors`;
    const descricaoMeta = `${v.ano} • ${Number(v.km || 0).toLocaleString('pt-BR')} km • ${v.cambio || ''} • ${v.combustivel || ''} • ${formatPrice(v.preco)}. Confira na Holanda Motors, Sobral - CE.`;
    const canonical = `${SITE_URL}/veiculo/${v.slug}`;
    const wppMsg = `Olá! Vi o ${marca} ${v.modelo} no site da Holanda Motors e gostaria de saber mais!`;
    const wppMsgGeral = 'Olá! Vim pelo site e gostaria de saber mais sobre os veículos da Holanda Motors.';

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': categoriaSlug === 'moto' ? 'Motorcycle' : 'Car',
      brand: { '@type': 'Brand', name: marca },
      model: v.modelo,
      vehicleModelDate: String(v.ano),
      mileageFromOdometer: { '@type': 'QuantitativeValue', value: v.km, unitCode: 'KMT' },
      vehicleTransmission: v.cambio || undefined,
      fuelType: v.combustivel || undefined,
      color: v.cor || undefined,
      image: fotos.map((f) => f.url),
      offers: {
        '@type': 'Offer',
        price: Number(v.preco) || 0,
        priceCurrency: 'BRL',
        availability: 'https://schema.org/InStock',
        itemCondition: 'https://schema.org/UsedCondition',
        seller: { '@type': 'AutoDealer', name: 'Holanda Motors', url: SITE_URL },
      },
    };

    const galeriaHtml = fotos.length
      ? [
          `<img class="veiculo-gallery-principal" src="${escapeHtml(fotos[0].url)}" alt="${escapeHtml(marca + ' ' + v.modelo)}" fetchpriority="high">`,
          fotos.length > 1
            ? `<div class="veiculo-gallery-thumbs">${fotos.slice(1).map((f, i) => `<img src="${escapeHtml(f.url)}" alt="${escapeHtml(marca + ' ' + v.modelo)} — foto ${i + 2}" loading="lazy">`).join('')}</div>`
            : '',
        ].join('\n')
      : '<div class="veiculo-gallery-empty">Sem foto disponível</div>';

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(titulo)}</title>
<meta name="description" content="${escapeHtml(descricaoMeta)}">
<link rel="canonical" href="${escapeHtml(canonical)}">

<meta property="og:type" content="product">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="Holanda Motors">
<meta property="og:title" content="${escapeHtml(titulo)}">
<meta property="og:description" content="${escapeHtml(descricaoMeta)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(titulo)}">
<meta name="twitter:description" content="${escapeHtml(descricaoMeta)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">

<script type="application/ld+json">${jsonLdSafe(jsonLd)}</script>

<link rel="icon" type="image/png" sizes="32x32" href="/assets/img/favicon-32.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@300;400;500;600;700&family=Barlow+Condensed:wght@400;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/base.css?v=5">
<link rel="stylesheet" href="/assets/css/site.css?v=8">
<link rel="stylesheet" href="/assets/css/veiculo.css?v=1">
</head>
<body data-veiculo-id="${escapeHtml(v.id)}">

<header id="header">
  <a href="/#inicio" class="logo-mark" aria-label="Holanda Motors — ir para o início">
    <img src="/assets/img/logo-holanda.png" alt="Holanda Motors" width="872" height="208">
  </a>
  <nav aria-label="Principal">
    <a href="/#inicio">Início</a>
    <a href="/#estoque">Estoque</a>
    <a href="/#consignacao">Consignação</a>
    <a href="/#sobre">Sobre</a>
    <a href="/#contato">Contato</a>
  </nav>
  <a href="${escapeHtml(wppLink(wppMsgGeral, cfg.whatsapp))}" target="_blank" class="btn-wpp" data-wpp-local="header">
    <svg class="icon-wpp" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
    Fale no WhatsApp
  </a>
</header>

<main id="conteudo" class="veiculo-main">
  <nav class="veiculo-breadcrumb" aria-label="Breadcrumb">
    <a href="/">Início</a> › <a href="/#estoque">Estoque</a> › <span aria-current="page">${escapeHtml(marca)} ${escapeHtml(v.modelo)}</span>
  </nav>

  <div class="veiculo-layout">
    <div class="veiculo-gallery">${galeriaHtml}</div>

    <div class="veiculo-info">
      <p class="modal-make">${escapeHtml(marca)}${carroceriaNome ? ' · ' + escapeHtml(carroceriaNome) : ''}</p>
      <h1 class="modal-model">${escapeHtml(v.modelo)}</h1>
      ${v.reservado ? '<span class="badge badge-reservado" style="margin-bottom:12px;display:inline-block">Reservado</span>' : ''}
      <ul class="modal-specs">
        <li class="modal-spec"><label>Ano</label><span>${v.ano}</span></li>
        <li class="modal-spec"><label>Quilometragem</label><span>${Number(v.km || 0).toLocaleString('pt-BR')} km</span></li>
        <li class="modal-spec"><label>Câmbio</label><span>${escapeHtml(v.cambio || '—')}</span></li>
        <li class="modal-spec"><label>Combustível</label><span>${escapeHtml(v.combustivel || '—')}</span></li>
        <li class="modal-spec"><label>Cor</label><span>${escapeHtml(v.cor || '—')}</span></li>
        <li class="modal-spec"><label>Tipo</label><span>${categoriaSlug === 'moto' ? 'Moto' : 'Carro'}</span></li>
      </ul>
      <p class="modal-price">${escapeHtml(formatPrice(v.preco))}</p>
      ${v.descricao ? `<p class="veiculo-desc">${escapeHtml(v.descricao)}</p>` : ''}
      <div class="modal-actions veiculo-actions">
        <a href="${escapeHtml(wppLink(wppMsg, wppVendas))}" target="_blank" class="btn-primary" data-wpp-local="pagina_veiculo" data-wpp-veiculo="${escapeHtml(v.id)}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          Tenho interesse
        </a>
        <a href="/#estoque" class="btn-outline">Ver todo o estoque</a>
      </div>
    </div>
  </div>
</main>

<footer>
  <div class="footer-inner">
    <div class="footer-logo">
      <img src="/assets/img/logo-holanda.png" alt="Holanda Motors" width="872" height="208" loading="lazy">
    </div>
    <ul class="footer-nav">
      <li><a href="/#inicio">Início</a></li>
      <li><a href="/#estoque">Estoque</a></li>
      <li><a href="/#consignacao">Consignação</a></li>
      <li><a href="/#sobre">Sobre</a></li>
      <li><a href="/#contato">Contato</a></li>
    </ul>
    <p class="footer-copy">Site desenvolvido por <span class="footer-ntech">Núcleo Tech</span> · Sobral, CE</p>
  </div>
</footer>

${cfg.botao_whatsapp_flutuante ? `<a href="${escapeHtml(wppLink(wppMsgGeral, cfg.whatsapp))}" target="_blank" class="float-wpp" aria-label="Falar no WhatsApp" data-wpp-local="flutuante">
  <svg width="28" height="28" viewBox="0 0 24 24" fill="white" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
</a>` : ''}

<script src="/assets/js/rastreio.js?v=1" defer></script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).end(html);
  } catch (err) {
    console.error('[api/veiculo] Falha ao montar a página do veículo.', err);
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="robots" content="noindex"><title>Erro | Holanda Motors</title></head><body><p>Não foi possível carregar esta página agora. <a href="/#estoque">Voltar ao estoque</a>.</p></body></html>');
  }
};
