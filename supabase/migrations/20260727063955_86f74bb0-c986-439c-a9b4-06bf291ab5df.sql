-- API cost ledger + per-run budget ceiling.
create table if not exists public.api_cost_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  search_id uuid,
  search_kind text,
  provider text not null,
  operation text not null,
  units integer not null default 1,
  unit_cost_usd numeric(12, 6) not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists api_cost_events_team_created_idx on public.api_cost_events (team_id, created_at desc);
create index if not exists api_cost_events_search_idx on public.api_cost_events (search_id) where search_id is not null;
alter table public.api_cost_events enable row level security;
drop policy if exists "team views own api costs" on public.api_cost_events;
create policy "team views own api costs" on public.api_cost_events for select using (team_id = public.get_user_team(auth.uid()));
drop policy if exists "super admins view all api costs" on public.api_cost_events;
create policy "super admins view all api costs" on public.api_cost_events for select using (exists (select 1 from public.super_admins where user_id = auth.uid()));
grant select on public.api_cost_events to authenticated;
grant all on public.api_cost_events to service_role;

alter table public.team_settings add column if not exists max_run_cost_usd numeric(12, 6) not null default 1.00;

create or replace function public.run_cost_usd(_search_id uuid)
returns numeric language sql stable set search_path to 'public' as $$
  select coalesce(sum(cost_usd), 0) from public.api_cost_events where search_id = _search_id;
$$;

-- MillionVerifier key
alter table public.team_settings add column if not exists millionverifier_api_key text;

-- Social OAuth connections
create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  platform text not null check (platform in ('linkedin','facebook','instagram')),
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  external_id text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform)
);
create index if not exists social_connections_team_idx on public.social_connections (team_id);
alter table public.social_connections enable row level security;
drop policy if exists "users view own social connections" on public.social_connections;
create policy "users view own social connections" on public.social_connections for select to authenticated using (auth.uid() = user_id);
drop policy if exists "users delete own social connections" on public.social_connections;
create policy "users delete own social connections" on public.social_connections for delete to authenticated using (auth.uid() = user_id);
grant select, delete on public.social_connections to authenticated;
grant all on public.social_connections to service_role;

create table if not exists public.social_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  redirect_to text,
  created_at timestamptz not null default now()
);
alter table public.social_oauth_states enable row level security;
grant all on public.social_oauth_states to service_role;

-- Content templates
create table if not exists public.content_templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('email','sms','call_script','dm')),
  platform text check (platform in ('facebook','instagram','linkedin')),
  name text not null,
  description text,
  industry text,
  subject text,
  body_text text not null default '',
  body_html text,
  variables text[] not null default '{}',
  tags text[] not null default '{}',
  is_active boolean not null default true,
  times_used integer not null default 0,
  times_responded integer not null default 0,
  times_converted integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_templates_platform_only_for_dm check ((kind='dm' and platform is not null) or (kind<>'dm' and platform is null)),
  constraint content_templates_subject_only_for_email check (kind='email' or subject is null)
);
create index if not exists content_templates_team_kind_idx on public.content_templates (team_id, kind, is_active);
create index if not exists content_templates_industry_idx on public.content_templates (team_id, industry) where industry is not null;
alter table public.content_templates enable row level security;
drop policy if exists "team views templates" on public.content_templates;
create policy "team views templates" on public.content_templates for select to authenticated using (team_id = public.get_user_team(auth.uid()));
drop policy if exists "team manages templates" on public.content_templates;
create policy "team manages templates" on public.content_templates for all to authenticated using (team_id = public.get_user_team(auth.uid())) with check (team_id = public.get_user_team(auth.uid()));
grant select, insert, update, delete on public.content_templates to authenticated;
grant all on public.content_templates to service_role;

create or replace function public.touch_content_templates_updated_at()
returns trigger language plpgsql set search_path to 'public' as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists content_templates_touch_updated_at on public.content_templates;
create trigger content_templates_touch_updated_at before update on public.content_templates for each row execute function public.touch_content_templates_updated_at();

create or replace function public.template_response_rate(_template_id uuid)
returns numeric language sql stable set search_path to 'public' as $$
  select case when times_used > 0 then round((times_responded::numeric / times_used) * 100, 2) else 0 end
  from public.content_templates where id = _template_id;
$$;

