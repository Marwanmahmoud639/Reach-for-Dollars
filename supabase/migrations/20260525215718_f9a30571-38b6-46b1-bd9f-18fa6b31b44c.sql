-- Phase 2: Discovery Engine schema (additive only)

create type public.search_status as enum ('pending','running','complete','failed','partial');
create type public.search_step_name as enum ('business','decisionmakers','social','skiptrace','verify','score','finalize');
create type public.step_status as enum ('pending','running','complete','failed','skipped');
create type public.email_verify_status as enum ('verified','unverified','invalid','pending');
create type public.email_source_type as enum ('direct','pattern_generated');
create type public.phone_type as enum ('mobile','direct','office','unknown');
create type public.job_status as enum ('pending','running','complete','failed','retry');

create table public.searches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  user_id uuid not null,
  keyword text not null,
  location text,
  industry_filter text,
  title_filters text[] not null default '{Owner,CEO,Founder,Co-Founder,President,C-Suite}',
  status search_status not null default 'pending',
  businesses_found int not null default 0,
  decision_makers_found int not null default 0,
  verified_emails int not null default 0,
  verified_phones int not null default 0,
  pattern_verified_emails int not null default 0,
  auto_added_to_pipeline int not null default 0,
  avg_lead_score numeric(5,2) not null default 0,
  sources_success jsonb not null default '{}'::jsonb,
  sources_failed jsonb not null default '{}'::jsonb,
  error_text text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_seconds int
);
alter table public.searches enable row level security;
create policy "team views searches" on public.searches for select using (team_id = get_user_team(auth.uid()));
create policy "team manages searches" on public.searches for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

create table public.search_steps (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  team_id uuid not null,
  step search_step_name not null,
  status step_status not null default 'pending',
  sub_status text,
  detail jsonb not null default '{}'::jsonb,
  sources_success text[] not null default '{}',
  sources_failed text[] not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  unique (search_id, step)
);
alter table public.search_steps enable row level security;
create policy "team views search_steps" on public.search_steps for select using (team_id = get_user_team(auth.uid()));
create policy "team manages search_steps" on public.search_steps for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

create table public.search_results (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  team_id uuid not null,
  contact_id uuid not null,
  is_new boolean not null default true,
  auto_added_to_pipeline boolean not null default false,
  raw_sources_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.search_results enable row level security;
create policy "team views search_results" on public.search_results for select using (team_id = get_user_team(auth.uid()));
create policy "team manages search_results" on public.search_results for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

create table public.contact_phones (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  contact_id uuid not null,
  phone_number text not null,
  phone_type phone_type not null default 'unknown',
  confidence_score int not null default 0,
  sources text[] not null default '{}',
  is_primary boolean not null default false,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.contact_phones enable row level security;
create index on public.contact_phones (contact_id);
create policy "team views contact_phones" on public.contact_phones for select using (team_id = get_user_team(auth.uid()));
create policy "team manages contact_phones" on public.contact_phones for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

create table public.contact_emails (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  contact_id uuid not null,
  email text not null,
  source_type email_source_type not null default 'direct',
  verified_status email_verify_status not null default 'pending',
  smtp_pinged boolean not null default false,
  smtp_result text,
  mx_valid boolean not null default false,
  sources_confirmed int not null default 0,
  sources text[] not null default '{}',
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.contact_emails enable row level security;
create index on public.contact_emails (contact_id);
create policy "team views contact_emails" on public.contact_emails for select using (team_id = get_user_team(auth.uid()));
create policy "team manages contact_emails" on public.contact_emails for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

create table public.business_intel (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  contact_id uuid not null,
  description text,
  employee_count int,
  founded_year int,
  years_in_business int,
  services text[] not null default '{}',
  google_rating numeric(2,1),
  google_review_count int,
  industry_tags text[] not null default '{}',
  scrape_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.business_intel enable row level security;
create index on public.business_intel (contact_id);
create policy "team views business_intel" on public.business_intel for select using (team_id = get_user_team(auth.uid()));
create policy "team manages business_intel" on public.business_intel for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

create table public.job_queue (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status job_status not null default 'pending',
  priority int not null default 100,
  attempts int not null default 0,
  max_attempts int not null default 3,
  scheduled_for timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.job_queue (status, scheduled_for);
alter table public.job_queue enable row level security;
create policy "team views jobs" on public.job_queue for select using (team_id = get_user_team(auth.uid()));

alter table public.team_settings
  add column if not exists auto_pipeline_threshold int not null default 70,
  add column if not exists ai_provider text not null default 'lovable',
  add column if not exists proxy_provider text,
  add column if not exists proxy_api_key text,
  add column if not exists proxy_url text,
  add column if not exists respect_robots boolean not null default true,
  add column if not exists linkedin_dm_count_today int not null default 0,
  add column if not exists linkedin_dm_reset_at timestamptz,
  add column if not exists meta_ig_account jsonb,
  add column if not exists meta_fb_page jsonb,
  add column if not exists batch_skip_trace_key text,
  add column if not exists trestle_api_key text;

alter table public.contacts
  add column if not exists discovery_keyword text,
  add column if not exists auto_added_by_discovery boolean not null default false;

do $$ begin
  perform 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='searches';
  if not found then execute 'alter publication supabase_realtime add table public.searches'; end if;
  perform 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='search_steps';
  if not found then execute 'alter publication supabase_realtime add table public.search_steps'; end if;
  perform 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='search_results';
  if not found then execute 'alter publication supabase_realtime add table public.search_results'; end if;
end $$;

create or replace function public.claim_jobs(_limit int default 5)
returns setof public.job_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.job_queue jq
  set status = 'running', locked_at = now(), attempts = attempts + 1
  where jq.id in (
    select id from public.job_queue
    where status in ('pending','retry') and scheduled_for <= now()
    order by priority asc, scheduled_for asc
    limit _limit
    for update skip locked
  )
  returning *;
end;
$$;