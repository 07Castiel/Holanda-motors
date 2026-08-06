// supabase/functions/vehicle-preview/index.ts
//
// Gera uma página com tags Open Graph/Twitter Card específicas de um
// veículo (foto, título, preço) para rastreadores que NÃO executam
// JavaScript (WhatsApp, Instagram, Facebook, Telegram...). O site em si
// (index.html) é 100% client-side — os dados só existem depois que o JS
// roda — então esses rastreadores nunca veriam o preview certo se
// apontassem direto pra lá.
//
// Um visitante de verdade (navegador) é redirecionado quase
// instantaneamente para o site real via <meta http-equiv="refresh"> + um
// fallback em JS. Rastreadores só leem o <head> e param por aí — é por
// isso que funciona sem precisar identificar quem é rastreador e quem é
// gente (nenhum dos dois lados precisa de tratamento especial).
//
// Rota pública, sem verificação de JWT (verify_jwt=false no deploy) —
// precisa ser alcançável por qualquer rastreador/visitante sem login, e
// só devolve dados de veículos que já são públicos no site (mesma regra
// de RLS: ativo=true e vendido=false).
//
// URL: https://<project>.supabase.co/functions/v1/vehicle-preview/<id>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://bqtfnnglwampyijmwdgm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vaitarKonQCntB4mmzltLg_UMYpWaV3';
const SITE_URL = 'https://07castiel.github.io/Holanda-motors/';
const DEFAULT_IMAGE = SITE_URL + 'fachada.PNG';

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
    .select('modelo, ano, km, cambio, preco, marcas(nome), midias_veiculo(url, principal)')
    .eq('id', id)
    .eq('ativo', true)
    .eq('vendido', false)
    .maybeSingle();

  const redirectTo = `${SITE_URL}?veiculo=${encodeURIComponent(id)}`;

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
