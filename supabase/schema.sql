-- ============================================================================
-- Holanda Motors — Schema Supabase
-- ----------------------------------------------------------------------------
-- Execute este arquivo inteiro uma única vez no SQL Editor do seu projeto
-- Supabase (https://app.supabase.com → seu projeto → SQL Editor → New query).
-- Ele cria as tabelas, ativa Row Level Security, define as políticas de
-- acesso, cria o bucket de fotos e semeia os dados padrão (categorias,
-- marcas e a linha única de configurações da loja).
--
-- Ver README.md → "Configurando o Supabase do zero" para o passo a passo
-- completo (criação do projeto, chaves de API, criação do usuário admin).
--
-- O arquivo inteiro é idempotente — pode ser colado e executado de novo a
-- qualquer momento (ex: depois de puxar uma atualização do projeto) sem
-- duplicar tabelas, políticas ou dados.
-- ============================================================================

-- Necessário para gen_random_uuid()
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- CATEGORIAS (substitui o campo texto "tipo": carro, moto...)
-- ----------------------------------------------------------------------------
create table if not exists categorias (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  nome text not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- MARCAS (Honda, Toyota... — criadas sob demanda pelo painel)
-- ----------------------------------------------------------------------------
create table if not exists marcas (
  id uuid primary key default gen_random_uuid(),
  nome text unique not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- USUARIOS (perfil do gestor — a senha em si fica no Supabase Auth,
-- esta tabela só guarda metadados exibidos no painel)
-- ----------------------------------------------------------------------------
create table if not exists usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text,
  email text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- VEICULOS (substitui a chave "hm_vehicles")
-- ----------------------------------------------------------------------------
create table if not exists veiculos (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid references categorias (id),
  marca_id uuid references marcas (id),
  modelo text not null,
  ano integer not null,
  km integer not null default 0,
  preco numeric(12, 2) not null default 0,
  cambio text,
  combustivel text,
  cor text,
  badge text not null default 'seminovo' check (badge in ('seminovo', 'consignado', 'destaque')),
  ativo boolean not null default true,
  descricao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_veiculos_ativo on veiculos (ativo);
create index if not exists idx_veiculos_categoria on veiculos (categoria_id);

-- Só um veículo "destaque" por vez (mesma regra que já existia no admin.js)
create unique index if not exists idx_veiculos_unico_destaque
  on veiculos ((badge = 'destaque'))
  where badge = 'destaque';

-- ----------------------------------------------------------------------------
-- MIDIAS_VEICULO (fotos — ficam no Storage, não mais em Base64 no banco)
-- ----------------------------------------------------------------------------
create table if not exists midias_veiculo (
  id uuid primary key default gen_random_uuid(),
  veiculo_id uuid not null references veiculos (id) on delete cascade,
  storage_path text, -- nulo quando a foto é uma URL externa colada no painel (não passou pelo Storage)
  url text not null,
  principal boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_midias_veiculo on midias_veiculo (veiculo_id);

-- ----------------------------------------------------------------------------
-- CONSIGNACOES (substitui a chave "hm_consig")
-- ----------------------------------------------------------------------------
create table if not exists consignacoes (
  id uuid primary key default gen_random_uuid(),
  proprietario text not null,
  contato text not null,
  veiculo_descricao text not null,
  placa text,
  valor numeric(12, 2),
  data_entrada date,
  status text not null default 'ativo' check (status in ('ativo', 'negociando', 'vendido', 'devolvido')),
  comissao text,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- CONFIGURACOES_LOJA (substitui a chave "hm_config" — linha única, id fixo)
-- ----------------------------------------------------------------------------
create table if not exists configuracoes_loja (
  id smallint primary key default 1 check (id = 1),
  nome text not null default 'Holanda Motors',
  endereco text not null default '',
  whatsapp text not null default '',
  instagram text not null default '',
  horario_semana text not null default '',
  horario_sabado text not null default '',
  sobre text not null default '',
  mostrar_hero boolean not null default true,
  mostrar_consignacao boolean not null default true,
  botao_whatsapp_flutuante boolean not null default true,
  ocultar_sem_foto boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ATIVIDADES (substitui a chave "hm_activity" — log do dashboard)
-- ----------------------------------------------------------------------------
create table if not exists atividades (
  id uuid primary key default gen_random_uuid(),
  mensagem text not null,
  cor text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table categorias enable row level security;
alter table marcas enable row level security;
alter table usuarios enable row level security;
alter table veiculos enable row level security;
alter table midias_veiculo enable row level security;
alter table consignacoes enable row level security;
alter table configuracoes_loja enable row level security;
alter table atividades enable row level security;

-- Nota sobre idempotência: toda política abaixo tem um "drop policy if
-- exists" imediatamente antes (mesmo na primeira vez que aparece no
-- arquivo) — sem isso, colar o script de novo num projeto existente falha
-- na primeiríssima política com "policy already exists" e aborta antes de
-- chegar nas partes 2/3, mesmo que aquelas já fossem "if exists" corretas.

-- categorias: leitura pública, escrita só autenticado
drop policy if exists "categorias_select_public" on categorias;
create policy "categorias_select_public" on categorias for select using (true);
drop policy if exists "categorias_write_auth" on categorias;
create policy "categorias_write_auth" on categorias for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- marcas: leitura pública, escrita só autenticado
drop policy if exists "marcas_select_public" on marcas;
create policy "marcas_select_public" on marcas for select using (true);
drop policy if exists "marcas_write_auth" on marcas;
create policy "marcas_write_auth" on marcas for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- veiculos: leitura pública só dos ativos; autenticado vê e edita tudo
-- (a política de select público é substituída na Parte 2 para também
-- excluir vendidos — criada aqui em sua forma original só para o projeto
-- nunca ficar num estado intermediário sem RLS caso o script pare no meio)
drop policy if exists "veiculos_select_public_ativos" on veiculos;
create policy "veiculos_select_public_ativos" on veiculos for select using (ativo = true);
drop policy if exists "veiculos_select_auth_todos" on veiculos;
create policy "veiculos_select_auth_todos" on veiculos for select using (auth.role() = 'authenticated');
drop policy if exists "veiculos_write_auth" on veiculos;
create policy "veiculos_write_auth" on veiculos for insert with check (auth.role() = 'authenticated');
drop policy if exists "veiculos_update_auth" on veiculos;
create policy "veiculos_update_auth" on veiculos for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "veiculos_delete_auth" on veiculos;
create policy "veiculos_delete_auth" on veiculos for delete using (auth.role() = 'authenticated');

-- midias_veiculo: leitura pública (fotos não são sensíveis), escrita só autenticado
drop policy if exists "midias_select_public" on midias_veiculo;
create policy "midias_select_public" on midias_veiculo for select using (true);
drop policy if exists "midias_write_auth" on midias_veiculo;
create policy "midias_write_auth" on midias_veiculo for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- consignacoes: uso interno, nunca público (substituída por 4 políticas
-- específicas na Parte 2 — criada aqui pelo mesmo motivo acima)
drop policy if exists "consignacoes_auth_only" on consignacoes;
create policy "consignacoes_auth_only" on consignacoes for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- configuracoes_loja: leitura pública (o site usa), escrita só autenticado
drop policy if exists "config_select_public" on configuracoes_loja;
create policy "config_select_public" on configuracoes_loja for select using (true);
drop policy if exists "config_write_auth" on configuracoes_loja;
create policy "config_write_auth" on configuracoes_loja for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- atividades: descontinuada (ver Parte 2 → logs_acoes), mantida só por
-- compatibilidade com projetos que já rodaram a Parte 1 antes dela existir
drop policy if exists "atividades_auth_only" on atividades;
create policy "atividades_auth_only" on atividades for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- usuarios: cada admin vê seu próprio perfil; autenticado vê todos nesta
-- versão inicial (restrito por nível de acesso na Parte 2)
drop policy if exists "usuarios_select_auth" on usuarios;
create policy "usuarios_select_auth" on usuarios for select using (auth.role() = 'authenticated');
drop policy if exists "usuarios_upsert_self" on usuarios;
create policy "usuarios_upsert_self" on usuarios for insert with check (auth.uid() = id);
drop policy if exists "usuarios_update_self" on usuarios;
create policy "usuarios_update_self" on usuarios for update using (auth.uid() = id) with check (auth.uid() = id);

-- ============================================================================
-- STORAGE — bucket de fotos dos veículos
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('veiculos-fotos', 'veiculos-fotos', true)
on conflict (id) do nothing;

drop policy if exists "veiculos_fotos_select_public" on storage.objects;
create policy "veiculos_fotos_select_public" on storage.objects for select
  using (bucket_id = 'veiculos-fotos');

drop policy if exists "veiculos_fotos_write_auth" on storage.objects;
create policy "veiculos_fotos_write_auth" on storage.objects for insert
  with check (bucket_id = 'veiculos-fotos' and auth.role() = 'authenticated');

drop policy if exists "veiculos_fotos_update_auth" on storage.objects;
create policy "veiculos_fotos_update_auth" on storage.objects for update
  using (bucket_id = 'veiculos-fotos' and auth.role() = 'authenticated')
  with check (bucket_id = 'veiculos-fotos' and auth.role() = 'authenticated');

drop policy if exists "veiculos_fotos_delete_auth" on storage.objects;
create policy "veiculos_fotos_delete_auth" on storage.objects for delete
  using (bucket_id = 'veiculos-fotos' and auth.role() = 'authenticated');

-- ============================================================================
-- PARTE 2 — Auditoria pós-migração: correções e novas funcionalidades
-- ----------------------------------------------------------------------------
-- Todo este arquivo é seguro para reexecutar (idempotente): usa
-- "if not exists" / "on conflict do nothing" / "drop ... if exists" em
-- tudo. Se você já rodou a Parte 1 num projeto existente, pode colar o
-- arquivo inteiro de novo no SQL Editor sem medo de duplicar nada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Novas colunas em VEICULOS: placa (para a busca instantânea) e vendido
-- (separado de "ativo" — ativo controla visibilidade no site, vendido é o
-- status comercial; marcar como vendido também oculta do site, ver RLS abaixo)
-- ----------------------------------------------------------------------------
alter table veiculos add column if not exists placa text;
alter table veiculos add column if not exists vendido boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'veiculos_ano_valido') then
    alter table veiculos add constraint veiculos_ano_valido check (ano between 1900 and 2100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'veiculos_km_valido') then
    alter table veiculos add constraint veiculos_km_valido check (km >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'veiculos_preco_valido') then
    alter table veiculos add constraint veiculos_preco_valido check (preco >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'consignacoes_valor_valido') then
    alter table consignacoes add constraint consignacoes_valor_valido check (valor is null or valor >= 0);
  end if;
end $$;

-- Índices para desempenho conforme o estoque cresce, incluindo busca
-- "contém" (ILIKE) por trigrama — usado pela pesquisa instantânea do painel.
create extension if not exists pg_trgm;
create index if not exists idx_veiculos_marca on veiculos (marca_id);
create index if not exists idx_veiculos_vendido on veiculos (vendido);
create index if not exists idx_veiculos_placa on veiculos (placa);
create index if not exists idx_veiculos_modelo_trgm on veiculos using gin (modelo gin_trgm_ops);
create index if not exists idx_veiculos_placa_trgm on veiculos using gin (placa gin_trgm_ops);
create index if not exists idx_consignacoes_status on consignacoes (status);
create index if not exists idx_consignacoes_placa on consignacoes (placa);

-- No máximo uma foto "principal" por veículo — antes só a aplicação
-- garantia isso; agora é uma constraint de banco também.
create unique index if not exists idx_midias_veiculo_unico_principal
  on midias_veiculo (veiculo_id) where principal = true;

-- ----------------------------------------------------------------------------
-- NÍVEIS DE ACESSO: administrador / gerente / vendedor
-- ----------------------------------------------------------------------------
alter table usuarios add column if not exists role text not null default 'vendedor';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'usuarios_role_valido') then
    alter table usuarios add constraint usuarios_role_valido check (role in ('administrador', 'gerente', 'vendedor'));
  end if;
end $$;

-- Função auxiliar (SECURITY DEFINER para não recursar nas políticas de RLS
-- de "usuarios" quando outras políticas a chamam).
create or replace function public.current_user_role()
returns text
language sql
security definer
stable
as $$
  select role from public.usuarios where id = auth.uid();
$$;
grant execute on function public.current_user_role() to authenticated;

-- Cria automaticamente o perfil em "usuarios" quando alguém é criado no
-- Supabase Auth (dashboard → Authentication → Users). O primeiro usuário
-- do sistema vira "administrador" automaticamente; os seguintes entram
-- como "vendedor" por padrão — promova-os depois em Usuários no painel
-- (ou na tabela "usuarios" do Table Editor).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usuarios (id, email, nome, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.usuarios) then 'vendedor' else 'administrador' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Impede que um usuário promova a si mesmo (ou a qualquer um) alterando
-- a própria coluna "role" — só quem já é administrador pode mudar papéis.
-- Achado na auditoria: a política antiga de "update self" permitia isso.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.role is distinct from old.role and public.current_user_role() <> 'administrador' then
    raise exception 'Apenas administradores podem alterar o nível de acesso de um usuário.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_role_self_escalation on usuarios;
create trigger trg_prevent_role_self_escalation
  before update on usuarios
  for each row execute function public.prevent_role_self_escalation();

-- ----------------------------------------------------------------------------
-- LOGS_ACOES — trilha de auditoria (ações de usuários + histórico por
-- veículo, filtrando por entidade/entidade_id). Somente leitura depois de
-- inserido: não há política de update/delete, então nada pode alterar um
-- log já gravado (nem o próprio autor).
-- ----------------------------------------------------------------------------
create table if not exists logs_acoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references auth.users (id) on delete set null,
  usuario_email text,
  acao text not null,
  entidade text not null,
  entidade_id uuid,
  detalhes jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_logs_acoes_entidade on logs_acoes (entidade, entidade_id);
create index if not exists idx_logs_acoes_created on logs_acoes (created_at desc);
create index if not exists idx_logs_acoes_usuario on logs_acoes (usuario_id);

alter table logs_acoes enable row level security;

-- Leitura: você sempre vê suas próprias ações; gerente/administrador vê
-- tudo; qualquer autenticado também vê logs de veículos (entidade =
-- 'veiculo') — é o que alimenta a aba "Histórico" no modal de edição para
-- todos os níveis, já que saber quem mexeu num veículo é operacional, não
-- sensível. O que fica de fato restrito a gerente/administrador é a
-- trilha de login, configurações, usuários e backup.
drop policy if exists "logs_acoes_select_auth" on logs_acoes;
create policy "logs_acoes_select_auth" on logs_acoes for select
  using (
    auth.uid() = usuario_id
    or public.current_user_role() in ('administrador', 'gerente')
    or entidade = 'veiculo'
  );
drop policy if exists "logs_acoes_insert_self" on logs_acoes;
create policy "logs_acoes_insert_self" on logs_acoes for insert with check (auth.role() = 'authenticated' and usuario_id = auth.uid());

-- ----------------------------------------------------------------------------
-- RPC: alterna "ativo" de forma atômica (UPDATE ... SET ativo = NOT ativo
-- em uma única instrução). Achado na auditoria: o painel lia o estado atual
-- do cache local antes de inverter, o que podia perder alterações feitas
-- por outro usuário/aba entre a leitura e a escrita.
-- ----------------------------------------------------------------------------
create or replace function public.toggle_veiculo_ativo(p_id uuid)
returns boolean
language plpgsql
security invoker
as $$
declare
  novo_estado boolean;
begin
  update veiculos set ativo = not ativo, updated_at = now()
  where id = p_id
  returning ativo into novo_estado;

  if novo_estado is null then
    raise exception 'Veículo não encontrado.';
  end if;
  return novo_estado;
end;
$$;
grant execute on function public.toggle_veiculo_ativo(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS — ajustes por nível de acesso e correção de gaps encontrados na
-- auditoria (todas recriadas com "drop policy if exists" antes, então é
-- seguro reexecutar).
-- ----------------------------------------------------------------------------

-- Veículo vendido não aparece mais no site público mesmo que "ativo" não
-- tenha sido desmarcado manualmente (defesa em profundidade).
drop policy if exists "veiculos_select_public_ativos" on veiculos;
create policy "veiculos_select_public_ativos" on veiculos for select using (ativo = true and vendido = false);

-- Excluir veículo/consignação exige gerente ou administrador — vendedor
-- pode cadastrar e editar, mas não apagar.
drop policy if exists "veiculos_delete_auth" on veiculos;
create policy "veiculos_delete_auth" on veiculos for delete using (public.current_user_role() in ('administrador', 'gerente'));

drop policy if exists "consignacoes_auth_only" on consignacoes;
drop policy if exists "consignacoes_select_auth" on consignacoes;
create policy "consignacoes_select_auth" on consignacoes for select using (auth.role() = 'authenticated');
drop policy if exists "consignacoes_insert_auth" on consignacoes;
create policy "consignacoes_insert_auth" on consignacoes for insert with check (auth.role() = 'authenticated');
drop policy if exists "consignacoes_update_auth" on consignacoes;
create policy "consignacoes_update_auth" on consignacoes for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
drop policy if exists "consignacoes_delete_auth" on consignacoes;
create policy "consignacoes_delete_auth" on consignacoes for delete using (public.current_user_role() in ('administrador', 'gerente'));

-- Configurações da loja: só gerente/administrador altera.
drop policy if exists "config_write_auth" on configuracoes_loja;
create policy "config_write_auth" on configuracoes_loja for update using (public.current_user_role() in ('administrador', 'gerente')) with check (public.current_user_role() in ('administrador', 'gerente'));

-- usuarios: restringe a leitura — antes qualquer autenticado via a lista
-- completa de nomes/e-mails/papéis; agora só o próprio perfil, ou
-- gerente/administrador vendo todos (a tela "Usuários" já é admin-only,
-- isso fecha a mesma brecha para quem tentasse chamar a API direto).
drop policy if exists "usuarios_select_auth" on usuarios;
create policy "usuarios_select_auth" on usuarios for select
  using (auth.uid() = id or public.current_user_role() in ('administrador', 'gerente'));

-- um administrador também pode atualizar o perfil de OUTRO usuário
-- (necessário para a tela de gestão de papéis); o gatilho acima garante
-- que só ele pode mudar a coluna "role" especificamente.
drop policy if exists "usuarios_update_self" on usuarios;
create policy "usuarios_update_self" on usuarios for update
  using (auth.uid() = id or public.current_user_role() = 'administrador')
  with check (auth.uid() = id or public.current_user_role() = 'administrador');

-- ============================================================================
-- SEED — dados padrão (categorias, marcas do catálogo de demonstração e a
-- linha única de configurações da loja). Os veículos/consignações de
-- demonstração NÃO são semeados aqui — eles chegam via a rotina de migração
-- (migrar-localstorage.html) a partir do que já está no localStorage do navegador, ou
-- você cadastra do zero pelo painel.
-- ============================================================================

insert into categorias (slug, nome) values
  ('carro', 'Carro'),
  ('moto', 'Moto')
on conflict (slug) do nothing;

insert into marcas (nome) values
  ('Jeep'), ('Chevrolet'), ('Audi'), ('Honda'), ('Toyota'), ('Hyundai'), ('Yamaha')
on conflict (nome) do nothing;

insert into configuracoes_loja (id, nome, endereco, whatsapp, instagram, horario_semana, horario_sabado, sobre)
values (
  1,
  'Holanda Motors',
  'Av. Lúcia Sabóia, nº 240, Centro, Sobral - CE, 62010-830',
  '5585997576262',
  '@holanda_motors',
  '08h às 18h',
  '08h às 13h',
  'Carros e motos seminovos com qualidade de showroom, atendimento transparente e o melhor preço de Sobral.'
)
on conflict (id) do nothing;

-- ============================================================================
-- PARTE 3 — Migração idempotente a partir do localStorage (migrar-localstorage.html)
-- ----------------------------------------------------------------------------
-- "legacy_id" guarda o id do registro no sistema antigo (localStorage).
-- É assim que a página de migração sabe, mesmo em uma reexecução dias
-- depois ou em outro computador, que um veículo/consignação já foi
-- importado — sem isso, rodar a migração duas vezes duplicaria tudo.
-- O índice é único mas parcial (só considera linhas com legacy_id
-- preenchido), então não interfere em nada criado normalmente pelo painel.
-- ============================================================================

alter table veiculos add column if not exists legacy_id text;
alter table consignacoes add column if not exists legacy_id text;

create unique index if not exists idx_veiculos_legacy_id on veiculos (legacy_id) where legacy_id is not null;
create unique index if not exists idx_consignacoes_legacy_id on consignacoes (legacy_id) where legacy_id is not null;

-- ============================================================================
-- PARTE 4 — Simulador de parcelamento
-- ----------------------------------------------------------------------------
-- Parâmetros ficam em configuracoes_loja (editáveis em Configurações no
-- painel) em vez de fixos no código — a loja ajusta taxa/entrada/parcelas
-- máximas sem precisar de uma alteração de código. O cálculo em si (juros
-- compostos, tabela Price) é feito no navegador, ver assets/js/site.js.
-- ============================================================================

alter table configuracoes_loja add column if not exists parcelamento_ativo boolean not null default true;
alter table configuracoes_loja add column if not exists parcelamento_juros_mensal numeric(5, 2) not null default 1.99;
alter table configuracoes_loja add column if not exists parcelamento_entrada_padrao numeric(5, 2) not null default 20;
alter table configuracoes_loja add column if not exists parcelamento_max_parcelas integer not null default 48;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'config_juros_valido') then
    alter table configuracoes_loja add constraint config_juros_valido check (parcelamento_juros_mensal >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'config_entrada_valida') then
    alter table configuracoes_loja add constraint config_entrada_valida check (parcelamento_entrada_padrao >= 0 and parcelamento_entrada_padrao <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'config_parcelas_valido') then
    alter table configuracoes_loja add constraint config_parcelas_valido check (parcelamento_max_parcelas > 0 and parcelamento_max_parcelas <= 120);
  end if;
end $$;

-- ============================================================================
-- PARTE 5 — Contador de interesse por veículo
-- ----------------------------------------------------------------------------
-- Registra cada "visualização" (abriu o modal de detalhes) e clique em
-- WhatsApp por veículo — dá pra ver no painel quais anúncios realmente
-- geram interesse. Tabela de INSERT público (o site é anônimo), mas
-- leitura só para quem está autenticado — visitante nunca vê os números
-- de ninguém, só consegue registrar o próprio clique.
--
-- Trade-off consciente: como o insert é público e sem limite de taxa,
-- alguém tecnicamente poderia inflar a contagem de um veículo com
-- requisições repetidas. Não há dado sensível em risco (só um contador),
-- então não implementamos limitação de taxa por ora — ver README.
-- Ao contrário de "atividades"/"logs_acoes", esta tabela não é podada
-- automaticamente: é um histórico de eventos, útil de manter completo
-- para análise de tendência ao longo do tempo.
-- ============================================================================

create table if not exists interacoes_veiculo (
  id uuid primary key default gen_random_uuid(),
  veiculo_id uuid not null references veiculos (id) on delete cascade,
  tipo text not null check (tipo in ('visualizacao', 'whatsapp')),
  created_at timestamptz not null default now()
);

create index if not exists idx_interacoes_veiculo on interacoes_veiculo (veiculo_id, tipo);
create index if not exists idx_interacoes_veiculo_created on interacoes_veiculo (created_at desc);

alter table interacoes_veiculo enable row level security;

drop policy if exists "interacoes_insert_public" on interacoes_veiculo;
create policy "interacoes_insert_public" on interacoes_veiculo for insert with check (true);

drop policy if exists "interacoes_select_auth" on interacoes_veiculo;
create policy "interacoes_select_auth" on interacoes_veiculo for select using (auth.role() = 'authenticated');

-- ============================================================================
-- PARTE 6 — Auditoria de segurança e performance (achados do Advisor do Supabase)
-- ----------------------------------------------------------------------------
-- Corrige achados do linter oficial (aba Advisors do dashboard): search_path
-- mutável em funções SECURITY DEFINER, funções de trigger executáveis via
-- RPC público sem necessidade, políticas de RLS reavaliando
-- auth.role()/auth.uid() a cada linha em vez de uma vez por consulta, e
-- políticas permissivas duplicadas nas tabelas de leitura pública.
-- Idempotente como o resto do arquivo.
-- ============================================================================

-- search_path fixo (mitiga sequestro de resolução de nomes por SECURITY
-- DEFINER caso alguma role ganhe CREATE em public no futuro).
create or replace function public.current_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.usuarios where id = auth.uid();
$$;

create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and public.current_user_role() <> 'administrador' then
    raise exception 'Apenas administradores podem alterar o nível de acesso de um usuário.';
  end if;
  return new;
end;
$$;

create or replace function public.toggle_veiculo_ativo(p_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  novo_estado boolean;
begin
  update veiculos set ativo = not ativo, updated_at = now()
  where id = p_id
  returning ativo into novo_estado;

  if novo_estado is null then
    raise exception 'Veículo não encontrado.';
  end if;
  return novo_estado;
end;
$$;

-- handle_new_user e prevent_role_self_escalation só existem para disparar via
-- trigger — revogar de PUBLIC fecha a chamada via RPC direta sem afetar o
-- disparo automático dos triggers (não depende do chamador ter EXECUTE).
-- current_user_role() continua acessível a PUBLIC de propósito: é usada
-- dentro de outras políticas de RLS, inclusive em tabelas que o anônimo
-- também consulta — revogar quebraria a avaliação dessas políticas para
-- visitantes não autenticados.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.prevent_role_self_escalation() from public, anon, authenticated;

-- ── RLS: elimina políticas permissivas duplicadas e evita reavaliar
-- auth.role()/auth.uid()/current_user_role() linha a linha ──

drop policy if exists "categorias_write_auth" on categorias;
drop policy if exists "categorias_insert_auth" on categorias;
create policy "categorias_insert_auth" on categorias for insert with check ((select auth.role()) = 'authenticated');
drop policy if exists "categorias_update_auth" on categorias;
create policy "categorias_update_auth" on categorias for update using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
drop policy if exists "categorias_delete_auth" on categorias;
create policy "categorias_delete_auth" on categorias for delete using ((select auth.role()) = 'authenticated');

drop policy if exists "marcas_write_auth" on marcas;
drop policy if exists "marcas_insert_auth" on marcas;
create policy "marcas_insert_auth" on marcas for insert with check ((select auth.role()) = 'authenticated');
drop policy if exists "marcas_update_auth" on marcas;
create policy "marcas_update_auth" on marcas for update using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
drop policy if exists "marcas_delete_auth" on marcas;
create policy "marcas_delete_auth" on marcas for delete using ((select auth.role()) = 'authenticated');

drop policy if exists "midias_write_auth" on midias_veiculo;
drop policy if exists "midias_insert_auth" on midias_veiculo;
create policy "midias_insert_auth" on midias_veiculo for insert with check ((select auth.role()) = 'authenticated');
drop policy if exists "midias_update_auth" on midias_veiculo;
create policy "midias_update_auth" on midias_veiculo for update using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
drop policy if exists "midias_delete_auth" on midias_veiculo;
create policy "midias_delete_auth" on midias_veiculo for delete using ((select auth.role()) = 'authenticated');

-- veiculos: "select_public_ativos" e "select_auth_todos" eram duas políticas
-- de SELECT avaliadas em toda consulta — mescladas em uma só com OR, mesmo
-- resultado (autenticado vê tudo, anônimo só ativo+não vendido).
drop policy if exists "veiculos_select_public_ativos" on veiculos;
drop policy if exists "veiculos_select_auth_todos" on veiculos;
drop policy if exists "veiculos_select" on veiculos;
create policy "veiculos_select" on veiculos for select
  using ((select auth.role()) = 'authenticated' or (ativo = true and vendido = false));

drop policy if exists "veiculos_write_auth" on veiculos;
create policy "veiculos_write_auth" on veiculos for insert with check ((select auth.role()) = 'authenticated');
drop policy if exists "veiculos_update_auth" on veiculos;
create policy "veiculos_update_auth" on veiculos for update using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
drop policy if exists "veiculos_delete_auth" on veiculos;
create policy "veiculos_delete_auth" on veiculos for delete using ((select public.current_user_role()) in ('administrador', 'gerente'));

drop policy if exists "consignacoes_select_auth" on consignacoes;
create policy "consignacoes_select_auth" on consignacoes for select using ((select auth.role()) = 'authenticated');
drop policy if exists "consignacoes_insert_auth" on consignacoes;
create policy "consignacoes_insert_auth" on consignacoes for insert with check ((select auth.role()) = 'authenticated');
drop policy if exists "consignacoes_update_auth" on consignacoes;
create policy "consignacoes_update_auth" on consignacoes for update using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
drop policy if exists "consignacoes_delete_auth" on consignacoes;
create policy "consignacoes_delete_auth" on consignacoes for delete using ((select public.current_user_role()) in ('administrador', 'gerente'));

drop policy if exists "config_write_auth" on configuracoes_loja;
create policy "config_write_auth" on configuracoes_loja for update using ((select public.current_user_role()) in ('administrador', 'gerente')) with check ((select public.current_user_role()) in ('administrador', 'gerente'));

drop policy if exists "atividades_auth_only" on atividades;
create policy "atividades_auth_only" on atividades for all using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');

drop policy if exists "usuarios_select_auth" on usuarios;
create policy "usuarios_select_auth" on usuarios for select
  using ((select auth.uid()) = id or (select public.current_user_role()) in ('administrador', 'gerente'));
drop policy if exists "usuarios_upsert_self" on usuarios;
create policy "usuarios_upsert_self" on usuarios for insert with check ((select auth.uid()) = id);
drop policy if exists "usuarios_update_self" on usuarios;
create policy "usuarios_update_self" on usuarios for update
  using ((select auth.uid()) = id or (select public.current_user_role()) = 'administrador')
  with check ((select auth.uid()) = id or (select public.current_user_role()) = 'administrador');

drop policy if exists "logs_acoes_select_auth" on logs_acoes;
create policy "logs_acoes_select_auth" on logs_acoes for select
  using (
    (select auth.uid()) = usuario_id
    or (select public.current_user_role()) in ('administrador', 'gerente')
    or entidade = 'veiculo'
  );
drop policy if exists "logs_acoes_insert_self" on logs_acoes;
create policy "logs_acoes_insert_self" on logs_acoes for insert with check ((select auth.role()) = 'authenticated' and usuario_id = (select auth.uid()));

drop policy if exists "interacoes_select_auth" on interacoes_veiculo;
create policy "interacoes_select_auth" on interacoes_veiculo for select using ((select auth.role()) = 'authenticated');

drop policy if exists "veiculos_fotos_write_auth" on storage.objects;
create policy "veiculos_fotos_write_auth" on storage.objects for insert
  with check (bucket_id = 'veiculos-fotos' and (select auth.role()) = 'authenticated');

drop policy if exists "veiculos_fotos_update_auth" on storage.objects;
create policy "veiculos_fotos_update_auth" on storage.objects for update
  using (bucket_id = 'veiculos-fotos' and (select auth.role()) = 'authenticated')
  with check (bucket_id = 'veiculos-fotos' and (select auth.role()) = 'authenticated');

drop policy if exists "veiculos_fotos_delete_auth" on storage.objects;
create policy "veiculos_fotos_delete_auth" on storage.objects for delete
  using (bucket_id = 'veiculos-fotos' and (select auth.role()) = 'authenticated');

-- pg_trgm fora do schema public (ALTER EXTENSION ... SET SCHEMA preserva os
-- índices GIN já criados, não precisa recriá-los).
create schema if not exists extensions;
do $$
begin
  if exists (
    select 1 from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm' and n.nspname = 'public'
  ) then
    alter extension pg_trgm set schema extensions;
  end if;
end $$;

-- ============================================================================
-- PARTE 7 — Lista de e-mails autorizados a entrar via login social (Google)
-- ----------------------------------------------------------------------------
-- Login por e-mail/senha só funciona pra contas criadas pelo administrador no
-- dashboard do Supabase (lista fechada). Login social (Google) não tem essa
-- restrição por padrão — qualquer conta do Google conseguiria criar um perfil
-- "vendedor" e acessar o estoque. Esta tabela fecha essa brecha: só e-mails
-- cadastrados aqui conseguem concluir o login via provedor social.
-- ============================================================================

create table if not exists emails_permitidos (
  email text primary key,
  criado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table emails_permitidos enable row level security;

drop policy if exists "emails_permitidos_admin_only" on emails_permitidos;
create policy "emails_permitidos_admin_only" on emails_permitidos for all
  using ((select public.current_user_role()) = 'administrador')
  with check ((select public.current_user_role()) = 'administrador');

-- Substitui handle_new_user (Parte 2): agora rejeita login social de e-mails
-- fora da lista, mas continua sem restrição pra login por e-mail/senha (já é
-- fechado por natureza — só quem tem acesso ao dashboard cria essas contas) e
-- pro primeiro usuário do sistema (bootstrap inicial, vira administrador).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.usuarios)
     and coalesce(new.raw_app_meta_data ->> 'provider', 'email') <> 'email'
     and not exists (select 1 from public.emails_permitidos where lower(email) = lower(new.email)) then
    raise exception 'E-mail não autorizado a acessar o painel via login social.';
  end if;

  insert into public.usuarios (id, email, nome, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.usuarios) then 'vendedor' else 'administrador' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ============================================================================
-- PARTE 8 — Módulo Financeiro (Fase 1: fundação completa do schema)
-- ----------------------------------------------------------------------------
-- Ledger único (lancamentos_financeiros) em vez de tabelas separadas por
-- página — Fluxo de Caixa, Contas a Receber/Pagar, Despesas e Receitas são
-- todos essa mesma tabela sob filtros diferentes (tipo/status/origem).
-- Todo o módulo é restrito a gerente/administrador (RLS) — vendedor não
-- enxerga nenhum dado financeiro. Idempotente como o resto do arquivo.
-- ============================================================================

create table if not exists categorias_financeiras (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('entrada', 'saida')),
  nome text not null,
  categoria_pai_id uuid references categorias_financeiras (id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_categorias_financeiras_raiz
  on categorias_financeiras (tipo, nome) where categoria_pai_id is null;
create unique index if not exists idx_categorias_financeiras_sub
  on categorias_financeiras (tipo, nome, categoria_pai_id) where categoria_pai_id is not null;
create index if not exists idx_categorias_financeiras_pai on categorias_financeiras (categoria_pai_id);

create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cpf_cnpj text,
  telefone text,
  created_at timestamptz not null default now()
);

create table if not exists fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cpf_cnpj text,
  telefone text,
  categoria text,
  created_at timestamptz not null default now()
);

-- status "vencido" não é mantido por job em segundo plano (o projeto não usa
-- pg_cron) — é calculado na consulta (status = 'pendente' e data_vencimento
-- no passado). O valor 'vencido' fica disponível na constraint pra quando o
-- usuário quiser marcar manualmente, mas normalmente nasce e some sozinho
-- conforme pendente vira pago, sem depender de nada rodando periodicamente.
create table if not exists lancamentos_financeiros (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('entrada', 'saida')),
  descricao text not null,
  categoria_id uuid references categorias_financeiras (id) on delete set null,
  subcategoria_id uuid references categorias_financeiras (id) on delete set null,
  valor numeric(12, 2) not null check (valor >= 0),
  valor_pago numeric(12, 2) not null default 0 check (valor_pago >= 0),
  saldo numeric(12, 2) generated always as (valor - valor_pago) stored,
  data_lancamento date not null default current_date,
  data_vencimento date,
  data_pagamento date,
  forma_pagamento text check (forma_pagamento in ('pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'transferencia', 'financiamento', 'cheque')),
  status text not null default 'pendente' check (status in ('pago', 'pendente', 'vencido', 'cancelado')),
  origem text not null default 'manual' check (origem in ('venda', 'consignacao', 'manual')),
  veiculo_id uuid references veiculos (id) on delete set null,
  consignacao_id uuid references consignacoes (id) on delete set null,
  cliente_id uuid references clientes (id) on delete set null,
  fornecedor_id uuid references fornecedores (id) on delete set null,
  responsavel_id uuid references auth.users (id) on delete set null,
  numero_documento text,
  numero_parcela integer,
  total_parcelas integer,
  centro_custo text,
  observacoes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint lancamentos_valor_pago_valido check (valor_pago <= valor)
);

create index if not exists idx_lancamentos_data on lancamentos_financeiros (data_lancamento desc);
create index if not exists idx_lancamentos_vencimento on lancamentos_financeiros (data_vencimento);
create index if not exists idx_lancamentos_status on lancamentos_financeiros (status);
create index if not exists idx_lancamentos_tipo on lancamentos_financeiros (tipo);
create index if not exists idx_lancamentos_categoria on lancamentos_financeiros (categoria_id);
create index if not exists idx_lancamentos_subcategoria on lancamentos_financeiros (subcategoria_id);
create index if not exists idx_lancamentos_cliente on lancamentos_financeiros (cliente_id);
create index if not exists idx_lancamentos_fornecedor on lancamentos_financeiros (fornecedor_id);
create index if not exists idx_lancamentos_veiculo on lancamentos_financeiros (veiculo_id);
create index if not exists idx_lancamentos_consignacao on lancamentos_financeiros (consignacao_id);
create index if not exists idx_lancamentos_responsavel on lancamentos_financeiros (responsavel_id);

-- ----------------------------------------------------------------------------
-- RLS — todo o módulo restrito a gerente/administrador; exclusão só admin.
-- ----------------------------------------------------------------------------
alter table categorias_financeiras enable row level security;
alter table clientes enable row level security;
alter table fornecedores enable row level security;
alter table lancamentos_financeiros enable row level security;

drop policy if exists "categorias_financeiras_select" on categorias_financeiras;
create policy "categorias_financeiras_select" on categorias_financeiras for select
  using ((select public.current_user_role()) in ('gerente', 'administrador'));
drop policy if exists "categorias_financeiras_insert" on categorias_financeiras;
create policy "categorias_financeiras_insert" on categorias_financeiras for insert
  with check ((select public.current_user_role()) in ('gerente', 'administrador'));
drop policy if exists "categorias_financeiras_update" on categorias_financeiras;
create policy "categorias_financeiras_update" on categorias_financeiras for update
  using ((select public.current_user_role()) in ('gerente', 'administrador'))
  with check ((select public.current_user_role()) in ('gerente', 'administrador'));
drop policy if exists "categorias_financeiras_delete" on categorias_financeiras;
create policy "categorias_financeiras_delete" on categorias_financeiras for delete
  using ((select public.current_user_role()) = 'administrador');

drop policy if exists "clientes_select" on clientes;
create policy "clientes_select" on clientes for select
  using ((select public.current_user_role()) in ('gerente', 'administrador'));
drop policy if exists "clientes_insert" on clientes;
create policy "clientes_insert" on clientes for insert
  with check ((select public.current_user_role()) in ('gerente', 'administrador'));
drop policy if exists "clientes_update" on clientes;
create policy "clientes_update" on clientes for update
  using ((select public.current_user_role()) in ('gerente', 'administrador'))
  with check ((select public.current_user_role()) in ('gerente', 'administrador'));
drop policy if exists "clientes_delete" on clientes;
create policy "clientes_delete" on clientes for delete
  using ((select public.current_user_role()) = 'administrador');

drop policy if exists "fornecedores_select" on fornecedores;
create policy "fornecedores_select" on fornecedores for select
  using ((select public.current_user_role()) in ('gerente', 'administrador'));
drop policy if exists "fornecedores_insert" on fornecedores;
create policy "fornecedores_insert" on fornecedores for insert
  with check ((select public.current_user_role()) in ('gerente', 'administrador'));
drop policy if exists "fornecedores_update" on fornecedores;
create policy "fornecedores_update" on fornecedores for update
  using ((select public.current_user_role()) in ('gerente', 'administrador'))
  with check ((select public.current_user_role()) in ('gerente', 'administrador'));
drop policy if exists "fornecedores_delete" on fornecedores;
create policy "fornecedores_delete" on fornecedores for delete
  using ((select public.current_user_role()) = 'administrador');

drop policy if exists "lancamentos_select" on lancamentos_financeiros;
create policy "lancamentos_select" on lancamentos_financeiros for select
  using ((select public.current_user_role()) in ('gerente', 'administrador'));
drop policy if exists "lancamentos_insert" on lancamentos_financeiros;
create policy "lancamentos_insert" on lancamentos_financeiros for insert
  with check ((select public.current_user_role()) in ('gerente', 'administrador'));
drop policy if exists "lancamentos_update" on lancamentos_financeiros;
create policy "lancamentos_update" on lancamentos_financeiros for update
  using ((select public.current_user_role()) in ('gerente', 'administrador'))
  with check ((select public.current_user_role()) in ('gerente', 'administrador'));
drop policy if exists "lancamentos_delete" on lancamentos_financeiros;
create policy "lancamentos_delete" on lancamentos_financeiros for delete
  using ((select public.current_user_role()) = 'administrador');

-- ----------------------------------------------------------------------------
-- AUDITORIA — todo insert/update/delete em lancamentos_financeiros gera uma
-- linha em logs_acoes automaticamente (não depende do código cliente lembrar
-- de registrar), com valores antigo/novo em "detalhes". A função só existe
-- pra disparar via trigger — EXECUTE revogado de público/autenticado abaixo,
-- mesmo raciocínio de handle_new_user na Parte 2.
-- ----------------------------------------------------------------------------
create or replace function public.log_lancamento_financeiro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := auth.jwt() ->> 'email';
begin
  if TG_OP = 'INSERT' then
    insert into public.logs_acoes (usuario_id, usuario_email, acao, entidade, entidade_id, detalhes)
    values (auth.uid(), v_email, 'criar', 'lancamento_financeiro', NEW.id,
      jsonb_build_object('resumo', 'criou um lançamento financeiro', 'descricao', NEW.descricao, 'valor_novo', NEW.valor, 'tipo', NEW.tipo));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    insert into public.logs_acoes (usuario_id, usuario_email, acao, entidade, entidade_id, detalhes)
    values (auth.uid(), v_email, 'editar', 'lancamento_financeiro', NEW.id,
      jsonb_build_object(
        'resumo', 'editou um lançamento financeiro',
        'descricao', NEW.descricao,
        'valor_anterior', OLD.valor, 'valor_novo', NEW.valor,
        'valor_pago_anterior', OLD.valor_pago, 'valor_pago_novo', NEW.valor_pago,
        'status_anterior', OLD.status, 'status_novo', NEW.status
      ));
    return NEW;
  elsif TG_OP = 'DELETE' then
    insert into public.logs_acoes (usuario_id, usuario_email, acao, entidade, entidade_id, detalhes)
    values (auth.uid(), v_email, 'excluir', 'lancamento_financeiro', OLD.id,
      jsonb_build_object('resumo', 'excluiu um lançamento financeiro', 'descricao', OLD.descricao, 'valor_anterior', OLD.valor));
    return OLD;
  end if;
  return null;
end;
$$;
revoke execute on function public.log_lancamento_financeiro() from public, anon, authenticated;

drop trigger if exists trg_log_lancamento_financeiro on lancamentos_financeiros;
create trigger trg_log_lancamento_financeiro
  after insert or update or delete on lancamentos_financeiros
  for each row execute function public.log_lancamento_financeiro();

-- ----------------------------------------------------------------------------
-- RPC: baixa (pagamento/recebimento) parcial ou total de forma atômica — a
-- soma acontece dentro do próprio UPDATE, então duas baixas simultâneas no
-- mesmo lançamento nunca se perdem (mesmo raciocínio do toggle_veiculo_ativo).
-- SECURITY INVOKER: roda com o RLS de quem chama, sem precisar duplicar a
-- checagem de papel aqui dentro.
-- ----------------------------------------------------------------------------
create or replace function public.registrar_pagamento(p_id uuid, p_valor numeric, p_data_pagamento date default current_date)
returns lancamentos_financeiros
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row lancamentos_financeiros;
begin
  if p_valor <= 0 then
    raise exception 'O valor do pagamento deve ser maior que zero.';
  end if;

  update lancamentos_financeiros
  set valor_pago = least(valor, valor_pago + p_valor),
      status = case when valor_pago + p_valor >= valor then 'pago' else 'pendente' end,
      data_pagamento = p_data_pagamento,
      updated_at = now()
  where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Lançamento não encontrado.';
  end if;
  return v_row;
end;
$$;
grant execute on function public.registrar_pagamento(uuid, numeric, date) to authenticated;

-- ----------------------------------------------------------------------------
-- SEED — categorias padrão (entrada e saída), cobrindo os exemplos pedidos.
-- ----------------------------------------------------------------------------
insert into categorias_financeiras (tipo, nome) values
  ('entrada', 'Venda de veículo'), ('entrada', 'Consignação'), ('entrada', 'Serviços'),
  ('entrada', 'Comissões recebidas'), ('entrada', 'Financiamentos'), ('entrada', 'Outras receitas'),
  ('saida', 'Combustível'), ('saida', 'Lavagem'), ('saida', 'Polimento'), ('saida', 'Documentação'),
  ('saida', 'Despachante'), ('saida', 'Oficina'), ('saida', 'Marketing'), ('saida', 'Frete'),
  ('saida', 'Alimentação'), ('saida', 'Escritório'), ('saida', 'Fornecedores'), ('saida', 'Impostos'),
  ('saida', 'Aluguel'), ('saida', 'Energia'), ('saida', 'Água'), ('saida', 'Internet'),
  ('saida', 'Funcionários'), ('saida', 'Manutenção'), ('saida', 'Outros')
on conflict do nothing;

-- Índice de FK que ficou faltando na Parte 7 (achado do Advisor).
create index if not exists idx_emails_permitidos_criado_por on emails_permitidos (criado_por);
