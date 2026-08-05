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
- [Publicando no GitHub Pages](#publicando-no-github-pages)
- [Como adicionar novos administradores](#como-adicionar-novos-administradores)
- [Backup e restauração](#backup-e-restauração)
- [Limitações conhecidas](#limitações-conhecidas)
- [Licença](#licença)

---

## Descrição do projeto

O projeto tem duas frentes que conversam entre si através do Supabase:

1. **`index.html`** — o site público. Catálogo de veículos com filtros, seção de consignação, sobre a loja, contato e botões de WhatsApp prontos.
2. **`admin.html`** — o painel do gestor. Login real (Supabase Auth), dashboard com métricas, CRUD completo de veículos (com upload de foto para o Supabase Storage), gestão de consignações e configurações da loja.

Qualquer alteração feita no painel (adicionar um veículo, trocar uma foto, mudar o WhatsApp da loja) aparece automaticamente no site público na próxima vez que a página for carregada — sem precisar editar código, e agora **sincronizado entre qualquer dispositivo/navegador**, já que os dados vivem no banco, não mais no navegador de cada um.

## Tecnologias utilizadas

- **HTML5** semântico, com atributos ARIA para acessibilidade
- **CSS3** puro (sem frameworks) — variáveis nativas, Grid e Flexbox
- **JavaScript** vanilla (ES6+, assíncrono), sem bundler — o SDK do Supabase é carregado via CDN
- **[Supabase](https://supabase.com)**: Postgres (banco), Auth (login do painel) e Storage (fotos dos veículos)
- **Google Fonts** (Barlow / Barlow Condensed)

Não há etapa de build, bundler ou transpilação — os arquivos rodam exatamente como estão, direto no navegador. Isso é intencional para manter a compatibilidade com o GitHub Pages.

## Estrutura de pastas

```
holanda-motors/
├── index.html                    # Site público
├── admin.html                    # Painel do gestor
├── migrar.html                   # Ferramenta temporária de migração (ver seção própria) — apague após o uso
├── README.md
├── .nojekyll                     # Evita processamento Jekyll no GitHub Pages
├── supabase/
│   └── schema.sql                # Script único: tabelas, RLS, Storage e dados iniciais
└── assets/
    ├── css/
    │   ├── base.css               # Variáveis, reset, botões e badges compartilhados
    │   ├── site.css                # Estilos exclusivos do site público
    │   └── admin.css                 # Estilos exclusivos do painel do gestor
    └── js/
        ├── supabase-client.js         # Instância única do client Supabase (URL + chave anon)
        ├── data.js                     # Camada de dados compartilhada — fonte única de verdade
        ├── site.js                      # Lógica do site público
        └── admin.js                      # Lógica do painel do gestor
```

## Modelo de dados

Tabelas criadas por `supabase/schema.sql`:

| Tabela | Descrição |
|---|---|
| `categorias` | Tipos de veículo (carro, moto). Semeada automaticamente pelo script. |
| `marcas` | Marcas dos veículos. O painel cria uma marca nova automaticamente ao cadastrar um veículo com uma marca ainda não existente. |
| `veiculos` | Estoque — modelo, ano, km, preço, câmbio, combustível, cor, badge (seminovo/consignado/destaque), visibilidade no site. |
| `midias_veiculo` | Fotos dos veículos — arquivo fica no Supabase Storage (bucket `veiculos-fotos`), esta tabela guarda o caminho e a URL pública. |
| `consignacoes` | Veículos consignados por terceiros — dono, contato, valor pedido, status, comissão. Nunca é exposta ao público (RLS). |
| `configuracoes_loja` | Linha única com os dados da loja (endereço, WhatsApp, horários, textos, preferências de exibição do site). |
| `atividades` | Log de atividades exibido no dashboard do painel (interno, não público). |
| `usuarios` | Metadados dos administradores (nome, e-mail), vinculada 1:1 ao usuário do Supabase Auth. A senha em si nunca fica nesta tabela — isso é responsabilidade do Supabase Auth. |

**Row Level Security (RLS):** todas as tabelas têm RLS ativado. `categorias`, `marcas`, `veiculos` (só os `ativo = true`), `midias_veiculo` e `configuracoes_loja` podem ser **lidas** por qualquer visitante (é o que o site público usa) — mas só um usuário autenticado (login do painel) pode escrever. `consignacoes`, `atividades` e `usuarios` exigem autenticação até para leitura. As políticas completas estão em `supabase/schema.sql`.

## Configurando o Supabase do zero

1. **Crie uma conta** em [supabase.com](https://supabase.com) (pode entrar com GitHub).
2. **Crie um novo projeto**: no dashboard, clique em **New Project**, escolha um nome (ex: `holanda-motors`), uma senha para o banco (guarde-a — é diferente da senha de login do painel) e a região mais próxima (ex: South America). Aguarde alguns minutos até o projeto ficar pronto.
3. **Execute o script SQL**: no menu lateral, vá em **SQL Editor → New query**, cole o conteúdo inteiro de [`supabase/schema.sql`](supabase/schema.sql) deste projeto e clique em **Run**. Isso cria todas as tabelas, ativa o RLS, cria o bucket de fotos e semeia as categorias/marcas/config padrão.
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
6. **Crie o primeiro usuário administrador**: no dashboard, vá em **Authentication → Users → Add user → Create new user**. Preencha um e-mail e senha (essas serão as credenciais de login do painel) e marque **Auto Confirm User**. Veja também [Como adicionar novos administradores](#como-adicionar-novos-administradores).

Pronto — o projeto está conectado ao seu Supabase.

## Como executar o projeto localmente

Como o SDK do Supabase é carregado como módulo de script, o navegador precisa servir os arquivos por HTTP (não por `file://`). Sirva a pasta com um servidor local simples:

Com Python (já vem instalado na maioria dos sistemas):
```bash
cd holanda-motors
python3 -m http.server 8000
```
Acesse `http://localhost:8000` (site) e `http://localhost:8000/admin.html` (painel).

Com Node.js:
```bash
npx serve .
```

## Migrando dados antigos do localStorage

Se você usou uma versão anterior deste projeto (antes da migração para Supabase) e ainda tem veículos/consignações/configurações salvos no `localStorage` de algum navegador, use a ferramenta **`migrar.html`**, incluída na raiz do projeto:

1. Sirva o projeto localmente (veja seção anterior) e abra `http://localhost:8000/migrar.html` **no mesmo navegador** onde os dados antigos estão salvos.
2. Entre com o e-mail/senha do administrador (criado no passo 6 de [Configurando o Supabase do zero](#configurando-o-supabase-do-zero)) — a migração escreve no banco, então exige uma sessão autenticada, assim como o painel.
3. A página mostra quantos veículos, consignações, atividades e a configuração da loja foram encontrados no `localStorage` deste navegador.
4. Clique em **Migrar agora** — cada registro é enviado ao Supabase (fotos em Base64 são automaticamente re-enviadas ao Storage) e o progresso aparece na tela.
5. A página então **valida** automaticamente que as contagens no Supabase batem com o que existia localmente.
6. Só depois da validação, clique em **Limpar dados antigos do navegador** — isso remove a cópia antiga do `localStorage` deste navegador (os dados no Supabase não são afetados).
7. Apague o arquivo `migrar.html` do projeto (ele não deve ir para produção).

> A senha do painel antigo (`hm_pass`) **não é migrada** — ela não existe mais no novo sistema. As credenciais agora são o e-mail/senha do administrador criado no Supabase Auth.

## Como funcionam os arquivos principais

### `assets/js/supabase-client.js`

Cria a instância única do client Supabase (`supabaseClient`), a partir da URL e da chave `anon` do seu projeto.

### `assets/js/data.js` (a peça que conecta tudo)

Fonte única de verdade. Expõe um objeto global `HM` com funções como `HM.getVehicles()`, `HM.createVehicle()`, `HM.getConfig()`, `HM.login()` etc. — todas assíncronas (retornam `Promise`). Tanto `site.js` quanto `admin.js` usam **apenas** essas funções para acessar dados; nenhum dos dois fala com o Supabase diretamente. Isso é o que garante que os dois fiquem sempre sincronizados.

### `index.html` (site público) + `assets/js/site.js`

Ao carregar, busca a configuração da loja e a lista de veículos (só os `ativo = true`, filtrados automaticamente pelo RLS) uma única vez, e a partir daí monta o hero, o catálogo com filtros e o modal de detalhes — tudo a partir do cache local da página, sem novas requisições a cada clique de filtro.

### `admin.html` (painel do gestor) + `assets/js/admin.js`

1. **Login** — `HM.login(email, senha)` autentica no Supabase Auth. A sessão persiste entre recarregamentos da página.
2. **Dashboard** — estatísticas calculadas a partir dos veículos e consignações do banco.
3. **Veículos (CRUD)** — criar, editar, ocultar/exibir e excluir veículos. O upload de foto vai para o bucket `veiculos-fotos` no Supabase Storage (ou você pode colar uma URL de imagem externa).
4. **Consignações** — registro de veículos consignados por terceiros.
5. **Configurações** — dados da loja, preferências de exibição do site, e troca de senha do administrador logado.

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
   - Painel do gestor: `https://SEU-USUARIO.github.io/holanda-motors/admin.html`

> O arquivo `.nojekyll` na raiz evita que o GitHub tente processar os arquivos com o Jekyll. A chave `anon` do Supabase pode ir para o repositório público sem problema (ver [Configurando o Supabase do zero](#configurando-o-supabase-do-zero)) — a segurança real está nas políticas de RLS.

## Como adicionar novos administradores

O acesso ao painel é controlado inteiramente pelo Supabase Auth — qualquer usuário criado lá pode logar em `admin.html`.

1. No dashboard do Supabase, vá em **Authentication → Users → Add user → Create new user**.
2. Preencha e-mail e uma senha temporária, e marque **Auto Confirm User** (senão o usuário precisaria confirmar por e-mail antes do primeiro login).
3. Compartilhe o e-mail e a senha temporária com o novo administrador — ele pode trocá-la em **Configurações → Segurança** dentro do próprio painel.

Não é necessário nenhuma alteração de código para adicionar ou remover administradores — basta gerenciar os usuários pelo dashboard do Supabase (**Authentication → Users**, onde também dá para desativar ou excluir um acesso).

## Backup e restauração

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

## Licença

Projeto de uso interno da **Núcleo Tech** para fins comerciais junto ao cliente Holanda Motors. Direitos de imagem das fotos de placeholder (Unsplash) pertencem aos respectivos autores e devem ser substituídas por material próprio antes de qualquer publicação definitiva.
