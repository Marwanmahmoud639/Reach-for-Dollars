
-- =========================================
-- CLIENT PORTALS
-- =========================================
create table public.client_portals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  name text not null,
  token uuid not null unique default gen_random_uuid(),
  filter_type text not null check (filter_type in ('tag','stage')),
  filter_value text not null,
  date_range text not null default '30d' check (date_range in ('7d','30d','all')),
  expires_at timestamptz,
  view_count int not null default 0,
  last_viewed_at timestamptz,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index idx_client_portals_team on public.client_portals(team_id);
create index idx_client_portals_token on public.client_portals(token);

alter table public.client_portals enable row level security;

create policy "super admin full access" on public.client_portals
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));
create policy "team views portals" on public.client_portals
  for select using (team_id = get_user_team(auth.uid()));
create policy "non-agents manage portals" on public.client_portals
  for all using ((team_id = get_user_team(auth.uid())) and (has_team_role(auth.uid(), team_id, 'admin'::app_role) or has_team_role(auth.uid(), team_id, 'manager'::app_role)))
  with check ((team_id = get_user_team(auth.uid())) and (has_team_role(auth.uid(), team_id, 'admin'::app_role) or has_team_role(auth.uid(), team_id, 'manager'::app_role)));

-- =========================================
-- WORKFLOWS
-- =========================================
create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  name text not null,
  status text not null default 'draft' check (status in ('active','paused','draft')),
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  stop_conditions jsonb not null default '[]'::jsonb,
  template_id text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_workflows_team on public.workflows(team_id);
create index idx_workflows_status on public.workflows(status);

alter table public.workflows enable row level security;
create policy "super admin full access" on public.workflows
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));
create policy "team views workflows" on public.workflows
  for select using (team_id = get_user_team(auth.uid()));
create policy "non-agents manage workflows" on public.workflows
  for all using ((team_id = get_user_team(auth.uid())) and (has_team_role(auth.uid(), team_id, 'admin'::app_role) or has_team_role(auth.uid(), team_id, 'manager'::app_role)))
  with check ((team_id = get_user_team(auth.uid())) and (has_team_role(auth.uid(), team_id, 'admin'::app_role) or has_team_role(auth.uid(), team_id, 'manager'::app_role)));

create trigger update_workflows_updated_at before update on public.workflows
  for each row execute function public.update_updated_at_column();

-- =========================================
-- WORKFLOW INSTANCES
-- =========================================
create table public.workflow_instances (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  contact_id uuid not null,
  team_id uuid not null,
  status text not null default 'running' check (status in ('running','completed','stopped','errored')),
  current_step int not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  stop_reason text
);
create index idx_wfi_workflow on public.workflow_instances(workflow_id);
create index idx_wfi_team on public.workflow_instances(team_id);
create index idx_wfi_status on public.workflow_instances(status);

alter table public.workflow_instances enable row level security;
create policy "super admin full access" on public.workflow_instances
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));
create policy "team views wfi" on public.workflow_instances
  for select using (team_id = get_user_team(auth.uid()));
create policy "team manages wfi" on public.workflow_instances
  for all using (team_id = get_user_team(auth.uid()))
  with check (team_id = get_user_team(auth.uid()));

-- =========================================
-- SEARCH MONITORS
-- =========================================
create table public.search_monitors (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  name text not null,
  keyword text not null,
  location text,
  industry_filter text,
  title_filters text[] not null default '{Owner,CEO,Founder,Co-Founder,President,C-Suite}'::text[],
  frequency text not null default 'weekly' check (frequency in ('weekly','monthly','manual')),
  frequency_day int,
  auto_add_threshold int not null default 70,
  notification_prefs jsonb not null default '{"in_app":true,"email":false,"slack":false,"skip_if_zero":true}'::jsonb,
  status text not null default 'active' check (status in ('active','paused','error')),
  last_run_at timestamptz,
  next_run_at timestamptz,
  total_runs int not null default 0,
  total_new_leads int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_monitors_team on public.search_monitors(team_id);
create index idx_monitors_next_run on public.search_monitors(next_run_at) where status = 'active';

alter table public.search_monitors enable row level security;
create policy "super admin full access" on public.search_monitors
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));
create policy "team views monitors" on public.search_monitors
  for select using (team_id = get_user_team(auth.uid()));
create policy "non-agents manage monitors" on public.search_monitors
  for all using ((team_id = get_user_team(auth.uid())) and (has_team_role(auth.uid(), team_id, 'admin'::app_role) or has_team_role(auth.uid(), team_id, 'manager'::app_role)))
  with check ((team_id = get_user_team(auth.uid())) and (has_team_role(auth.uid(), team_id, 'admin'::app_role) or has_team_role(auth.uid(), team_id, 'manager'::app_role)));

create trigger update_monitors_updated_at before update on public.search_monitors
  for each row execute function public.update_updated_at_column();

-- =========================================
-- PROPOSALS
-- =========================================
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  prospect_name text not null,
  business_name text not null,
  industry text,
  location text,
  current_lead_method text,
  monthly_lead_goal int,
  notes text,
  package_selected text,
  package_price int,
  guarantee_text text,
  testimonial text,
  cta_url text,
  expires_at timestamptz,
  token uuid not null unique default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft','sent','viewed','won','lost')),
  sample_leads jsonb not null default '[]'::jsonb,
  view_count int not null default 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index idx_proposals_team on public.proposals(team_id);
create index idx_proposals_token on public.proposals(token);

alter table public.proposals enable row level security;
create policy "super admin full access" on public.proposals
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));
create policy "team views proposals" on public.proposals
  for select using (team_id = get_user_team(auth.uid()));
create policy "non-agents manage proposals" on public.proposals
  for all using ((team_id = get_user_team(auth.uid())) and (has_team_role(auth.uid(), team_id, 'admin'::app_role) or has_team_role(auth.uid(), team_id, 'manager'::app_role)))
  with check ((team_id = get_user_team(auth.uid())) and (has_team_role(auth.uid(), team_id, 'admin'::app_role) or has_team_role(auth.uid(), team_id, 'manager'::app_role)));
