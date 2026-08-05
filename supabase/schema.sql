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

-- categorias: leitura pública, escrita só autenticado
create policy "categorias_select_public" on categorias for select using (true);
create policy "categorias_write_auth" on categorias for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- marcas: leitura pública, escrita só autenticado
create policy "marcas_select_public" on marcas for select using (true);
create policy "marcas_write_auth" on marcas for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- veiculos: leitura pública só dos ativos; autenticado vê e edita tudo
create policy "veiculos_select_public_ativos" on veiculos for select using (ativo = true);
create policy "veiculos_select_auth_todos" on veiculos for select using (auth.role() = 'authenticated');
create policy "veiculos_write_auth" on veiculos for insert with check (auth.role() = 'authenticated');
create policy "veiculos_update_auth" on veiculos for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "veiculos_delete_auth" on veiculos for delete using (auth.role() = 'authenticated');

-- midias_veiculo: leitura pública (fotos não são sensíveis), escrita só autenticado
create policy "midias_select_public" on midias_veiculo for select using (true);
create policy "midias_write_auth" on midias_veiculo for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- consignacoes: uso interno, nunca público
create policy "consignacoes_auth_only" on consignacoes for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- configuracoes_loja: leitura pública (o site usa), escrita só autenticado
create policy "config_select_public" on configuracoes_loja for select using (true);
create policy "config_write_auth" on configuracoes_loja for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- atividades: uso interno do painel, nunca público
create policy "atividades_auth_only" on atividades for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- usuarios: cada admin vê seu próprio perfil; autenticado vê todos (painel é de uso interno)
create policy "usuarios_select_auth" on usuarios for select using (auth.role() = 'authenticated');
create policy "usuarios_upsert_self" on usuarios for insert with check (auth.uid() = id);
create policy "usuarios_update_self" on usuarios for update using (auth.uid() = id) with check (auth.uid() = id);

-- ============================================================================
-- STORAGE — bucket de fotos dos veículos
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('veiculos-fotos', 'veiculos-fotos', true)
on conflict (id) do nothing;

create policy "veiculos_fotos_select_public" on storage.objects for select
  using (bucket_id = 'veiculos-fotos');

create policy "veiculos_fotos_write_auth" on storage.objects for insert
  with check (bucket_id = 'veiculos-fotos' and auth.role() = 'authenticated');

create policy "veiculos_fotos_update_auth" on storage.objects for update
  using (bucket_id = 'veiculos-fotos' and auth.role() = 'authenticated')
  with check (bucket_id = 'veiculos-fotos' and auth.role() = 'authenticated');

create policy "veiculos_fotos_delete_auth" on storage.objects for delete
  using (bucket_id = 'veiculos-fotos' and auth.role() = 'authenticated');

-- ============================================================================
-- SEED — dados padrão (categorias, marcas do catálogo de demonstração e a
-- linha única de configurações da loja). Os veículos/consignações de
-- demonstração NÃO são semeados aqui — eles chegam via a rotina de migração
-- (migrar.html) a partir do que já está no localStorage do navegador, ou
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
