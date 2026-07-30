
-- =========== messages ===========
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  contact_id uuid,
  campaign_id uuid,
  direction text not null check (direction in ('inbound','outbound')),
  channel text not null check (channel in ('email','sms','linkedin','instagram','facebook','whatsapp')),
  subject text,
  body text not null default '',
  from_address text,
  to_address text,
  status text not null default 'sent',
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  is_opt_out_detected boolean not null default false,
  ai_suggested boolean not null default false,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index messages_team_contact_channel_idx on public.messages (team_id, contact_id, channel, created_at desc);
create index messages_team_created_idx on public.messages (team_id, created_at desc);
alter table public.messages enable row level security;

create policy "team views messages" on public.messages
  for select using (team_id = get_user_team(auth.uid()));
create policy "team inserts messages" on public.messages
  for insert with check (team_id = get_user_team(auth.uid()));
create policy "team updates messages" on public.messages
  for update using (team_id = get_user_team(auth.uid()));
create policy "super admin full access messages" on public.messages
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

-- =========== tasks ===========
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  contact_id uuid,
  user_id uuid,                  -- assigned to
  created_by_user_id uuid,
  title text not null,
  notes text,
  due_at timestamptz,
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  status text not null default 'pending' check (status in ('pending','complete','overdue')),
  source text not null default 'manual',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index tasks_team_due_idx on public.tasks (team_id, status, due_at);
create index tasks_user_idx on public.tasks (user_id, status);
alter table public.tasks enable row level security;

create policy "team views tasks" on public.tasks
  for select using (team_id = get_user_team(auth.uid()));
create policy "team manages tasks" on public.tasks
  for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));
create policy "super admin full access tasks" on public.tasks
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

-- =========== companies ===========
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  name text not null,
  normalized_name text not null,
  domain text,
  industry text,
  employee_count int,
  founded_year int,
  description text,
  website text,
  google_rating numeric,
  google_review_count int,
  city text,
  state text,
  country text,
  primary_contact_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, normalized_name)
);
create index companies_team_idx on public.companies (team_id, normalized_name);
alter table public.companies enable row level security;

create policy "team views companies" on public.companies
  for select using (team_id = get_user_team(auth.uid()));
create policy "non-agents manage companies" on public.companies
  for all using (
    team_id = get_user_team(auth.uid())
    and (has_team_role(auth.uid(), team_id, 'admin'::app_role) or has_team_role(auth.uid(), team_id, 'manager'::app_role))
  ) with check (
    team_id = get_user_team(auth.uid())
    and (has_team_role(auth.uid(), team_id, 'admin'::app_role) or has_team_role(auth.uid(), team_id, 'manager'::app_role))
  );
create policy "super admin full access companies" on public.companies
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

-- =========== enrichment_jobs ===========
create table public.enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  status text not null default 'pending' check (status in ('pending','running','complete','failed')),
  source text not null default 'csv_upload',
  total_contacts int not null default 0,
  enriched_count int not null default 0,
  new_emails_found int not null default 0,
  new_phones_found int not null default 0,
  linkedin_added int not null default 0,
  avg_score_before numeric,
  avg_score_after numeric,
  file_name text,
  rows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index enrichment_jobs_team_idx on public.enrichment_jobs (team_id, created_at desc);
alter table public.enrichment_jobs enable row level security;

create policy "team views enrichment" on public.enrichment_jobs
  for select using (team_id = get_user_team(auth.uid()));
create policy "team manages enrichment" on public.enrichment_jobs
  for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));
create policy "super admin full access enrichment" on public.enrichment_jobs
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

-- =========== contacts extensions ===========
alter table public.contacts
  add column if not exists company_id uuid,
  add column if not exists whatsapp_number text,
  add column if not exists last_message_at timestamptz,
  add column if not exists last_message_channel text,
  add column if not exists unread_count int not null default 0;
create index if not exists contacts_team_last_message_idx on public.contacts (team_id, last_message_at desc nulls last);

-- =========== team_settings extensions ===========
alter table public.team_settings
  add column if not exists hunter_api_key text,
  add column if not exists rocketreach_api_key text,
  add column if not exists clearbit_api_key text,
  add column if not exists neverbounce_api_key text,
  add column if not exists zerobounce_api_key text,
  add column if not exists email_verification_provider text default 'mx_only' check (email_verification_provider in ('mx_only','neverbounce','zerobounce')),
  add column if not exists whatsapp_connected boolean not null default false,
  add column if not exists inbox_sms_webhook_secret text default encode(gen_random_bytes(24), 'hex'),
  add column if not exists inbound_email_poll_interval_minutes int not null default 15,
  add column if not exists ai_features_enabled jsonb not null default '{"copy":true,"personalization":true,"assistant":true,"suggest_reply":true}'::jsonb,
  add column if not exists ai_model text not null default 'google/gemini-2.5-flash',
  add column if not exists ai_generations_this_month int not null default 0,
  add column if not exists ai_generations_reset_at timestamptz default date_trunc('month', now()) + interval '1 month',
  add column if not exists idi_endpoint_url text,
  add column if not exists idi_request_template jsonb,
  add column if not exists auto_create_companies boolean not null default true;

-- =========== updated_at trigger for companies ===========
create trigger companies_updated_at before update on public.companies
  for each row execute function public.update_updated_at_column();

-- =========== realtime ===========
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.enrichment_jobs;
