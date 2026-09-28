// api/sitemap.js — /sitemap.xml: home + cada veículo público (/veiculo/:slug).
// Mesma ideia de api/veiculo.js: função Node sem dependências, fala direto
// com o REST do Supabase. O RLS de "veiculos" já só devolve ativo=true e
// vendido=false pra quem não está autenticado (chave anon), então a lista
// aqui já sai só com o que pode aparecer no Google.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bqtfnnglwampyijmwdgm.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_vaitarKonQCntB4mmzltLg_UMYpWaV3';
const SITE_URL = 'https://www.holandamotors.com.br';

function escapeXml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

module.exports = async (req, res) => {
  let veiculos = [];
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/veiculos?select=slug,updated_at&slug=not.is.null&order=updated_at.desc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (resp.ok) veiculos = await resp.json();
  } catch (err) {
    console.error('[api/sitemap] Falha ao buscar veículos para o sitemap.', err);
    // Segue com a lista vazia: o sitemap ainda sai válido, só sem os veículos
    // desta vez — melhor do que devolver 500 e o Google descartar tudo.
  }

  const urls = [
    `  <url>\n    <loc>${SITE_URL}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`,
    ...veiculos.map((v) => {
      const lastmod = v.updated_at ? new Date(v.updated_at).toISOString().slice(0, 10) : '';
      return `  <url>\n    <loc>${SITE_URL}/veiculo/${escapeXml(v.slug)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`;
    }),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600');
  res.status(200).end(xml);
};
