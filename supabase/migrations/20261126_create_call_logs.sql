-- ============================================================================
-- ALRIS SaaS — Migration: Tabela call_logs (Discador WebRTC & Omnichannel)
-- Compatível com Supabase (PostgreSQL 15+) com Row Level Security (RLS)
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_id uuid not null references auth.users(id) on delete restrict,
  contact_name text not null default 'Contato Sem Nome',
  phone_number text not null check (phone_number ~ '^\+[1-9]\d{7,14}$'),
  channel text not null check (channel in ('webrtc_voice', 'whatsapp_call')),
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  status text not null default 'initiated' check (
    status in ('initiated', 'ringing', 'connected', 'completed', 'failed')
  ),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  external_call_sid text unique,
  recording_url text,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Índices para consultas rápidas por tenant, operador e linha do tempo
create index if not exists idx_call_logs_org_created
  on public.call_logs (organization_id, created_at desc);

create index if not exists idx_call_logs_agent_created
  on public.call_logs (agent_id, created_at desc);

create index if not exists idx_call_logs_external_sid
  on public.call_logs (external_call_sid);

-- Habilita Row Level Security (Isolamento Multi-Tenant)
alter table public.call_logs enable row level security;

-- Política 1: Operadores e gestores leem apenas chamadas da própria organização
create policy "Users can view organization call logs"
  on public.call_logs
  for select
  to authenticated
  using (
    organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
  );

-- Política 2: Operadores autenticados registram chamadas vinculadas à sua organização
create policy "Agents can insert outbound call logs"
  on public.call_logs
  for insert
  to authenticated
  with check (
    agent_id = auth.uid()
    and organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
  );

-- Política 3: Operador dono da chamada (ou service_role via webhook) atualiza status/duração
create policy "Agents can update own call logs"
  on public.call_logs
  for update
  to authenticated
  using (
    agent_id = auth.uid()
    and organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
  );
