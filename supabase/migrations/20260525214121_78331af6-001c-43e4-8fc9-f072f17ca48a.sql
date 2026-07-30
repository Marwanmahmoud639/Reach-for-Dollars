
-- ============ ENUMS ============
create type public.app_role as enum ('admin', 'manager', 'agent');
create type public.plan_tier as enum ('starter', 'growth', 'agency');
create type public.campaign_type as enum ('email', 'sms', 'linkedin', 'instagram', 'facebook');
create type public.campaign_status as enum ('draft', 'scheduled', 'running', 'paused', 'complete');
create type public.contact_status as enum ('pending', 'sent', 'delivered', 'opened', 'replied', 'bounced', 'failed');

-- ============ TEAMS ============
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null,
  plan plan_tier not null default 'starter',
  contact_limit int not null default 5000,
  seat_limit int not null default 1,
  white_label_logo text,
  white_label_name text,
  white_label_color text,
  custom_domain text,
  created_at timestamptz not null default now()
);

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  team_id uuid references public.teams(id) on delete set null,
  avatar_url text,
  onboarding_skipped boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============ USER ROLES ============
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, team_id, role)
);

-- ============ SECURITY DEFINER HELPERS ============
create or replace function public.get_user_team(_user_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = _user_id limit 1;
$$;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

create or replace function public.has_team_role(_user_id uuid, _team_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id = _user_id and team_id = _team_id and role = _role);
$$;

create or replace function public.is_team_member(_user_id uuid, _team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = _user_id and team_id = _team_id);
$$;

-- ============ CONTACTS ============
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null default '',
  title text,
  company text,
  email text,
  phone text,
  linkedin_url text,
  instagram_url text,
  facebook_url text,
  industry text,
  city text,
  state text,
  country text,
  email_verified boolean not null default false,
  phone_verified boolean not null default false,
  verification_sources text[] not null default '{}',
  lead_score int not null default 0,
  source text not null default 'manual',
  tags text[] not null default '{}',
  opted_out boolean not null default false,
  opted_out_channels text[] not null default '{}',
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.contacts(team_id);
create index on public.contacts(email);
create index on public.contacts(lead_score);

-- Lead score trigger
create or replace function public.compute_lead_score()
returns trigger language plpgsql as $$
begin
  new.lead_score := 0
    + case when new.email_verified then 25 else 0 end
    + case when new.phone_verified then 25 else 0 end
    + case when new.linkedin_url is not null and new.linkedin_url <> '' then 15 else 0 end
    + case when new.instagram_url is not null and new.instagram_url <> '' then 10 else 0 end
    + case when new.facebook_url is not null and new.facebook_url <> '' then 10 else 0 end
    + case when new.industry is not null and new.industry <> '' then 10 else 0 end
    + case when array_length(new.verification_sources, 1) >= 2 then 5 else 0 end;
  new.updated_at := now();
  return new;
end; $$;

create trigger contacts_score before insert or update on public.contacts
  for each row execute function public.compute_lead_score();

-- ============ PIPELINE STAGES ============
create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  position int not null default 0,
  color text not null default '#2563EB',
  created_at timestamptz not null default now()
);
create index on public.pipeline_stages(team_id, position);

-- ============ PIPELINE LEADS ============
create table public.pipeline_leads (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  stage_id uuid references public.pipeline_stages(id) on delete set null,
  assigned_campaign_id uuid,
  notes text,
  gone_cold boolean not null default false,
  re_engagement_triggered boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.pipeline_leads(team_id);

-- ============ CAMPAIGNS ============
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  type campaign_type not null,
  status campaign_status not null default 'draft',
  subject text,
  body text not null default '',
  ai_personalization boolean not null default false,
  sending_window_enabled boolean not null default false,
  sending_days text[] not null default '{Mon,Tue,Wed,Thu,Fri}',
  sending_start_time time,
  sending_end_time time,
  timezone text not null default 'UTC',
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ============ CAMPAIGN CONTACTS ============
create table public.campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  status contact_status not null default 'pending',
  personalized_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  replied_at timestamptz,
  bounced_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.campaign_contacts(campaign_id);
create index on public.campaign_contacts(contact_id);

-- ============ FOLLOW-UP SEQUENCES ============
create table public.follow_up_sequences (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  step_number int not null,
  delay_days int not null default 1,
  channel campaign_type not null,
  message text not null default '',
  created_at timestamptz not null default now()
);

-- ============ ACTIVITY LOG ============
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  user_id uuid,
  action text not null,
  channel text,
  note text,
  created_at timestamptz not null default now()
);
create index on public.activity_log(team_id, created_at desc);

