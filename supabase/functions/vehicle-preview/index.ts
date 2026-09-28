// supabase/functions/vehicle-preview/index.ts
//
// Links antigos: antes das páginas próprias por veículo (api/veiculo.js, no
// domínio da loja), o botão "Copiar link" do site apontava pra esta Edge
// Function, que ainda pode estar em posts/mensagens já enviados por aí. Ela
// não gera mais o preview em si — só redireciona quem clicar num link antigo
// pra página nova (/veiculo/<slug>, ou ?veiculo=<id> se o veículo ainda não
// tiver slug). Ver README → "Preview ao compartilhar" para o histórico.
//
// Continua servindo um preview OG/Twitter Card básico durante o brevíssimo
// instante do redirect, pro caso de algum rastreador ler esta página em vez
// de seguir o redirect — mas quem faz esse trabalho de verdade agora é
// api/veiculo.js, que roda no próprio domínio da loja.
//
// Rota pública, sem verificação de JWT (verify_jwt=false no deploy) —
// precisa ser alcançável por qualquer rastreador/visitante sem login, e só
// devolve dados de veículos que já são públicos no site (mesma regra de
// RLS: ativo=true e vendido=false).
//
// URL: https://<project>.supabase.co/functions/v1/vehicle-preview/<id>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://bqtfnnglwampyijmwdgm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vaitarKonQCntB4mmzltLg_UMYpWaV3';
const SITE_URL = 'https://www.holandamotors.com.br/';
const DEFAULT_IMAGE = SITE_URL + 'assets/img/og-holanda.jpg';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function escapeHtml(str: unknown): string {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function formatPrice(n: number): string {
  return 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function pageHtml(opts: { title: string; description: string; image: string; redirectTo: string }): string {
  const { title, description, image, redirectTo } = opts;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0; url=${escapeHtml(redirectTo)}">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="Holanda Motors">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${escapeHtml(redirectTo)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
</head>
<body>
<p>Redirecionando para <a href="${escapeHtml(redirectTo)}">Holanda Motors</a>…</p>
<script>location.replace(${JSON.stringify(redirectTo)});</script>
</body>
</html>`;
}

function respond(html: string): Response {
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  const id = last && last !== 'vehicle-preview' ? last : '';

  if (!id) {
    return respond(pageHtml({
      title: 'Holanda Motors — Carros e Motos em Sobral, CE',
      description: 'Carros e motos seminovos com qualidade de showroom, atendimento transparente e o melhor preço de Sobral.',
      image: DEFAULT_IMAGE,
      redirectTo: SITE_URL,
    }));
  }

  const { data: veiculo } = await supabase
    .from('veiculos')
    .select('modelo, ano, km, cambio, preco, slug, marcas(nome), midias_veiculo(url, principal)')
    .eq('id', id)
    .eq('ativo', true)
    .eq('vendido', false)
    .maybeSingle();

  // Com slug (veículo já migrado): manda pra página própria no domínio da
  // loja. Sem slug (ainda não rodou o backfill): cai no link antigo, que o
  // site público continua sabendo abrir (?veiculo=<id>).
  const redirectTo = veiculo?.slug ? `${SITE_URL}veiculo/${veiculo.slug}` : `${SITE_URL}?veiculo=${encodeURIComponent(id)}`;

  if (!veiculo) {
    // Veículo não existe, foi vendido ou ocultado — manda pro estoque geral
    // em vez de mostrar um preview de algo que não está mais disponível.
    return respond(pageHtml({
      title: 'Holanda Motors — Carros e Motos em Sobral, CE',
      description: 'Esse veículo não está mais disponível — confira o restante do nosso estoque.',
      image: DEFAULT_IMAGE,
      redirectTo: SITE_URL,
    }));
  }

  const marca = (veiculo.marcas as unknown as { nome: string } | null)?.nome || '';
  const fotos = (veiculo.midias_veiculo as Array<{ url: string; principal: boolean }>) || [];
  const principal = fotos.find((f) => f.principal) || fotos[0];
  const titulo = `${marca} ${veiculo.modelo} — ${formatPrice(veiculo.preco)} | Holanda Motors`;
  const descricao = `${veiculo.ano} • ${Number(veiculo.km || 0).toLocaleString('pt-BR')} km • ${veiculo.cambio || ''}. Confira esse e outros veículos na Holanda Motors, Sobral - CE.`;

  return respond(pageHtml({
    title: titulo,
    description: descricao,
    image: principal ? principal.url : DEFAULT_IMAGE,
    redirectTo,
  }));
});
