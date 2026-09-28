# Holanda Motors — Site + Painel do Gestor

Site institucional e painel administrativo para a **Holanda Motors**, concessionária de carros e motos em Sobral, Ceará. Projeto desenvolvido pela **Núcleo Tech**, com estoque de veículos, consignação, e um painel de gestão com CRUD completo. O front-end é 100% estático (HTML/CSS/JS, sem build) e o backend é o **Supabase** (Postgres + Auth + Storage).

**[→ Ver demonstração ao vivo](#)** *(link do GitHub Pages, depois de publicado — veja [Publicando no GitHub Pages](#publicando-no-github-pages))*

---

## Índice

- [Descrição do projeto](#descrição-do-projeto)
- [Tecnologias utilizadas](#tecnologias-utilizadas)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Modelo de dados](#modelo-de-dados)
- [Configurando o Supabase do zero](#configurando-o-supabase-do-zero)
- [Como executar o projeto localmente](#como-executar-o-projeto-localmente)
- [Migrando dados antigos do localStorage](#migrando-dados-antigos-do-localstorage)
- [Como funcionam os arquivos principais](#como-funcionam-os-arquivos-principais)
- [Páginas de veículo e SEO](#páginas-de-veículo-e-seo)
- [Medição de desempenho](#medição-de-desempenho)
- [Preview ao compartilhar (Edge Function)](#preview-ao-compartilhar-edge-function)
- [Publicando no GitHub Pages](#publicando-no-github-pages)
- [Como adicionar novos administradores](#como-adicionar-novos-administradores)
- [Níveis de acesso](#níveis-de-acesso)
- [Backup e restauração](#backup-e-restauração)
- [Limitações conhecidas](#limitações-conhecidas)
- [Licença](#licença)

---

## Descrição do projeto

O projeto tem duas frentes que conversam entre si através do Supabase:

1. **`index.html`** — o site público. Catálogo de veículos com filtros, seção de consignação, sobre a loja, contato e botões de WhatsApp prontos.
2. **`/admin/`** — o painel do gestor. Login real (Supabase Auth), dashboard com métricas, CRUD completo de veículos (com upload de foto para o Supabase Storage), gestão de consignações e configurações da loja.

Qualquer alteração feita no painel (adicionar um veículo, trocar uma foto, mudar o WhatsApp da loja) aparece automaticamente no site público na próxima vez que a página for carregada — sem precisar editar código, e agora **sincronizado entre qualquer dispositivo/navegador**, já que os dados vivem no banco, não mais no navegador de cada um.

O painel também traz: upload de várias fotos por veículo (com compactação automática antes do envio), busca instantânea por marca/modelo/placa, listas com carregamento incremental ("carregar mais"), histórico de alterações por veículo, log completo de ações dos usuários, níveis de acesso (administrador/gerente/vendedor) e backup/restauração dos dados direto pela tela de Configurações.

## Tecnologias utilizadas

- **HTML5** semântico, com atributos ARIA para acessibilidade
- **CSS3** puro (sem frameworks) — variáveis nativas, Grid e Flexbox
- **JavaScript** vanilla (ES6+, assíncrono), sem bundler — o SDK do Supabase é carregado via CDN
- **[Supabase](https://supabase.com)**: Postgres (banco), Auth (login do painel) e Storage (fotos dos veículos)
- **[Vercel](https://vercel.com)**: hospedagem (domínio `www.holandamotors.com.br`) e duas funções serverless em Node, sem dependências (`api/veiculo.js`, `api/sitemap.js`) — ver [Páginas de veículo e SEO](#páginas-de-veículo-e-seo)
- **Google Fonts** (Barlow / Barlow Condensed)

Não há etapa de build, bundler ou transpilação — os arquivos rodam exatamente como estão, direto no navegador. Isso é intencional para manter a compatibilidade com o GitHub Pages.

## Estrutura de pastas

```
holanda-motors/
├── index.html                    # Site público
├── admin.html                    # Redireciona para /admin/ (compatibilidade com o endereço antigo)
├── admin/
│   └── index.html                # Painel do gestor (URL final: /admin/)
├── migrar-localstorage.html      # Ferramenta temporária de migração, idempotente (ver seção própria) — apague após o uso
├── robots.txt                    # Libera o site, bloqueia /admin/ e a migração, aponta pro sitemap
├── vercel.json                   # Rewrites (/veiculo/:slug, /sitemap.xml) e otimização de imagem
├── README.md
├── .nojekyll                     # Evita processamento Jekyll no GitHub Pages
├── api/
│   ├── veiculo.js                # Função da Vercel: página própria de cada veículo (ver "Páginas de veículo e SEO")
│   └── sitemap.js                # Função da Vercel: /sitemap.xml
├── supabase/
│   ├── schema.sql                # Script único: tabelas, RLS, Storage e dados iniciais
│   └── functions/
│       └── vehicle-preview/
│           └── index.ts          # Edge Function: redireciona links antigos (ver seção própria)
└── assets/
    ├── css/
    │   ├── base.css               # Variáveis, reset, botões e badges compartilhados
    │   ├── site.css                # Estilos exclusivos do site público
    │   ├── veiculo.css               # Só o que falta na página de veículo além de base.css/site.css
    │   └── admin.css                 # Estilos exclusivos do painel do gestor
    └── js/
        ├── supabase-client.js         # Instância única do client Supabase (URL + chave anon)
        ├── data.js                     # Camada de dados compartilhada — fonte única de verdade
        ├── rastreio.js                  # Medição de visitas/origem/WhatsApp (ver "Medição de desempenho")
        ├── site.js                       # Lógica do site público
        └── admin.js                       # Lógica do painel do gestor
```

## Modelo de dados

Tabelas criadas por `supabase/schema.sql`:

| Tabela | Descrição |
|---|---|
| `categorias` | Tipos de veículo (carro, moto). Semeada automaticamente pelo script. |
| `marcas` | Marcas dos veículos. O painel cria uma marca nova automaticamente ao cadastrar um veículo com uma marca ainda não existente. |
| `veiculos` | Estoque — modelo, ano, km, preço, câmbio, combustível, cor, placa, badge (seminovo/consignado/destaque), `ativo` (visível no site) e `vendido` (status comercial — marcar como vendido também oculta do site). |
| `midias_veiculo` | Fotos dos veículos (uma ou várias por veículo) — arquivo fica no Supabase Storage (bucket `veiculos-fotos`), esta tabela guarda o caminho, a URL pública e qual é a foto "principal" (capa). |
| `consignacoes` | Veículos consignados por terceiros — dono, contato, valor pedido, status, comissão. Nunca é exposta ao público (RLS). |
| `configuracoes_loja` | Linha única com os dados da loja (endereço, WhatsApp, horários, textos, preferências de exibição do site). |
| `logs_acoes` | Trilha de auditoria — toda ação de escrita do painel gera uma linha aqui (quem, o quê, quando). É a fonte tanto do feed "Atividade recente" do dashboard quanto do histórico por veículo e da tela de Logs. Somente leitura depois de gravada (sem política de update/delete). |
| `usuarios` | Perfil de cada administrador (nome, e-mail, **nível de acesso**), vinculada 1:1 ao usuário do Supabase Auth. A senha em si nunca fica nesta tabela. Preenchida automaticamente por um gatilho quando um usuário é criado no Auth — veja [Níveis de acesso](#níveis-de-acesso). |
| `interacoes_veiculo` | Um evento por "visualização" (abriu o modal de detalhes) ou clique em WhatsApp — alimenta a coluna "Interesse" na tabela de veículos e o "Mais vistos" do dashboard. Insert público (o site é anônimo); a leitura continua restrita a quem está autenticado, então nenhum visitante vê os números de ninguém. Sem limitação de taxa — ver [Limitações conhecidas](#limitações-conhecidas). |
| `eventos_site` | Medição de tráfego do site (visitas, origem, cliques em WhatsApp) — ver [Medição de desempenho](#medição-de-desempenho). Também com insert público e leitura restrita (só gerente/administrador, e sem nenhum dado pessoal). |

A tabela `atividades` da primeira versão da migração ainda existe no banco (por compatibilidade, nada foi apagado), mas não é mais usada — foi substituída por `logs_acoes`, que registra a mesma informação de forma estruturada e com autoria.

`veiculos` e `consignacoes` também têm uma coluna `legacy_id` (com índice único parcial), preenchida só quando o registro veio da ferramenta de migração — é o que permite rodar `migrar-localstorage.html` mais de uma vez sem duplicar dados. Registros cadastrados normalmente pelo painel simplesmente não usam essa coluna.

**Row Level Security (RLS):** todas as tabelas têm RLS ativado. `categorias`, `marcas`, `veiculos` (só os `ativo = true` e `vendido = false`), `midias_veiculo` e `configuracoes_loja` podem ser **lidas** por qualquer visitante (é o que o site público usa) — mas só um usuário autenticado pode escrever, e excluir veículos/consignações ou alterar configurações exige nível **gerente** ou **administrador**. `consignacoes` (leitura/escrita), `logs_acoes` e `usuarios` exigem autenticação até para leitura. As políticas completas estão em `supabase/schema.sql`.

**Índices:** além dos índices de chave estrangeira, o banco tem índices de trigrama (`pg_trgm`) em `veiculos.modelo` e `veiculos.placa` para a busca instantânea do painel continuar rápida conforme o estoque cresce, e índices simples em `vendido`, `marca_id`, `logs_acoes.entidade`/`entidade_id`/`created_at`.

## Configurando o Supabase do zero

1. **Crie uma conta** em [supabase.com](https://supabase.com) (pode entrar com GitHub).
2. **Crie um novo projeto**: no dashboard, clique em **New Project**, escolha um nome (ex: `holanda-motors`), uma senha para o banco (guarde-a — é diferente da senha de login do painel) e a região mais próxima (ex: South America). Aguarde alguns minutos até o projeto ficar pronto.
3. **Execute o script SQL**: no menu lateral, vá em **SQL Editor → New query**, cole o conteúdo inteiro de [`supabase/schema.sql`](supabase/schema.sql) deste projeto e clique em **Run**. Isso cria todas as tabelas, ativa o RLS, cria o bucket de fotos e semeia as categorias/marcas/config padrão. O script é idempotente — se você atualizar o projeto no futuro e o arquivo mudar, pode colar e rodar de novo sem medo de duplicar nada.
4. **Pegue as chaves da API**: vá em **Project Settings → API**. Você vai precisar de:
   - **Project URL** (algo como `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public key** (uma chave longa, começando com `eyJ...`)

   > Essa chave `anon` é **pública por desenho do Supabase** — ela vai para o código do site sem problema, porque quem realmente protege os dados são as políticas de RLS do passo 3, não o sigilo da chave. Nunca use a chave `service_role` no front-end.
5. **Configure o projeto**: abra [`assets/js/supabase-client.js`](assets/js/supabase-client.js) e substitua:
   ```js
   const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
   const SUPABASE_ANON_KEY = 'SUA-CHAVE-ANON-PUBLICA-AQUI';
   ```
   pelos valores do passo 4.
6. **Crie o primeiro usuário administrador**: no dashboard, vá em **Authentication → Users → Add user → Create new user**. Preencha um e-mail e senha (essas serão as credenciais de login do painel) e marque **Auto Confirm User**. Um gatilho no banco cria automaticamente o perfil correspondente em `usuarios` — e **o primeiro usuário criado no projeto vira "administrador" automaticamente** (os seguintes entram como "vendedor" por padrão, promovíveis depois na tela Usuários do painel). Veja também [Como adicionar novos administradores](#como-adicionar-novos-administradores) e [Níveis de acesso](#níveis-de-acesso).

Pronto — o projeto está conectado ao seu Supabase.

## Como executar o projeto localmente

Como o SDK do Supabase é carregado como módulo de script, o navegador precisa servir os arquivos por HTTP (não por `file://`). Sirva a pasta com um servidor local simples:

Com Python (já vem instalado na maioria dos sistemas):
```bash
cd holanda-motors
python3 -m http.server 8000
```
Acesse `http://localhost:8000` (site) e `http://localhost:8000/admin/` (painel).

Com Node.js:
```bash
npx serve .
```

## Migrando dados antigos do localStorage

Se você usou uma versão anterior deste projeto (antes da migração para Supabase) e ainda tem veículos/consignações/configurações salvos no `localStorage` de algum navegador, use a ferramenta **`migrar-localstorage.html`**, incluída na raiz do projeto.

> **Importante:** o `localStorage` é isolado por domínio. Se o site antigo rodava no GitHub Pages (`https://SEU-USUARIO.github.io/holanda-motors/`), os dados só existem *nesse* domínio — abrir a ferramenta em `localhost` não vai encontrar nada. Publique a atualização no GitHub Pages primeiro (veja [Publicando no GitHub Pages](#publicando-no-github-pages)) e rode a migração **direto na URL publicada**, no mesmo navegador/computador onde o painel antigo era usado.

1. Acesse `https://SEU-USUARIO.github.io/holanda-motors/migrar-localstorage.html`.
2. Entre com o e-mail/senha do administrador (criado no passo 6 de [Configurando o Supabase do zero](#configurando-o-supabase-do-zero)) — a migração escreve no banco, então exige uma sessão autenticada, assim como o painel.
3. A página mostra quantos veículos, consignações e a configuração da loja foram encontrados no `localStorage` deste domínio.
4. Clique em **Migrar agora** — acompanhe pela barra de progresso. Cada veículo/consignação é enviado ao Supabase (fotos em Base64 são comprimidas e enviadas ao Storage; marcas e categorias que não existirem são criadas automaticamente) e um relatório final mostra quantos foram criados, quantos já existiam e quantos falharam (com o motivo de cada falha).
5. **É seguro rodar de novo:** cada registro migrado grava o id original do sistema antigo (`legacy_id`) — rodar a migração outra vez detecta o que já foi importado e pula, em vez de duplicar. Isso também significa que, se algo falhar, basta clicar em "Migrar agora" de novo — só o que falhou é tentado outra vez.
6. Limpar o `localStorage` deste navegador ao final é opcional (item 5 da página) — como a migração é idempotente, não há problema em deixar os dados antigos aí por enquanto.
7. Quando não precisar mais migrar nada, apague o arquivo `migrar-localstorage.html` do projeto (ele não deve ficar em produção indefinidamente).

> A senha do painel antigo (`hm_pass`) **não é migrada** — ela não existe mais no novo sistema. As credenciais agora são o e-mail/senha do administrador criado no Supabase Auth.

## Como funcionam os arquivos principais

### `assets/js/supabase-client.js`

Cria a instância única do client Supabase (`supabaseClient`), a partir da URL e da chave `anon` do seu projeto.

> A Edge Function `vehicle-preview` (ver [Preview ao compartilhar](#preview-ao-compartilhar-edge-function)) roda em outro runtime (Deno, não o navegador) e por isso mantém sua própria cópia fixa da mesma URL e chave `anon`. Se você trocar de projeto Supabase, atualize os dois arquivos.

### `assets/js/data.js` (a peça que conecta tudo)

Fonte única de verdade. Expõe um objeto global `HM` com funções como `HM.getVehicles()`, `HM.createVehicle()`, `HM.getConfig()`, `HM.login()` etc. — todas assíncronas (retornam `Promise`). Tanto `site.js` quanto `admin.js` usam **apenas** essas funções para acessar dados; nenhum dos dois fala com o Supabase diretamente. Isso é o que garante que os dois fiquem sempre sincronizados.

### `index.html` (site público) + `assets/js/site.js`

Ao carregar, busca a configuração da loja e o veículo em destaque (uma única consulta leve, não o catálogo inteiro) para montar o hero. O catálogo é paginado: carrega a primeira leva de veículos ativos e mostra "Carregar mais veículos" no final da grade; trocar o filtro (Carros/Motos/Consignados), marca, faixa de preço ou ordenação refaz a busca no servidor em vez de filtrar uma lista já baixada. O modal de detalhes mostra todas as fotos do veículo (não só a capa), navegáveis por setas ‹ › sobre a imagem (clique ou teclado) quando há mais de uma, com um botão de lupa que abre a foto atual em tela cheia (mesma navegação por setas, ESC fecha só a foto ampliada). Abrir um veículo atualiza a URL para `?veiculo=<id>` — o link da barra de endereço pode ser copiado e reaberto direto naquele veículo.

Cada card e o modal também mostram uma simulação de parcelamento ("a partir de Nx de R$...") calculada no navegador (tabela Price/juros compostos) a partir da taxa, entrada padrão e nº máximo de parcelas configurados em Configurações → Simulador de parcelamento — deixa claro que é uma estimativa, não uma oferta de crédito real. Pode ser desligado inteiramente por lá.

### `admin/index.html` (painel do gestor) + `assets/js/admin.js`

1. **Login** — `HM.login(email, senha)` autentica no Supabase Auth. A sessão persiste entre recarregamentos e é encerrada automaticamente se expirar ou for revogada em outra aba.
2. **Dashboard** — métricas de total cadastrado, vendidos, destaques e consignações (contagens feitas no servidor, sem baixar o estoque inteiro) + atividade recente + "Mais vistos" (top 5 veículos por visualização no site público).
3. **Veículos (CRUD)** — criar, editar, ocultar/exibir, marcar como vendido e excluir. Lista paginada com busca instantânea por marca/modelo/placa, com uma coluna "Interesse" mostrando visualizações e cliques em WhatsApp de cada veículo. Upload de várias fotos por veículo (arrastar e soltar, ou selecionar múltiplos arquivos), cada uma compactada automaticamente antes do envio ao Storage; qualquer uma pode virar a "capa" do anúncio. Cada veículo tem um histórico de alterações (quem editou o quê e quando).
4. **Consignações** — registro de veículos consignados por terceiros, também paginado.
5. **Usuários** — visível para administradores: lista quem tem acesso ao painel e permite alterar o nível de cada um.
6. **Logs** — visível para gerentes/administradores: trilha completa de ações no painel, com filtro por área.
7. **Configurações** — dados da loja, preferências de exibição do site, troca de senha, e a seção de backup/restauração (ver [Backup e restauração](#backup-e-restauração)) — essas duas últimas exigem nível gerente ou administrador.

## Páginas de veículo e SEO

Antes, o site inteiro era uma página só (`index.html`) — o Google via um card genérico, nunca um veículo específico, e cada anúncio não tinha um endereço próprio pra indexar ou mandar no WhatsApp. Isso mudou com uma página própria por veículo, servida por uma função da Vercel (não pelo `index.html`, que continua 100% client-side).

- **Rota:** `/veiculo/<slug>` — configurada em [`vercel.json`](vercel.json) como um rewrite pra `/api/veiculo?slug=<slug>`.
- **Função:** [`api/veiculo.js`](api/veiculo.js). Roda em Node, sem dependências (usa o `fetch` nativo direto contra o REST do Supabase, com a mesma URL/chave `anon` públicas do front, lidas de `process.env.SUPABASE_URL`/`SUPABASE_ANON_KEY` com fallback pros valores fixos). Monta uma página lida sem JavaScript: título, meta description, `canonical`, Open Graph/Twitter Card com a foto principal, dados estruturados (`Car`/`Motorcycle`, JSON-LD) e o corpo com galeria, especificações, preço e os botões de WhatsApp/estoque.
  - Um parâmetro no formato UUID (link antigo, com `?veiculo=<id>`) é resolvido pelo id e redireciona **301** pro slug.
  - Veículo inexistente, vendido ou oculto (RLS já filtra isso) devolve **404** com `noindex`.
  - Resposta com `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`.
- **Slug:** coluna `veiculos.slug`, gerada por um trigger no banco (`supabase/schema.sql` → PARTE 13) no formato `marca-modelo-ano` (sem acentos, minúsculo, colisões resolvidas com um sufixo). **Gerado só quando está vazio — nunca é regenerado** depois de existir, mesmo que o gestor edite marca/modelo/ano do veículo mais tarde. Isso é proposital: um link já compartilhado no Instagram ou indexado pelo Google não pode virar 404 só porque o anúncio foi atualizado.
- **Sitemap:** [`api/sitemap.js`](api/sitemap.js), servido em `/sitemap.xml` (rewrite no `vercel.json`) — lista a home e cada veículo com slug, com `lastmod`.
- **`robots.txt`** na raiz libera tudo, exceto `/admin/`, `/admin.html` e `/migrar-localstorage.html`, e aponta pro sitemap.
- **CSS:** [`assets/css/veiculo.css`](assets/css/veiculo.css) tem só o que falta além de `base.css`/`site.css` (layout da página, galeria, breadcrumb) — header, footer, botões e o bloco de especificações são os mesmos estilos do site público.
- **Link público:** `HM.linkPublico(v)` (`assets/js/data.js`) monta a URL `https://www.holandamotors.com.br/veiculo/<slug>`, com fallback pro link antigo (`/?veiculo=<id>`) se o veículo ainda não tiver slug. É o que o botão "Copiar link" do site e do painel usam, e o que os cards do catálogo apontam (Ctrl/Cmd/clique do meio abre a página própria numa aba nova; um clique normal continua abrindo o modal, que é mais rápido pra quem já está navegando).

## Medição de desempenho

Medição própria de tráfego — sem Google Analytics, sem pixel de terceiro e **sem cookies**: não guarda IP nem *user agent*, só o necessário pra contar visitas, de onde vieram e quantas viraram clique em WhatsApp. Por não usar cookies nem identificar pessoas, não precisa de banner de consentimento.

- **Tabela:** `eventos_site` (`supabase/schema.sql` → PARTE 13) — um evento por tipo (`sessao`, `pagina`, `whatsapp`), com origem, dispositivo e, quando aplicável, UTM e o veículo relacionado. Insert público (o site é anônimo), leitura restrita a gerente/administrador.
- **Coleta:** [`assets/js/rastreio.js`](assets/js/rastreio.js), carregado tanto na home quanto na página de veículo — **sem depender do supabase-js**, fala direto com o REST via `fetch`. Auto-inicializa sozinho ao carregar (a página de veículo só precisa do `<body data-veiculo-id="...">`, que `api/veiculo.js` já gera):
  - **Origem** é calculada uma vez por sessão (via `utm_source`, ou o `document.referrer`) e fica em `sessionStorage` — navegar para outra página do próprio site não recalcula.
  - **Sessão:** um evento por sessão, no primeiro carregamento.
  - **Página:** um evento por caminho por sessão (reabrir o modal do mesmo veículo não conta de novo — isso já é o que `interacoes_veiculo` faz).
  - **WhatsApp:** um listener delegado em `a[href^="https://wa.me/"]`, usando `data-wpp-local` (`header`, `flutuante`, `contato`, `contato_vendas`, `consignacao`, `card`, `modal`, `pagina_veiculo`) pra saber onde foi o clique.
  - Nunca lança erro pro chamador — uma falha de rede aqui não pode quebrar a navegação de quem só está olhando o site.
- **`interacoes_veiculo`** (contador de "interesse" por veículo, já existente) continua funcionando exatamente como antes na home; a página de veículo grava nela também (visualização ao carregar, clique no botão principal), pros números do painel baterem nos dois lugares.
- **RPC `resumo_desempenho(p_dias)`:** agrega tudo no SQL (o PostgREST corta respostas em 1000 linhas — agregar no cliente sub-contaria qualquer loja com mais eventos que isso) e devolve visitas, cliques em WhatsApp, por origem, por local do clique e os top 10 veículos. Alimenta o card **"Desempenho do site"** no dashboard do painel (visível só pra gerente/administrador), com seletor de período (7/30/90 dias).
- **Convenção de UTM** pros links que a loja divulgar (pra aparecerem certos no card de origem):

  | Onde o link é colocado | Link |
  |---|---|
  | Bio do Instagram | `https://www.holandamotors.com.br/?utm_source=instagram&utm_medium=bio` |
  | Stories ou post de um veículo | `https://www.holandamotors.com.br/veiculo/<slug>?utm_source=instagram&utm_medium=stories` |
  | Perfil da Empresa no Google | `https://www.holandamotors.com.br/?utm_source=google&utm_medium=perfil_empresa` |
  | Anúncio Meta | `https://www.holandamotors.com.br/?utm_source=facebook&utm_medium=anuncio&utm_campaign=<nome>` |

## Preview ao compartilhar (Edge Function)

Antes das páginas próprias por veículo (seção acima), o botão "Copiar link" do site apontava pra uma Edge Function no Supabase, que gerava um preview OG/Twitter Card e redirecionava pro site. Hoje quem faz esse trabalho é `api/veiculo.js`, rodando no próprio domínio da loja — a Edge Function [`supabase/functions/vehicle-preview/index.ts`](supabase/functions/vehicle-preview/index.ts) continua publicada só para **não quebrar links antigos** já compartilhados ou indexados:

- Redireciona `https://SEU-PROJETO.supabase.co/functions/v1/vehicle-preview/<id>` para `/veiculo/<slug>` (ou `/?veiculo=<id>`, se o veículo ainda não tiver slug).
- Continua servindo um preview OG/Twitter Card básico (com a foto/preço do veículo) durante o instante do redirect, caso algum rastreador o leia antes de seguir o link.
- É pública (`verify_jwt` desativado no deploy) de propósito — precisa ser alcançável por qualquer rastreador ou visitante sem login, e só devolve dados de veículos já públicos no site (mesma regra de RLS: `ativo = true` e `vendido = false`).

**Se você recriar o projeto Supabase do zero**, publique a function de novo (painel do Supabase → **Edge Functions** → **New function**, nome `vehicle-preview`, cole o conteúdo do arquivo, desmarque "Verify JWT" antes de publicar) ou via CLI:
```bash
supabase functions deploy vehicle-preview --project-ref SEU-PROJETO --no-verify-jwt
```
> O arquivo da function tem `SUPABASE_URL`, a chave `anon` e a URL do site (`SITE_URL`) fixas no topo — atualize os três se algum deles mudar (assim como `assets/js/supabase-client.js` e `assets/js/rastreio.js`, que mantêm a mesma cópia fixa pelo mesmo motivo).

## Publicando no GitHub Pages

1. **Crie um repositório no GitHub** (se ainda não tiver um): entre em [github.com/new](https://github.com/new), dê um nome (ex: `holanda-motors`) e crie.
2. **Envie o projeto para o repositório:**
   ```bash
   cd holanda-motors
   git add .
   git commit -m "Migração para Supabase"
   git push
   ```
3. **Ative o GitHub Pages:**
   - No repositório, vá em **Settings → Pages**
   - Em **Build and deployment → Source**, selecione **Deploy from a branch**
   - Em **Branch**, selecione `main` e a pasta `/ (root)` — clique em **Save**
   - Aguarde 1–2 minutos. O link publicado aparece no topo da página: `https://SEU-USUARIO.github.io/holanda-motors/`
4. **Acesse:**
   - Site público: `https://SEU-USUARIO.github.io/holanda-motors/`
   - Painel do gestor: `https://SEU-USUARIO.github.io/holanda-motors/admin/`

> O arquivo `.nojekyll` na raiz evita que o GitHub tente processar os arquivos com o Jekyll. A chave `anon` do Supabase pode ir para o repositório público sem problema (ver [Configurando o Supabase do zero](#configurando-o-supabase-do-zero)) — a segurança real está nas políticas de RLS.

## Como adicionar novos administradores

O acesso ao painel é controlado inteiramente pelo Supabase Auth — qualquer usuário criado lá pode logar em `/admin/`. Não existe link público para o painel a partir do site (por design, para não expor a área de gestão) — o endereço é acessado diretamente pelo gestor.

1. No dashboard do Supabase, vá em **Authentication → Users → Add user → Create new user**.
2. Preencha e-mail e uma senha temporária, e marque **Auto Confirm User** (senão o usuário precisaria confirmar por e-mail antes do primeiro login).
3. Compartilhe o e-mail e a senha temporária com o novo administrador — ele pode trocá-la em **Configurações → Segurança** dentro do próprio painel.

Não é necessário nenhuma alteração de código para adicionar ou remover administradores — basta gerenciar os usuários pelo dashboard do Supabase (**Authentication → Users**, onde também dá para desativar ou excluir um acesso).

## Níveis de acesso

Cada usuário do painel tem um nível de acesso, guardado em `usuarios.role`:

| Nível | Pode |
|---|---|
| **Vendedor** | Cadastrar e editar veículos e consignações, marcar como vendido/exibir/ocultar. Não exclui nada, não altera configurações da loja, não vê a tela de Logs nem de Usuários. |
| **Gerente** | Tudo que o vendedor pode, mais: excluir veículos/consignações, alterar configurações da loja, ver a tela de Logs e fazer backup/restauração. Não altera o nível de acesso de outros usuários. |
| **Administrador** | Tudo, incluindo gerenciar o nível de acesso de qualquer usuário na tela **Usuários**. |

O primeiro usuário criado no projeto vira administrador automaticamente; os seguintes entram como vendedor por padrão. Um administrador promove os demais em **Usuários**, dentro do painel — não precisa mexer no Supabase para isso. As regras são aplicadas tanto na interface (o que aparece/fica desabilitado) quanto no banco via RLS — mesmo que alguém tente pular a interface, o Postgres recusa a operação se o nível não permitir.

## Backup e restauração

**Pelo próprio painel** (Configurações → Backup e restauração, visível a partir do nível gerente): o botão **Baixar backup (JSON)** exporta veículos, fotos (como URLs), consignações, marcas e configurações num arquivo que você pode guardar onde quiser; **Restaurar backup** lê esse arquivo de volta, recriando o que faltar. Essa via é prática para uma cópia rápida ou para levar os dados a outro projeto Supabase, mas **não inclui os arquivos de foto em si** (só as URLs) — se o Storage original for apagado, as URLs do backup deixam de funcionar.

Para um backup completo (schema + dados + arquivos), use os mecanismos do próprio Supabase:

O Supabase já mantém backups automáticos diários (visíveis em **Database → Backups** no dashboard, com retenção conforme o plano do projeto), mas para um backup manual sob seu controle:

**Backup manual:**
1. No dashboard, vá em **Database → Backups** e use a opção de download, **ou**
2. Use o `pg_dump` do Postgres apontando para a *connection string* do seu projeto (**Project Settings → Database → Connection string**):
   ```bash
   pg_dump "postgresql://postgres:[SUA-SENHA]@[SEU-HOST]:5432/postgres" --data-only --exclude-schema=storage,auth > backup-holanda-motors.sql
   ```
3. Para incluir também as fotos, baixe o conteúdo do bucket `veiculos-fotos` em **Storage** no dashboard.

**Restauração:**
1. Em um projeto Supabase novo (ou no mesmo, em caso de necessidade de reverter), execute primeiro `supabase/schema.sql` para recriar a estrutura.
2. Restaure os dados com:
   ```bash
   psql "postgresql://postgres:[SUA-SENHA]@[SEU-HOST]:5432/postgres" < backup-holanda-motors.sql
   ```
3. Se necessário, reenvie as fotos ao bucket `veiculos-fotos` pelo dashboard (**Storage**).

> Antes de qualquer restauração em um projeto já em uso, faça um backup do estado atual primeiro — a restauração pode sobrescrever dados existentes.

## Limitações conhecidas

- **Dependência de internet:** diferente da versão anterior (100% local), o site e o painel agora precisam que o Supabase esteja acessível. Sem internet, nem o site público carrega o estoque.
- **Chave pública no front-end:** a chave `anon` do Supabase fica visível no código-fonte — isso é esperado e seguro *desde que* as políticas de RLS em `supabase/schema.sql` continuem ativas. Nunca desative o RLS de uma tabela sem entender o impacto.
- **Sem confirmação de e-mail por padrão:** o passo a passo usa "Auto Confirm User" para simplificar a criação de administradores. Se quiser exigir confirmação por e-mail, configure isso em **Authentication → Providers → Email** no Supabase.
- **Backup pelo painel não inclui arquivos de foto:** ver [Backup e restauração](#backup-e-restauração) — o JSON exportado guarda URLs, não os arquivos. Para um backup completo, use os mecanismos nativos do Supabase (Database Backups + Storage).
- **Contador de interesse sem limitação de taxa:** o registro de visualizações/cliques em WhatsApp (`interacoes_veiculo`) aceita inserção de qualquer visitante anônimo, sem checar se é a mesma pessoa clicando repetidamente. É um número de referência para comparar "qual anúncio funciona melhor", não uma métrica auditável — alguém tecnicamente poderia infla-lo com requisições repetidas. Nenhum dado sensível fica exposto por causa disso (a leitura continua exigindo login).

## Licença

Projeto de uso interno da **Núcleo Tech** para fins comerciais junto ao cliente Holanda Motors. Direitos de imagem das fotos de placeholder (Unsplash) pertencem aos respectivos autores e devem ser substituídas por material próprio antes de qualquer publicação definitiva.