-- ============ TEAM SETTINGS ============
create table public.team_settings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null unique references public.teams(id) on delete cascade,
  gmail_connected boolean not null default false,
  gmail_email text,
  smtp_provider text,
  smtp_host text,
  smtp_port int,
  smtp_user text,
  smtp_password text,
  smtp_from_name text,
  smtp_from_email text,
  sms_provider text,
  twilio_sid text,
  twilio_token text,
  twilio_from text,
  signalwire_project text,
  signalwire_token text,
  signalwire_space text,
  signalwire_from text,
  telnyx_key text,
  telnyx_from text,
  apollo_key text,
  seamless_key text,
  leads_gorilla_key text,
  google_maps_key text,
  skip_trace_key text,
  linkedin_session text,
  meta_token text,
  slack_webhook text,
  cold_lead_days int not null default 14,
  daily_email_limit int not null default 100,
  sms_template_a text,
  sms_template_b text,
  sms_template_c text,
  notification_prefs jsonb not null default '{"reply":true,"campaign_complete":true,"errors":true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============ CUSTOM FIELD DEFS ============
create table public.custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null default 'text',
  options text[],
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  unique(team_id, field_key)
);

-- ============ NOTIFICATIONS ============
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid,
  title text not null,
  body text,
  type text not null default 'info',
  read boolean not null default false,
  link text,
  created_at timestamptz not null default now()
);
create index on public.notifications(team_id, created_at desc);