-- AI call sessions
create table if not exists public.ai_call_sessions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  agent_id uuid references public.voice_agents(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  started_by uuid references auth.users(id) on delete set null,
  to_number text not null,
  from_number text not null,
  provider_call_sid text,
  status text not null default 'pending',
  block_reason text,
  disclosure_text text,
  disclosure_spoken_at timestamptz,
  consent_basis text,
  dnc_checked_at timestamptz,
  called_party_timezone text,
  local_call_time time,
  transcript jsonb not null default '[]'::jsonb,
  outcome text,
  duration_seconds integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists ai_call_sessions_team_created_idx on public.ai_call_sessions (team_id, created_at desc);
create index if not exists ai_call_sessions_sid_idx on public.ai_call_sessions (provider_call_sid) where provider_call_sid is not null;
alter table public.ai_call_sessions enable row level security;
drop policy if exists "team views ai calls" on public.ai_call_sessions;
create policy "team views ai calls" on public.ai_call_sessions for select to authenticated using (team_id = public.get_user_team(auth.uid()));
grant select on public.ai_call_sessions to authenticated;
grant all on public.ai_call_sessions to service_role;

alter table public.team_settings
  add column if not exists ai_call_window_start_hour smallint not null default 9 check (ai_call_window_start_hour >= 8 and ai_call_window_start_hour <= 20),
  add column if not exists ai_call_window_end_hour smallint not null default 20 check (ai_call_window_end_hour >= 9 and ai_call_window_end_hour <= 21),
  add column if not exists ai_call_disclosure text not null default 'Hi, this is an AI assistant calling on behalf of {company}. This call may be recorded.',
  add column if not exists ai_calls_enabled boolean not null default false;

create or replace function public.is_number_suppressed(_team_id uuid, _phone text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.dnc_suppression_list
    where team_id = _team_id and type = 'phone'
      and regexp_replace(phone_or_email, '[^0-9]', '', 'g') = regexp_replace(_phone, '[^0-9]', '', 'g')
  );
$$;

-- Team entitlements
create table if not exists public.team_entitlements (
  team_id uuid primary key references public.teams(id) on delete cascade,
  ai_caller boolean not null default false,
  dialer boolean not null default false,
  sms boolean not null default false,
  email_campaigns boolean not null default false,
  discovery boolean not null default false,
  social_dm boolean not null default false,
  daily_email_limit integer not null default 300,
  daily_sms_limit integer not null default 100,
  monthly_ai_call_minutes integer not null default 0,
  overage_allowed boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.team_entitlements enable row level security;
drop policy if exists "team views own entitlements" on public.team_entitlements;
create policy "team views own entitlements" on public.team_entitlements for select to authenticated
  using (team_id = public.get_user_team(auth.uid()) or exists (select 1 from public.super_admins where user_id = auth.uid()));
grant select on public.team_entitlements to authenticated;
grant all on public.team_entitlements to service_role;

insert into public.team_entitlements (team_id, ai_caller, dialer, sms, email_campaigns, discovery, social_dm, daily_email_limit, monthly_ai_call_minutes, overage_allowed)
select t.id, t.plan='agency', t.plan in ('growth','agency'), t.plan in ('growth','agency'), true, t.plan in ('growth','agency'), t.plan='agency',
  case t.plan when 'starter' then 300 when 'growth' then 1000 else 5000 end,
  case t.plan when 'agency' then 500 else 0 end, t.plan <> 'starter'
from public.teams t on conflict (team_id) do nothing;

alter table public.teams add column if not exists brand_color text check (brand_color is null or brand_color ~* '^#[0-9a-f]{6}$');

create table if not exists public.platform_rate_card (
  id uuid primary key default gen_random_uuid(),
  unit_key text not null unique,
  label text not null,
  cost_usd numeric(12, 6) not null default 0,
  credits_charged numeric(12, 4) not null default 1,
  vendor text,
  notes text,
  updated_at timestamptz not null default now()
);
alter table public.platform_rate_card enable row level security;
drop policy if exists "super admins manage rate card" on public.platform_rate_card;
create policy "super admins manage rate card" on public.platform_rate_card for all to authenticated
  using (exists (select 1 from public.super_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.super_admins where user_id = auth.uid()));
grant select, insert, update, delete on public.platform_rate_card to authenticated;
grant all on public.platform_rate_card to service_role;

insert into public.platform_rate_card (unit_key, label, cost_usd, credits_charged, vendor, notes) values
  ('ai_call_minute','AI call — per minute',0.30,10,'openai+twilio','OpenAI Realtime audio in+out plus Twilio voice leg'),
  ('dialer_minute','Human dial — per minute',0.014,1,'twilio','Outbound PSTN'),
  ('sms_outbound','SMS — per message',0.0079,1,'twilio','US A2P long code'),
  ('email_send','Email — per send',0.0004,1,'lovable_email','Transactional/campaign send'),
  ('discovery_run','Discovery — per search',0.02,25,'firecrawl','Roughly 10 Firecrawl searches per run'),
  ('email_verify','Email verification',0.0004,1,'millionverifier','Mailbox-level check')
on conflict (unit_key) do nothing;

create or replace function public.rate_card_margin()
returns table (unit_key text, label text, cost_usd numeric, credits_charged numeric, vendor text)
language sql stable set search_path to 'public' as $$
  select unit_key, label, cost_usd, credits_charged, vendor from public.platform_rate_card order by unit_key;
$$;