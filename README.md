# Holanda Motors — Site + Painel do Gestor

Site institucional e painel administrativo para a **Holanda Motors**, concessionária de carros e motos em Sobral, Ceará. Projeto desenvolvido pela **Núcleo Tech** como demonstração comercial, com estoque de veículos, consignação, e um painel de gestão com CRUD completo — tudo rodando 100% no navegador, sem necessidade de servidor ou banco de dados externo.

**[→ Ver demonstração ao vivo](#)** *(link do GitHub Pages, depois de publicado — veja a seção [Publicando no GitHub Pages](#publicando-no-github-pages))*

---

## Índice

- [Descrição do projeto](#descrição-do-projeto)
- [Tecnologias utilizadas](#tecnologias-utilizadas)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Pré-requisitos](#pré-requisitos)
- [Como clonar o repositório](#como-clonar-o-repositório)
- [Como executar o projeto localmente](#como-executar-o-projeto-localmente)
- [Como funcionam os dois arquivos principais](#como-funcionam-os-dois-arquivos-principais)
- [Publicando no GitHub Pages](#publicando-no-github-pages)
- [Como atualizar o site após novas alterações](#como-atualizar-o-site-após-novas-alterações)
- [Limitações conhecidas](#limitações-conhecidas)
- [Licença](#licença)

---

## Descrição do projeto

O projeto tem duas frentes que conversam entre si:

1. **`index.html`** — o site público. Catálogo de veículos com filtros, seção de consignação, sobre a loja, contato e botões de WhatsApp prontos.
2. **`admin.html`** — o painel do gestor. Login protegido, dashboard com métricas, CRUD completo de veículos (com upload de foto), gestão de consignações e configurações da loja (endereço, WhatsApp, horário, textos, preferências de exibição).

Os dois arquivos compartilham os mesmos dados através do `localStorage` do navegador: qualquer alteração feita no painel (adicionar um veículo, trocar uma foto, mudar o WhatsApp da loja) aparece automaticamente no site público na próxima vez que a página for carregada — sem precisar editar código.

## Tecnologias utilizadas

- **HTML5** semântico, com atributos ARIA para acessibilidade
- **CSS3** puro (sem frameworks) — variáveis nativas, Grid e Flexbox
- **JavaScript** vanilla (ES6+), sem dependências de build ou bibliotecas externas
- **Google Fonts** (Barlow / Barlow Condensed)
- **localStorage** como camada de persistência local (ver [Limitações](#limitações-conhecidas))

Não há etapa de build, bundler ou transpilação — os arquivos rodam exatamente como estão, direto no navegador.

## Estrutura de pastas

```
holanda-motors/
├── index.html                 # Site público
├── admin.html                 # Painel do gestor
├── README.md
├── .nojekyll                  # Evita processamento Jekyll no GitHub Pages
└── assets/
    ├── css/
    │   ├── base.css            # Variáveis, reset, botões e badges compartilhados
    │   ├── site.css             # Estilos exclusivos do site público
    │   └── admin.css             # Estilos exclusivos do painel do gestor
    ├── js/
    │   ├── data.js               # Camada de dados compartilhada (fonte única de verdade)
    │   ├── site.js                # Lógica do site público
    │   └── admin.js                # Lógica do painel do gestor
    └── img/                        # (reservado para imagens locais, se substituir as do Unsplash)
```

## Pré-requisitos

Não é necessário instalar nada para rodar o projeto — é HTML/CSS/JS estático. Você só precisa de:

- Um navegador atualizado (Chrome, Firefox, Edge ou Safari)
- Opcionalmente, o [Git](https://git-scm.com/) instalado, se for clonar via linha de comando
- Opcionalmente, uma conta no [GitHub](https://github.com), se for publicar no GitHub Pages

## Como clonar o repositório

```bash
git clone https://github.com/SEU-USUARIO/holanda-motors.git
cd holanda-motors
```

Se você recebeu o projeto como um arquivo `.zip` em vez de um repositório Git, basta extrair a pasta em qualquer lugar do computador.

## Como executar o projeto localmente

Como o navegador restringe algumas operações (como `fetch`) quando um arquivo `.html` é aberto diretamente via `file://`, o mais seguro é servir a pasta com um servidor local simples. Duas opções:

**Opção 1 — Direto pelo navegador (mais simples)**
Dê duplo clique em `index.html` ou `admin.html`. Para este projeto especificamente isso funciona sem problemas, já que não há chamadas `fetch` a arquivos locais — todo o CSS/JS é referenciado por caminho relativo e o armazenamento é via `localStorage`.

**Opção 2 — Servidor local (recomendado para simular produção)**

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

> ⚠️ **Importante:** o site público e o painel só compartilham dados quando acessados pela **mesma origem** (mesmo `http://localhost:8000/...`, por exemplo). Se você abrir um pelo `file://` e outro por um servidor local, eles terão `localStorage` separados e não vão sincronizar.

**Login padrão do painel:** usuário `admin`, senha `holanda2026` (altere em Configurações → Segurança assim que possível).

## Como funcionam os dois arquivos principais

### `index.html` (site público)

Carrega `assets/js/data.js` e depois `assets/js/site.js`. Ao abrir a página, `site.js`:

1. Lê a configuração da loja (`HM.getConfig()`) e preenche endereço, WhatsApp, horário, Instagram e texto "sobre" em todos os pontos do site.
2. Lê a lista de veículos (`HM.getVehicles()`), filtra os marcados como visíveis (`ativo: 1`) e monta o hero (usando o veículo com badge "Destaque") e a grade do catálogo.
3. Cuida dos filtros de catálogo, do modal de detalhes do veículo (com foco preso e tecla Esc) e do menu mobile.

### `admin.html` (painel do gestor)

Carrega `assets/js/data.js` e depois `assets/js/admin.js`. O fluxo é:

1. **Login** — compara usuário/senha com o valor salvo (`HM.getPass()`). Autenticação simples do lado do cliente — ver [Limitações](#limitações-conhecidas).
2. **Dashboard** — estatísticas calculadas em tempo real a partir dos veículos e consignações salvos.
3. **Veículos (CRUD)** — criar, editar, ocultar/exibir e excluir veículos. O upload de foto converte a imagem para Base64 e salva direto no `localStorage` (ou você pode colar uma URL de imagem, o que é mais leve).
4. **Consignações** — registro de veículos consignados por terceiros, com status e dados de contato.
5. **Configurações** — dados da loja e preferências de exibição do site (mostrar hero, seção de consignação, botão flutuante do WhatsApp etc.), além de troca de senha.

### `assets/js/data.js` (a peça que conecta os dois)

Esse arquivo é a **fonte única de verdade**. Ele expõe um objeto global `HM` com funções como `HM.getVehicles()`, `HM.saveVehicles()`, `HM.getConfig()` etc., que leem e escrevem sempre nas mesmas chaves do `localStorage`. Tanto `site.js` quanto `admin.js` usam **apenas** essas funções para acessar dados — nenhum dos dois lê o `localStorage` diretamente. Isso é o que garante que os dois arquivos fiquem sempre sincronizados, e é também o ponto de troca caso um dia vocês queiram migrar de `localStorage` para uma API/banco de dados real (ver [Sugestões futuras](#sugestões-futuras) no relatório de entrega).

## Publicando no GitHub Pages

1. **Crie um repositório no GitHub** (se ainda não tiver um): entre em [github.com/new](https://github.com/new), dê um nome (ex: `holanda-motors`) e crie.
2. **Envie o projeto para o repositório:**
   ```bash
   cd holanda-motors
   git init
   git add .
   git commit -m "Site e painel Holanda Motors"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/holanda-motors.git
   git push -u origin main
   ```
3. **Ative o GitHub Pages:**
   - No repositório, vá em **Settings** (Configurações)
   - No menu lateral, clique em **Pages**
   - Em **Build and deployment → Source**, selecione **Deploy from a branch**
   - Em **Branch**, selecione `main` e a pasta `/ (root)` — clique em **Save**
   - Aguarde 1–2 minutos. O GitHub mostrará o link publicado no topo da página, algo como:
     `https://SEU-USUARIO.github.io/holanda-motors/`
4. **Acesse:**
   - Site público: `https://SEU-USUARIO.github.io/holanda-motors/`
   - Painel do gestor: `https://SEU-USUARIO.github.io/holanda-motors/admin.html`

> O arquivo `.nojekyll` incluído na raiz do projeto evita que o GitHub tente processar os arquivos com o Jekyll (o processador padrão de sites do GitHub Pages), o que não é necessário aqui e pode causar comportamento inesperado com nomes de pasta iniciados por `_` no futuro.

## Como atualizar o site após novas alterações

Sempre que editar qualquer arquivo localmente:

```bash
git add .
git commit -m "Descreva o que mudou, ex: adiciona novo veículo ao estoque padrão"
git push
```

O GitHub Pages publica a nova versão automaticamente em cerca de 1 minuto após o `push` — não é preciso repetir a configuração de Pages.

**Atenção:** como os dados de veículos/consignações ficam no `localStorage` de cada navegador, atualizar o código-fonte (`git push`) **não apaga nem altera** os dados que um cliente já tenha salvo no navegador dele — o `localStorage` é local a cada dispositivo/navegador. Isso também quer dizer que dados cadastrados pelo painel em um computador não aparecem automaticamente em outro computador ou celular (ver próxima seção).

## Limitações conhecidas

Este projeto foi construído como uma **demonstração comercial rápida**, sem backend. Antes de usar em produção com o cliente final, vale ter clareza sobre:

- **Sem banco de dados real:** os dados vivem no `localStorage` do navegador. Isso significa que (a) cada navegador/dispositivo tem sua própria cópia dos dados — o que o gestor cadastra no computador da loja não aparece no celular dele, por exemplo — e (b) limpar o cache do navegador apaga os dados.
- **Login não é segurança real:** a autenticação do painel é uma verificação simples em JavaScript, do lado do cliente. Qualquer pessoa com conhecimento técnico pode inspecionar o código-fonte e contornar esse login, ou ler os dados salvos diretamente no `localStorage`. Adequado para uma demo; não deve ser tratado como proteção de dados sensíveis.
- **Imagens em Base64 ocupam espaço:** o `localStorage` tem um limite de ~5–10MB por site (varia por navegador). Fotos enviadas via upload são convertidas para Base64 e ficam bem mais pesadas que o arquivo original — cadastrar muitas fotos grandes pode esgotar essa cota. Usar URLs de imagem hospedadas externamente (em vez de upload direto) evita esse problema.
- **Fotos de placeholder:** o catálogo de demonstração usa fotos de estoque do Unsplash como placeholder. Vale substituir pelas fotos reais dos veículos assim que possível — pela própria tela de upload do painel.

Nenhuma dessas limitações impede o uso da demo para validar o produto com o cliente — mas se o projeto avançar para uso real e contínuo, o próximo passo natural é migrar `data.js` para conversar com um backend (Supabase, por exemplo), o que, pelo desenho atual do projeto, não deve exigir mudanças em `site.js` nem em `admin.js`.

## Licença

Projeto de uso interno da **Núcleo Tech** para fins comerciais junto ao cliente Holanda Motors. Direitos de imagem das fotos de placeholder (Unsplash) pertencem aos respectivos autores e devem ser substituídas por material próprio antes de qualquer publicação definitiva.