-- ============ SUB ACCOUNTS ============
create table public.sub_accounts (
  id uuid primary key default gen_random_uuid(),
  parent_team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  email text not null,
  plan plan_tier not null default 'starter',
  contact_limit int not null default 5000,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- ============ ENABLE RLS ============
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.contacts enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.pipeline_leads enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_contacts enable row level security;
alter table public.follow_up_sequences enable row level security;
alter table public.activity_log enable row level security;
alter table public.team_settings enable row level security;
alter table public.custom_field_defs enable row level security;
alter table public.notifications enable row level security;
alter table public.sub_accounts enable row level security;

-- ============ POLICIES ============
-- Profiles
create policy "users view own profile" on public.profiles for select using (auth.uid() = id);
create policy "users view team profiles" on public.profiles for select using (team_id = public.get_user_team(auth.uid()));
create policy "users update own profile" on public.profiles for update using (auth.uid() = id);
create policy "users insert own profile" on public.profiles for insert with check (auth.uid() = id);

-- Teams
create policy "members view team" on public.teams for select using (id = public.get_user_team(auth.uid()));
create policy "admins update team" on public.teams for update using (public.has_team_role(auth.uid(), id, 'admin'));
create policy "users insert team" on public.teams for insert with check (auth.uid() = owner_id);

-- User Roles
create policy "users view own roles" on public.user_roles for select using (auth.uid() = user_id);
create policy "admins view team roles" on public.user_roles for select using (public.has_team_role(auth.uid(), team_id, 'admin'));
create policy "admins manage team roles" on public.user_roles for all using (public.has_team_role(auth.uid(), team_id, 'admin')) with check (public.has_team_role(auth.uid(), team_id, 'admin'));
create policy "system inserts initial role" on public.user_roles for insert with check (auth.uid() = user_id);

-- Contacts
create policy "team members view contacts" on public.contacts for select using (team_id = public.get_user_team(auth.uid()));
create policy "non-agents manage contacts" on public.contacts for all
  using (team_id = public.get_user_team(auth.uid()) and (public.has_team_role(auth.uid(), team_id, 'admin') or public.has_team_role(auth.uid(), team_id, 'manager')))
  with check (team_id = public.get_user_team(auth.uid()) and (public.has_team_role(auth.uid(), team_id, 'admin') or public.has_team_role(auth.uid(), team_id, 'manager')));

-- Pipeline stages
create policy "team views stages" on public.pipeline_stages for select using (team_id = public.get_user_team(auth.uid()));
create policy "non-agents manage stages" on public.pipeline_stages for all
  using (team_id = public.get_user_team(auth.uid()) and (public.has_team_role(auth.uid(), team_id, 'admin') or public.has_team_role(auth.uid(), team_id, 'manager')))
  with check (team_id = public.get_user_team(auth.uid()) and (public.has_team_role(auth.uid(), team_id, 'admin') or public.has_team_role(auth.uid(), team_id, 'manager')));

-- Pipeline leads (agents can update stage)
create policy "team views leads" on public.pipeline_leads for select using (team_id = public.get_user_team(auth.uid()));
create policy "team manages leads" on public.pipeline_leads for all using (team_id = public.get_user_team(auth.uid())) with check (team_id = public.get_user_team(auth.uid()));

-- Campaigns
create policy "team views campaigns" on public.campaigns for select using (team_id = public.get_user_team(auth.uid()));
create policy "non-agents manage campaigns" on public.campaigns for all
  using (team_id = public.get_user_team(auth.uid()) and (public.has_team_role(auth.uid(), team_id, 'admin') or public.has_team_role(auth.uid(), team_id, 'manager')))
  with check (team_id = public.get_user_team(auth.uid()) and (public.has_team_role(auth.uid(), team_id, 'admin') or public.has_team_role(auth.uid(), team_id, 'manager')));

-- Campaign contacts
create policy "team views cc" on public.campaign_contacts for select using (team_id = public.get_user_team(auth.uid()));
create policy "team manages cc" on public.campaign_contacts for all using (team_id = public.get_user_team(auth.uid())) with check (team_id = public.get_user_team(auth.uid()));

-- Follow-ups
create policy "team views fus" on public.follow_up_sequences for select using (team_id = public.get_user_team(auth.uid()));
create policy "non-agents manage fus" on public.follow_up_sequences for all
  using (team_id = public.get_user_team(auth.uid()) and (public.has_team_role(auth.uid(), team_id, 'admin') or public.has_team_role(auth.uid(), team_id, 'manager')))
  with check (team_id = public.get_user_team(auth.uid()) and (public.has_team_role(auth.uid(), team_id, 'admin') or public.has_team_role(auth.uid(), team_id, 'manager')));

-- Activity log
create policy "team views activity" on public.activity_log for select using (team_id = public.get_user_team(auth.uid()));
create policy "team inserts activity" on public.activity_log for insert with check (team_id = public.get_user_team(auth.uid()));

-- Team settings (admins only for write, all team for read of non-secret view; for simplicity team sees but only admin writes)
create policy "admins view settings" on public.team_settings for select using (public.has_team_role(auth.uid(), team_id, 'admin'));
create policy "admins manage settings" on public.team_settings for all using (public.has_team_role(auth.uid(), team_id, 'admin')) with check (public.has_team_role(auth.uid(), team_id, 'admin'));

-- Custom fields
create policy "team views cf" on public.custom_field_defs for select using (team_id = public.get_user_team(auth.uid()));
create policy "non-agents manage cf" on public.custom_field_defs for all
  using (team_id = public.get_user_team(auth.uid()) and (public.has_team_role(auth.uid(), team_id, 'admin') or public.has_team_role(auth.uid(), team_id, 'manager')))
  with check (team_id = public.get_user_team(auth.uid()) and (public.has_team_role(auth.uid(), team_id, 'admin') or public.has_team_role(auth.uid(), team_id, 'manager')));

-- Notifications
create policy "users view team notifications" on public.notifications for select using (team_id = public.get_user_team(auth.uid()));
create policy "users update own notifications" on public.notifications for update using (team_id = public.get_user_team(auth.uid()));
create policy "team inserts notifications" on public.notifications for insert with check (team_id = public.get_user_team(auth.uid()));

-- Sub accounts (agency admins)
create policy "admins view sub_accounts" on public.sub_accounts for select using (public.has_team_role(auth.uid(), parent_team_id, 'admin'));
create policy "admins manage sub_accounts" on public.sub_accounts for all using (public.has_team_role(auth.uid(), parent_team_id, 'admin')) with check (public.has_team_role(auth.uid(), parent_team_id, 'admin'));

-- ============ SIGNUP TRIGGER ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_team_id uuid;
  user_plan plan_tier;
  user_contact_limit int;
  user_seat_limit int;
begin
  user_plan := coalesce((new.raw_user_meta_data->>'plan')::plan_tier, 'starter'::plan_tier);
  user_contact_limit := case user_plan
    when 'starter' then 5000
    when 'growth' then 25000
    when 'agency' then 1000000
  end;
  user_seat_limit := case user_plan
    when 'starter' then 1
    when 'growth' then 3
    when 'agency' then 10
  end;

  -- create team
  insert into public.teams (name, owner_id, plan, contact_limit, seat_limit)
  values (coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)) || '''s Team',
          new.id, user_plan, user_contact_limit, user_seat_limit)
  returning id into new_team_id;

  -- profile
  insert into public.profiles (id, email, name, team_id)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''), new_team_id);

  -- admin role
  insert into public.user_roles (user_id, team_id, role) values (new.id, new_team_id, 'admin');

  -- team settings
  insert into public.team_settings (team_id) values (new_team_id);

  -- default pipeline stages
  insert into public.pipeline_stages (team_id, name, position, color) values
    (new_team_id, 'New Lead', 0, '#64748B'),
    (new_team_id, 'Contacted (Email)', 1, '#2563EB'),
    (new_team_id, 'Contacted (SMS)', 2, '#10B981'),
    (new_team_id, 'Contacted (Social)', 3, '#8B5CF6'),
    (new_team_id, 'Responded', 4, '#F59E0B'),
    (new_team_id, 'Qualified', 5, '#EF4444'),
    (new_team_id, 'Closed', 6, '#22C55E'),
    (new_team_id, 'Not Interested', 7, '#475569');

  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Realtime
alter publication supabase_realtime add table public.activity_log;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.pipeline_leads;
