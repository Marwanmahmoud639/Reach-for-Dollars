-- ENUMS
create type public.app_role as enum ('admin', 'manager', 'agent');
create type public.plan_tier as enum ('starter', 'growth', 'agency');
create type public.campaign_type as enum ('email', 'sms', 'linkedin', 'instagram', 'facebook');
create type public.campaign_status as enum ('draft', 'scheduled', 'running', 'paused', 'complete');
create type public.contact_status as enum ('pending', 'sent', 'delivered', 'opened', 'replied', 'bounced', 'failed');

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

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  team_id uuid references public.teams(id) on delete set null,
  avatar_url text,
  onboarding_skipped boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, team_id, role)
);

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

create or replace function public.compute_lead_score()
returns trigger language plpgsql set search_path = public as $$
declare
  re_record record;
  has_mobile boolean := false;
  has_landline_only boolean := false;
begin
  select * into re_record from public.business_intel where contact_id = new.id limit 1;
  select exists(select 1 from public.contact_phones where contact_id = new.id and line_type = 'mobile') into has_mobile;
  if not has_mobile then
    select exists(select 1 from public.contact_phones where contact_id = new.id and line_type = 'landline') into has_landline_only;
  end if;
  new.lead_score := 0
    + case when new.email_verified then 25 else 0 end
    + case when new.phone_verified then 25 else 0 end
    + case when new.linkedin_url is not null and new.linkedin_url <> '' then 15 else 0 end
    + case when new.instagram_url is not null and new.instagram_url <> '' then 10 else 0 end
    + case when new.facebook_url is not null and new.facebook_url <> '' then 10 else 0 end
    + case when new.industry is not null and new.industry <> '' then 10 else 0 end
    + case when array_length(new.verification_sources, 1) >= 2 then 5 else 0 end
    + case when has_mobile then 10 else 0 end
    + case when has_landline_only then -5 else 0 end
    + case when re_record.is_real_estate_investor then
        coalesce(case when re_record.active_buyer_signal then 15 else 0 end, 0)
        + coalesce(case when re_record.portfolio_size = 'large' then 10 when re_record.portfolio_size = 'medium' then 5 else 0 end, 0)
        + coalesce(case when re_record.llc_registered_agent is not null then 5 else 0 end, 0)
        + coalesce(case when re_record.last_transaction_date is not null then 3 else 0 end, 0)
      else 0 end;
  new.updated_at := now();
  return new;
end; $$;

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  position int not null default 0,
  color text not null default '#2563EB',
  created_at timestamptz not null default now()
);
create index on public.pipeline_stages(team_id, position);

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
  sending_inbox_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  sending_strategy text NOT NULL DEFAULT 'round_robin' CHECK (sending_strategy IN ('round_robin','load_balanced','random')),
  paused_at timestamptz,
  pause_reason text,
  cost_per_lead_threshold numeric NOT NULL DEFAULT 20,
  total_cost numeric NOT NULL DEFAULT 0,
  campaign_round int NOT NULL DEFAULT 1,
  parent_campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  auto_scaled_at timestamptz,
  created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_parent ON public.campaigns(parent_campaign_id);

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

create table public.follow_up_sequences (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  step_number int not null,
  delay_days int not null default 1,
  channel campaign_type not null,
  message text not null default '',
  open_aware boolean NOT NULL DEFAULT false,
  message_if_opened text,
  message_if_not_opened text,
  created_at timestamptz not null default now()
);

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
  auto_pipeline_threshold int not null default 70,
  ai_provider text not null default 'lovable',
  proxy_provider text,
  proxy_api_key text,
  proxy_url text,
  respect_robots boolean not null default true,
  linkedin_dm_count_today int not null default 0,
  linkedin_dm_reset_at timestamptz,
  meta_ig_account jsonb,
  meta_fb_page jsonb,
  batch_skip_trace_key text,
  trestle_api_key text,
  attom_api_key text,
  propstream_api_key text,
  batchleads_api_key text,
  skip_trace_provider_2 text,
  skip_trace_key_2 text,
  skip_trace_provider_3 text,
  skip_trace_key_3 text,
  skip_trace_provider_4 text,
  skip_trace_key_4 text,
  skip_trace_provider_5 text,
  skip_trace_key_5 text,
  skip_trace_waterfall_order text[] NOT NULL DEFAULT ARRAY['batch','trestle','idi','spokeo','whitepages']::text[],
  carrier_lookup_provider text,
  carrier_lookup_key text,
  auto_carrier_lookup boolean NOT NULL DEFAULT true,
  dnc_api_provider text,
  dnc_api_key text,
  dnc_last_scrub timestamptz,
  sms_opt_out_footer text NOT NULL DEFAULT ' Reply STOP to unsubscribe',
  enforce_tcpa_hours boolean NOT NULL DEFAULT true,
  sending_strategy text NOT NULL DEFAULT 'round_robin' CHECK (sending_strategy IN ('round_robin','load_balanced','random')),
  mxtoolbox_api_key text,
  account_timezone text NOT NULL DEFAULT 'America/Chicago',
  hunter_api_key text,
  rocketreach_api_key text,
  clearbit_api_key text,
  neverbounce_api_key text,
  zerobounce_api_key text,
  email_verification_provider text DEFAULT 'mx_only' CHECK (email_verification_provider IN ('mx_only','neverbounce','zerobounce')),
  whatsapp_connected boolean NOT NULL DEFAULT false,
  inbox_sms_webhook_secret text DEFAULT encode(gen_random_bytes(24), 'hex'),
  inbound_email_poll_interval_minutes int NOT NULL DEFAULT 15,
  ai_features_enabled jsonb NOT NULL DEFAULT '{"copy":true,"personalization":true,"assistant":true,"suggest_reply":true}'::jsonb,
  ai_model text NOT NULL DEFAULT 'google/gemini-2.5-flash',
  ai_generations_this_month int NOT NULL DEFAULT 0,
  ai_generations_reset_at timestamptz DEFAULT date_trunc('month', now()) + interval '1 month',
  idi_endpoint_url text,
  idi_request_template jsonb,
  auto_create_companies boolean NOT NULL DEFAULT true,
  whatsapp_business_id text,
  whatsapp_phone_id text,
  whatsapp_access_token text,
  whatsapp_default_to text,
  discord_webhook_url text,
  discord_server_id text,
  discord_channel_id text,
  telegram_bot_token text,
  telegram_chat_id text,
  facebook_api_key text,
  serper_api_key text,
  reddit_client_id text,
  default_subreddits text[] NOT NULL DEFAULT '{Wholesaling,RealEstate,investing,realestateinvesting,cashbuyers}',
  n8n_webhook_url text,
  make_webhook_url text,
  clay_key text,
  ai_ark_key text,
  ai_ark_endpoint text,
  apify_key text,
  apify_actor_id text,
  claude_api_key text,
  icp_definition text,
  lusha_api_key text,
  firecrawl_api_key text,
  blocked_keywords text[] NOT NULL DEFAULT ARRAY['foreclosure','wholesale','free','urgent','guaranteed','click here','lottery','casino']::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- GRANTS
grant select, insert, update, delete on public.teams, public.profiles, public.user_roles, public.contacts, public.pipeline_stages, public.pipeline_leads, public.campaigns, public.campaign_contacts, public.follow_up_sequences, public.activity_log, public.team_settings, public.custom_field_defs, public.notifications to authenticated;
grant all on public.teams, public.profiles, public.user_roles, public.contacts, public.pipeline_stages, public.pipeline_leads, public.campaigns, public.campaign_contacts, public.follow_up_sequences, public.activity_log, public.team_settings, public.custom_field_defs, public.notifications to service_role;

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

create policy "users view own profile" on public.profiles for select using (auth.uid() = id);
create policy "users view team profiles" on public.profiles for select using (team_id = public.get_user_team(auth.uid()));
create policy "users update own profile" on public.profiles for update using (auth.uid() = id);
create policy "users insert own profile" on public.profiles for insert with check (auth.uid() = id);

create policy "members view team" on public.teams for select using (id = public.get_user_team(auth.uid()));
create policy "admins update team" on public.teams for update using (public.has_team_role(auth.uid(), id, 'admin'));
create policy "users insert team" on public.teams for insert with check (auth.uid() = owner_id);

create policy "users view own roles" on public.user_roles for select using (auth.uid() = user_id);
create policy "admins view team roles" on public.user_roles for select using (public.has_team_role(auth.uid(), team_id, 'admin'));
create policy "admins manage team roles" on public.user_roles for all using (public.has_team_role(auth.uid(), team_id, 'admin')) with check (public.has_team_role(auth.uid(), team_id, 'admin'));
create policy "users self-assign agent role on own team" on public.user_roles for insert to authenticated with check (auth.uid() = user_id and role = 'agent'::app_role and team_id = get_user_team(auth.uid()));

create policy "team members view contacts" on public.contacts for select using (team_id = public.get_user_team(auth.uid()));
create policy "team manages contacts" on public.contacts for all
  using (team_id = public.get_user_team(auth.uid()))
  with check (team_id = public.get_user_team(auth.uid()));

create policy "team views stages" on public.pipeline_stages for select using (team_id = public.get_user_team(auth.uid()));
create policy "team manages stages" on public.pipeline_stages for all
  using (team_id = public.get_user_team(auth.uid()))
  with check (team_id = public.get_user_team(auth.uid()));

create policy "team views leads" on public.pipeline_leads for select using (team_id = public.get_user_team(auth.uid()));
create policy "team manages leads" on public.pipeline_leads for all using (team_id = public.get_user_team(auth.uid())) with check (team_id = public.get_user_team(auth.uid()));

create policy "team manages campaigns" on public.campaigns for all
  using (team_id = public.get_user_team(auth.uid()))
  with check (team_id = public.get_user_team(auth.uid()));

create policy "team manages cc" on public.campaign_contacts for all using (team_id = public.get_user_team(auth.uid())) with check (team_id = public.get_user_team(auth.uid()));

create policy "team manages fus" on public.follow_up_sequences for all
  using (team_id = public.get_user_team(auth.uid()))
  with check (team_id = public.get_user_team(auth.uid()));

create policy "team views activity" on public.activity_log for select using (team_id = public.get_user_team(auth.uid()));
create policy "team inserts activity" on public.activity_log for insert with check (team_id = public.get_user_team(auth.uid()));

create policy "admins view settings" on public.team_settings for select using (public.has_team_role(auth.uid(), team_id, 'admin'));
create policy "admins manage settings" on public.team_settings for all using (public.has_team_role(auth.uid(), team_id, 'admin')) with check (public.has_team_role(auth.uid(), team_id, 'admin'));

create policy "team views cf" on public.custom_field_defs for select using (team_id = public.get_user_team(auth.uid()));
create policy "team manages cf" on public.custom_field_defs for all
  using (team_id = public.get_user_team(auth.uid()))
  with check (team_id = public.get_user_team(auth.uid()));

create policy "users view team notifications" on public.notifications for select using (team_id = public.get_user_team(auth.uid()));
create policy "users update own notifications" on public.notifications for update using (team_id = public.get_user_team(auth.uid()));
create policy "team inserts notifications" on public.notifications for insert with check (team_id = public.get_user_team(auth.uid()));

-- DISCOVERY ENGINE
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
  locations_geocoded jsonb default '[]'::jsonb,
  map_center_lat float,
  map_center_lng float,
  served_from_cache boolean NOT NULL DEFAULT false,
  duplicates jsonb NOT NULL DEFAULT '[]'::jsonb,
  duplicates_count integer NOT NULL DEFAULT 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_seconds int
);
grant select, insert, update, delete on public.searches to authenticated;
grant all on public.searches to service_role;
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
grant select, insert, update, delete on public.search_steps to authenticated;
grant all on public.search_steps to service_role;
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
grant select, insert, update, delete on public.search_results to authenticated;
grant all on public.search_results to service_role;
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
  line_type text CHECK (line_type IN ('mobile','landline','voip','toll_free','unknown')),
  carrier_name text,
  carrier_lookup_date timestamptz,
  is_sms_eligible boolean NOT NULL DEFAULT false,
  is_dnc boolean NOT NULL DEFAULT false,
  created_at timestamptz not null default now()
);
create index on public.contact_phones (contact_id);
grant select, insert, update, delete on public.contact_phones to authenticated;
grant all on public.contact_phones to service_role;
alter table public.contact_phones enable row level security;
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
  is_unsubscribed boolean NOT NULL DEFAULT false,
  unsubscribed_at timestamptz,
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_at timestamptz not null default now()
);
create index on public.contact_emails (contact_id);
grant select, insert, update, delete on public.contact_emails to authenticated;
grant all on public.contact_emails to service_role;
alter table public.contact_emails enable row level security;
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
  is_real_estate_investor boolean NOT NULL DEFAULT false,
  properties_owned integer,
  recent_transactions_12mo integer,
  llc_registered_agent text,
  llc_mailing_address text,
  portfolio_size text CHECK (portfolio_size IN ('small','medium','large','unknown')),
  active_buyer_signal boolean NOT NULL DEFAULT false,
  last_transaction_date date,
  attom_last_checked timestamptz,
  sos_last_checked timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.business_intel to authenticated;
grant all on public.business_intel to service_role;
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
grant select, insert, update, delete on public.job_queue to authenticated;
grant all on public.job_queue to service_role;
alter table public.job_queue enable row level security;
create policy "team views jobs" on public.job_queue for select using (team_id = get_user_team(auth.uid()));

CREATE OR REPLACE FUNCTION public.claim_jobs(_job_types text[] DEFAULT NULL, _limit integer DEFAULT 5)
RETURNS SETOF public.job_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  return query
  update public.job_queue jq set status = 'running', locked_at = now(), attempts = attempts + 1
  where jq.id in (select id from public.job_queue where status in ('pending','retry') and scheduled_for <= now() and (_job_types is null or job_type = any(_job_types)) order by priority asc, scheduled_for asc limit _limit for update skip locked)
  returning *;
end; $$;
REVOKE EXECUTE ON FUNCTION public.claim_jobs(text[], integer) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_jobs(text[], integer) TO service_role;

-- Additional contact columns
alter table public.contacts
  add column if not exists discovery_keyword text,
  add column if not exists auto_added_by_discovery boolean not null default false,
  add column if not exists company_id uuid,
  add column if not exists whatsapp_number text,
  add column if not exists last_message_at timestamptz,
  add column if not exists last_message_channel text,
  add column if not exists unread_count int not null default 0,
  add column if not exists detected_timezone text,
  add column if not exists timezone_source text CHECK (timezone_source IN ('area_code','address','city','manual')),
  add column if not exists timezone_confidence text CHECK (timezone_confidence IN ('high','medium','low')),
  add column if not exists is_dnc_federal boolean NOT NULL DEFAULT false,
  add column if not exists is_dnc_internal boolean NOT NULL DEFAULT false,
  add column if not exists dnc_reason text,
  add column if not exists dnc_added_at timestamptz,
  add column if not exists email_verified_by_ai boolean NOT NULL DEFAULT false,
  add column if not exists email_ai_confidence integer,
  add column if not exists email_ai_reason text,
  add column if not exists icp_fit_score integer,
  add column if not exists icp_fit_reason text,
  add column if not exists icp_matches boolean,
  add column if not exists ai_verified_at timestamptz,
  add column if not exists website text,
  add column if not exists assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  add column if not exists deal_value numeric,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists next_followup_at timestamptz,
  add column if not exists contact_frequency text,
  add column if not exists priority text,
  add column if not exists do_not_contact boolean NOT NULL DEFAULT false,
  add column if not exists custom_field_1 text,
  add column if not exists custom_field_2 text,
  add column if not exists custom_field_3 text,
  add column if not exists twitter_url text,
  add column if not exists youtube_url text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists geocoded_at timestamptz,
  add column if not exists address text,
  add column if not exists auto_purge_at timestamptz;
create index if not exists contacts_team_last_message_idx on public.contacts (team_id, last_message_at desc nulls last);
CREATE INDEX IF NOT EXISTS contacts_team_latlng_idx ON public.contacts(team_id) WHERE lat IS NOT NULL AND lng IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_icp_fit_score ON public.contacts(team_id, icp_fit_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_contacts_auto_purge_at ON public.contacts (auto_purge_at) WHERE source = 'discovery';

create trigger contacts_score before insert or update on public.contacts
  for each row execute function public.compute_lead_score();

-- AI personalization jobs
CREATE TABLE IF NOT EXISTS public.ai_personalization_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  variant text NOT NULL DEFAULT 'initial',
  status text NOT NULL DEFAULT 'pending',
  ai_provider text,
  generated_message text,
  edited_message text,
  approved_by uuid,
  approved_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id, variant)
);
CREATE INDEX IF NOT EXISTS ai_pj_campaign_idx ON public.ai_personalization_jobs(campaign_id);
CREATE INDEX IF NOT EXISTS ai_pj_team_idx ON public.ai_personalization_jobs(team_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_personalization_jobs TO authenticated;
GRANT ALL ON public.ai_personalization_jobs TO service_role;
ALTER TABLE public.ai_personalization_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages ai jobs" ON public.ai_personalization_jobs FOR ALL USING (team_id = public.get_user_team(auth.uid())) WITH CHECK (team_id = public.get_user_team(auth.uid()));
CREATE TRIGGER ai_pj_updated_at BEFORE UPDATE ON public.ai_personalization_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Super admin
create table if not exists public.super_admins (
  user_id uuid primary key,
  granted_at timestamptz not null default now(),
  granted_by uuid
);
grant select, insert, update, delete on public.super_admins to authenticated;
grant all on public.super_admins to service_role;
alter table public.super_admins enable row level security;

create or replace function public.is_super_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.super_admins where user_id = _user_id);
$$;

create policy "users view own super admin" on public.super_admins for select using (auth.uid() = user_id or public.is_super_admin(auth.uid()));
create policy "super admins manage list" on public.super_admins for all using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

-- Messages / tasks / companies / enrichment
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
grant select, insert, update, delete on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create policy "team manages messages" on public.messages for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  contact_id uuid,
  user_id uuid,
  created_by_user_id uuid,
  title text not null,
  notes text,
  due_at timestamptz,
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  status text not null default 'pending' check (status in ('pending','complete','overdue')),
  source text not null default 'manual',
  task_type text NOT NULL DEFAULT 'follow_up' CHECK (task_type IN ('call','email','meeting','follow_up','other')),
  reminder_offset_minutes integer,
  reminder_sent_at timestamptz,
  assigned_notified_at timestamptz,
  completion_notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index tasks_team_due_idx on public.tasks (team_id, status, due_at);
create index tasks_user_idx on public.tasks (user_id, status);
CREATE INDEX IF NOT EXISTS tasks_reminder_due_idx ON public.tasks (status, due_at) WHERE reminder_sent_at IS NULL AND reminder_offset_minutes IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_contact_idx ON public.tasks (contact_id, status, due_at);
grant select, insert, update, delete on public.tasks to authenticated;
grant all on public.tasks to service_role;
alter table public.tasks enable row level security;
create policy "team manages tasks" on public.tasks for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

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
grant select, insert, update, delete on public.companies to authenticated;
grant all on public.companies to service_role;
alter table public.companies enable row level security;
create policy "team manages companies" on public.companies for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));
create trigger companies_updated_at before update on public.companies for each row execute function public.update_updated_at_column();

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
grant select, insert, update, delete on public.enrichment_jobs to authenticated;
grant all on public.enrichment_jobs to service_role;
alter table public.enrichment_jobs enable row level security;
create policy "team manages enrichment" on public.enrichment_jobs for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

-- Individual searches
create table public.individual_searches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  keyword text not null,
  location text,
  platforms text[] not null default '{}',
  status text not null default 'pending',
  individuals_found int not null default 0,
  verified_count int not null default 0,
  avg_score float,
  auto_added_to_pipeline int,
  error_text text,
  sources_success jsonb default '{}'::jsonb,
  sources_failed jsonb default '{}'::jsonb,
  map_center_lat float,
  map_center_lng float,
  locations_geocoded jsonb default '[]'::jsonb,
  served_from_cache boolean NOT NULL DEFAULT false,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_seconds int
);
create index on public.individual_searches(team_id);
grant select, insert, update, delete on public.individual_searches to authenticated;
grant all on public.individual_searches to service_role;
alter table public.individual_searches enable row level security;
create policy "team manages individual_searches" on public.individual_searches for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

create table public.individual_search_results (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  search_id uuid not null references public.individual_searches(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  first_name text,
  last_name text,
  full_name text not null,
  role text,
  company_name text,
  city text,
  state text,
  country text,
  email text,
  phone text,
  linkedin_url text,
  facebook_url text,
  reddit_username text,
  twitter_handle text,
  instagram_handle text,
  sources text[] not null default '{}',
  confidence_score int,
  is_new_contact bool default false,
  auto_added_to_pipeline bool default false,
  raw_data jsonb,
  created_at timestamptz not null default now()
);
create index on public.individual_search_results(team_id);
create index on public.individual_search_results(search_id);
grant select, insert, update, delete on public.individual_search_results to authenticated;
grant all on public.individual_search_results to service_role;
alter table public.individual_search_results enable row level security;
create policy "team manages individual_search_results" on public.individual_search_results for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

-- Login approval
CREATE TABLE public.login_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  ip_address text,
  user_agent text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_login_requests_email ON public.login_requests(email);
CREATE INDEX idx_login_requests_status ON public.login_requests(status);
GRANT SELECT, INSERT, UPDATE ON public.login_requests TO authenticated;
GRANT ALL ON public.login_requests TO service_role;
ALTER TABLE public.login_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admin login_requests" ON public.login_requests FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TABLE public.approved_emails (
  email text PRIMARY KEY,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.approved_emails TO authenticated;
GRANT ALL ON public.approved_emails TO service_role;
ALTER TABLE public.approved_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admin approved_emails" ON public.approved_emails FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TABLE public.email_blocks (
  email text PRIMARY KEY,
  blocked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.email_blocks TO authenticated;
GRANT ALL ON public.email_blocks TO service_role;
ALTER TABLE public.email_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admin email_blocks" ON public.email_blocks FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- Contact notes
CREATE TABLE public.contact_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_contact_notes_contact_id ON public.contact_notes(contact_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_notes TO authenticated;
GRANT ALL ON public.contact_notes TO service_role;
ALTER TABLE public.contact_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages contact_notes" ON public.contact_notes FOR ALL TO authenticated USING (team_id = public.get_user_team(auth.uid())) WITH CHECK (team_id = public.get_user_team(auth.uid()));
CREATE TRIGGER update_contact_notes_updated_at BEFORE UPDATE ON public.contact_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Call history
CREATE TABLE public.call_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('outbound','inbound')),
  duration_seconds int,
  call_status text,
  recording_url text,
  transcription text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_call_history_contact_id ON public.call_history(contact_id);
CREATE INDEX idx_call_history_team_id ON public.call_history(team_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_history TO authenticated;
GRANT ALL ON public.call_history TO service_role;
ALTER TABLE public.call_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages call_history" ON public.call_history FOR ALL TO authenticated USING (team_id = public.get_user_team(auth.uid())) WITH CHECK (team_id = public.get_user_team(auth.uid()));

-- Notification queue + log
CREATE TABLE public.notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  channel text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.notification_queue TO authenticated;
GRANT ALL ON public.notification_queue TO service_role;
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team views notification_queue" ON public.notification_queue FOR SELECT TO authenticated USING (team_id = public.get_user_team(auth.uid()));
CREATE TRIGGER trg_notif_queue_updated_at BEFORE UPDATE ON public.notification_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.notifications_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT ON public.notifications_log TO authenticated;
GRANT ALL ON public.notifications_log TO service_role;
ALTER TABLE public.notifications_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team views notifications_log" ON public.notifications_log FOR SELECT TO authenticated USING (team_id = public.get_user_team(auth.uid()));

-- CSV import jobs
CREATE TABLE public.csv_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  total_rows int NOT NULL DEFAULT 0,
  imported_rows int NOT NULL DEFAULT 0,
  skipped_rows int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  error_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.csv_import_jobs TO authenticated;
GRANT ALL ON public.csv_import_jobs TO service_role;
ALTER TABLE public.csv_import_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages csv_import_jobs" ON public.csv_import_jobs FOR ALL TO authenticated USING (team_id = get_user_team(auth.uid())) WITH CHECK (team_id = get_user_team(auth.uid()));
CREATE TRIGGER update_csv_import_jobs_updated_at BEFORE UPDATE ON public.csv_import_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Workflows
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
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  last_run_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.workflows to authenticated;
grant all on public.workflows to service_role;
alter table public.workflows enable row level security;
create policy "team manages workflows" on public.workflows for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));
create trigger update_workflows_updated_at before update on public.workflows for each row execute function public.update_updated_at_column();

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
grant select, insert, update, delete on public.workflow_instances to authenticated;
grant all on public.workflow_instances to service_role;
alter table public.workflow_instances enable row level security;
create policy "team manages wfi" on public.workflow_instances for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

create table public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  team_id uuid NOT NULL,
  triggered_by uuid,
  trigger_source text NOT NULL DEFAULT 'manual' CHECK (trigger_source IN ('manual','auto','scheduled','webhook')),
  contacts_matched integer NOT NULL DEFAULT 0,
  contacts_processed integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','errored')),
  error_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_runs TO authenticated;
GRANT ALL ON public.workflow_runs TO service_role;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages workflow_runs" ON public.workflow_runs FOR ALL TO authenticated USING (team_id = get_user_team(auth.uid())) WITH CHECK (team_id = get_user_team(auth.uid()));

-- Client portals, monitors, proposals
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
grant select, insert, update, delete on public.client_portals to authenticated;
grant all on public.client_portals to service_role;
alter table public.client_portals enable row level security;
create policy "team manages portals" on public.client_portals for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

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
grant select, insert, update, delete on public.search_monitors to authenticated;
grant all on public.search_monitors to service_role;
alter table public.search_monitors enable row level security;
create policy "team manages monitors" on public.search_monitors for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));
create trigger update_monitors_updated_at before update on public.search_monitors for each row execute function public.update_updated_at_column();

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
grant select, insert, update, delete on public.proposals to authenticated;
grant all on public.proposals to service_role;
alter table public.proposals enable row level security;
create policy "team manages proposals" on public.proposals for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

-- Sending domains/inboxes
CREATE TABLE public.sending_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  domain text NOT NULL,
  spf_configured boolean NOT NULL DEFAULT false,
  dkim_configured boolean NOT NULL DEFAULT false,
  dmarc_configured boolean NOT NULL DEFAULT false,
  tracking_cname_configured boolean NOT NULL DEFAULT false,
  warming_status text NOT NULL DEFAULT 'cold' CHECK (warming_status IN ('cold','warming','warmed')),
  health_score integer NOT NULL DEFAULT 100,
  bounce_rate numeric NOT NULL DEFAULT 0,
  spam_rate numeric NOT NULL DEFAULT 0,
  dkim_public_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, domain)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sending_domains TO authenticated;
GRANT ALL ON public.sending_domains TO service_role;
ALTER TABLE public.sending_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages sending_domains" ON public.sending_domains FOR ALL USING (team_id = get_user_team(auth.uid())) WITH CHECK (team_id = get_user_team(auth.uid()));

CREATE TABLE public.sending_inboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  domain_id uuid NOT NULL REFERENCES public.sending_domains(id) ON DELETE CASCADE,
  email_address text NOT NULL,
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  smtp_password text,
  warm_up_stage integer NOT NULL DEFAULT 1 CHECK (warm_up_stage BETWEEN 1 AND 5),
  days_active integer NOT NULL DEFAULT 0,
  daily_limit integer NOT NULL DEFAULT 20,
  sent_today integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  bounce_rate numeric NOT NULL DEFAULT 0,
  spam_rate numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, email_address)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sending_inboxes TO authenticated;
GRANT ALL ON public.sending_inboxes TO service_role;
ALTER TABLE public.sending_inboxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages sending_inboxes" ON public.sending_inboxes FOR ALL USING (team_id = get_user_team(auth.uid())) WITH CHECK (team_id = get_user_team(auth.uid()));

CREATE TABLE public.dnc_suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  phone_or_email text NOT NULL,
  type text NOT NULL CHECK (type IN ('phone','email')),
  source text NOT NULL CHECK (source IN ('federal','internal','opt_out','manual','bounce')),
  reason text,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by_user_id uuid,
  UNIQUE (team_id, phone_or_email, type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dnc_suppression_list TO authenticated;
GRANT ALL ON public.dnc_suppression_list TO service_role;
ALTER TABLE public.dnc_suppression_list ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages dnc" ON public.dnc_suppression_list FOR ALL USING (team_id = get_user_team(auth.uid())) WITH CHECK (team_id = get_user_team(auth.uid()));

CREATE TABLE public.compliance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  campaign_id uuid,
  run_at timestamptz NOT NULL DEFAULT now(),
  contacts_total integer NOT NULL DEFAULT 0,
  contacts_sent integer NOT NULL DEFAULT 0,
  contacts_suppressed_dnc integer NOT NULL DEFAULT 0,
  contacts_suppressed_non_mobile integer NOT NULL DEFAULT 0,
  contacts_suppressed_timezone integer NOT NULL DEFAULT 0,
  contacts_suppressed_internal_dnc integer NOT NULL DEFAULT 0,
  compliance_passed boolean NOT NULL DEFAULT true,
  log_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_log TO authenticated;
GRANT ALL ON public.compliance_log TO service_role;
ALTER TABLE public.compliance_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages compliance" ON public.compliance_log FOR ALL USING (team_id = get_user_team(auth.uid())) WITH CHECK (team_id = get_user_team(auth.uid()));

CREATE TABLE public.blacklist_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  domain text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  is_listed boolean NOT NULL DEFAULT false,
  listed_on text[] NOT NULL DEFAULT '{}'::text[],
  check_provider text NOT NULL DEFAULT 'mxtoolbox'
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blacklist_checks TO authenticated;
GRANT ALL ON public.blacklist_checks TO service_role;
ALTER TABLE public.blacklist_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages blacklist" ON public.blacklist_checks FOR ALL USING (team_id = get_user_team(auth.uid())) WITH CHECK (team_id = get_user_team(auth.uid()));

CREATE TABLE public.campaign_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  total_contacts integer NOT NULL DEFAULT 0,
  total_sent integer NOT NULL DEFAULT 0,
  total_delivered integer NOT NULL DEFAULT 0,
  total_bounced integer NOT NULL DEFAULT 0,
  total_opened integer NOT NULL DEFAULT 0,
  total_replied integer NOT NULL DEFAULT 0,
  leads_generated integer NOT NULL DEFAULT 0,
  bounce_rate numeric NOT NULL DEFAULT 0,
  reply_rate numeric NOT NULL DEFAULT 0,
  cost_per_lead numeric NOT NULL DEFAULT 0,
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id)
);
GRANT SELECT ON public.campaign_metrics TO authenticated;
GRANT ALL ON public.campaign_metrics TO service_role;
ALTER TABLE public.campaign_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team views campaign_metrics" ON public.campaign_metrics FOR SELECT TO authenticated USING (team_id = public.get_user_team(auth.uid()));
CREATE TRIGGER update_campaign_metrics_updated_at BEFORE UPDATE ON public.campaign_metrics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Search activity + cache
CREATE TABLE public.search_activity (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  search_id uuid NOT NULL,
  team_id uuid NOT NULL,
  step text NOT NULL,
  status text NOT NULL DEFAULT 'info',
  icon text,
  message text NOT NULL,
  count integer,
  percent integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_search_activity_search ON public.search_activity(search_id, created_at);
GRANT SELECT, INSERT ON public.search_activity TO authenticated;
GRANT ALL ON public.search_activity TO service_role;
ALTER TABLE public.search_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team views search_activity" ON public.search_activity FOR SELECT TO authenticated USING (team_id = public.get_user_team(auth.uid()));
CREATE POLICY "team inserts search_activity" ON public.search_activity FOR INSERT TO authenticated WITH CHECK (team_id = public.get_user_team(auth.uid()));
ALTER TABLE public.search_activity REPLICA IDENTITY FULL;

CREATE TABLE public.search_results_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  search_type text NOT NULL CHECK (search_type IN ('business','individual')),
  cache_key text NOT NULL,
  keyword text NOT NULL,
  location text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  UNIQUE (team_id, search_type, cache_key)
);
GRANT SELECT ON public.search_results_cache TO authenticated;
GRANT ALL ON public.search_results_cache TO service_role;
ALTER TABLE public.search_results_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team views search_results_cache" ON public.search_results_cache FOR SELECT TO authenticated USING (team_id = get_user_team(auth.uid()));

-- Profiles extras + team extras
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS preferred_language text;

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS section_access jsonb DEFAULT NULL;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS white_label_secondary_color text,
  ADD COLUMN IF NOT EXISTS subdomain text,
  ADD COLUMN IF NOT EXISTS parent_team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS foundation_owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS teams_subdomain_unique ON public.teams (lower(subdomain)) WHERE subdomain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_teams_parent_team_id ON public.teams(parent_team_id);
ALTER TABLE public.teams ALTER COLUMN seat_limit SET DEFAULT 100000;

-- Active team session
CREATE TABLE public.active_team_session (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  acting_team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  set_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.active_team_session TO authenticated;
GRANT ALL ON public.active_team_session TO service_role;
ALTER TABLE public.active_team_session ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self manage active team" ON public.active_team_session FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_user_team(_user_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT acting_team_id FROM public.active_team_session WHERE user_id = _user_id), (SELECT team_id FROM public.profiles WHERE id = _user_id LIMIT 1));
$$;

-- Team invites
CREATE TABLE public.team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  email text NOT NULL,
  role app_role NOT NULL DEFAULT 'agent',
  invited_by uuid,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE (team_id, email)
);
GRANT SELECT ON public.team_invites TO authenticated;
GRANT ALL ON public.team_invites TO service_role;
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team admins view invites" ON public.team_invites FOR SELECT TO authenticated USING (team_id = public.get_user_team(auth.uid()) AND public.has_team_role(auth.uid(), team_id, 'admin'::app_role));
CREATE INDEX idx_team_invites_email ON public.team_invites (lower(email));

-- Subdomain requests
CREATE TABLE public.subdomain_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  subdomain text NOT NULL CHECK (subdomain ~ '^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  denial_reason text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subdomain_requests TO authenticated;
GRANT ALL ON public.subdomain_requests TO service_role;
ALTER TABLE public.subdomain_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team views own subdomain requests" ON public.subdomain_requests FOR SELECT TO authenticated USING (team_id = get_user_team(auth.uid()));
CREATE TRIGGER update_subdomain_requests_updated_at BEFORE UPDATE ON public.subdomain_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Email accounts
create table public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  provider text not null check (provider in ('gmail','brevo','smtp')),
  label text,
  from_email text not null,
  from_name text,
  api_key text,
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  smtp_password text,
  oauth_refresh_token text,
  daily_limit integer not null default 200,
  sent_today integer not null default 0,
  last_sent_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.email_accounts to authenticated;
grant all on public.email_accounts to service_role;
alter table public.email_accounts enable row level security;
create policy email_accounts_manage on public.email_accounts for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));

-- AI conversations
CREATE TABLE public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_conversations TO authenticated;
GRANT ALL ON public.ai_conversations TO service_role;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conversations" ON public.ai_conversations FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER ai_conversations_updated_at BEFORE UPDATE ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content text,
  tool_name text,
  tool_args jsonb,
  tool_result jsonb,
  tool_call_id text,
  model text,
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_messages TO authenticated;
GRANT ALL ON public.ai_messages TO service_role;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conversation messages" ON public.ai_messages FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));

CREATE TABLE public.ai_lookup_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash text NOT NULL UNIQUE,
  query jsonb NOT NULL,
  result jsonb NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
GRANT SELECT ON public.ai_lookup_cache TO authenticated;
GRANT ALL ON public.ai_lookup_cache TO service_role;
ALTER TABLE public.ai_lookup_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read cache" ON public.ai_lookup_cache FOR SELECT TO authenticated USING (true);

-- SMS threads
CREATE TABLE public.sms_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_preview text,
  unread_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, phone_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_threads TO authenticated;
GRANT ALL ON public.sms_threads TO service_role;
ALTER TABLE public.sms_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages sms_threads" ON public.sms_threads FOR ALL TO authenticated USING (team_id = public.get_user_team(auth.uid())) WITH CHECK (team_id = public.get_user_team(auth.uid()));
CREATE TRIGGER update_sms_threads_updated_at BEFORE UPDATE ON public.sms_threads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.sms_threads(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  body text NOT NULL,
  status text,
  twilio_sid text,
  from_number text NOT NULL,
  to_number text NOT NULL,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_messages TO authenticated;
GRANT ALL ON public.sms_messages TO service_role;
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages sms_messages" ON public.sms_messages FOR ALL TO authenticated USING (team_id = public.get_user_team(auth.uid())) WITH CHECK (team_id = public.get_user_team(auth.uid()));

-- Dialer providers
DO $$ BEGIN CREATE TYPE public.dialer_provider AS ENUM ('twilio','telnyx','bandwidth','vonage','plivo','signalwire','custom_sip');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.team_dialer_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  provider public.dialer_provider NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  from_number text,
  webhook_secret text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, provider)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_dialer_providers TO authenticated;
GRANT ALL ON public.team_dialer_providers TO service_role;
ALTER TABLE public.team_dialer_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage dialer providers" ON public.team_dialer_providers FOR ALL USING (public.has_team_role(auth.uid(), team_id, 'admin'::app_role)) WITH CHECK (public.has_team_role(auth.uid(), team_id, 'admin'::app_role));
CREATE TRIGGER trg_team_dialer_providers_updated BEFORE UPDATE ON public.team_dialer_providers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Whop / plans / signups / payments / subscriptions
CREATE TABLE public.whop_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  tier text NOT NULL,
  whop_user_id text,
  whop_session_id text UNIQUE,
  whop_membership_id text,
  status text NOT NULL DEFAULT 'pending',
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.whop_purchases TO authenticated;
GRANT ALL ON public.whop_purchases TO service_role;
ALTER TABLE public.whop_purchases ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_whop_purchases_updated_at BEFORE UPDATE ON public.whop_purchases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id) OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$$;

CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  price_monthly numeric NOT NULL,
  seats int NOT NULL DEFAULT 1,
  whop_plan_id text,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  whop_checkout_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans public read active" ON public.plans FOR SELECT USING (is_active = true);
CREATE TRIGGER plans_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.plans (slug, name, price_monthly, seats, features, sort_order, is_active) VALUES
  ('starter', 'Starter Engine', 149, 1, '["1,500 decision-maker contacts / mo","Pipeline + CRM","1 seat"]'::jsonb, 1, true),
  ('professional', 'Professional Engine', 499, 3, '["6,000 contacts / mo","3 seats","Team inbox"]'::jsonb, 2, true),
  ('enterprise', 'Enterprise Engine', 999, 10, '["20,000+ contacts / mo","10 seats + sub-accounts","Dedicated success manager"]'::jsonb, 3, true)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE public.signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  company text,
  business_type text,
  team_size text,
  selected_plan_slug text,
  status text NOT NULL DEFAULT 'new',
  notes text,
  access_code text,
  access_code_used_at timestamptz,
  access_code_expires_at timestamptz,
  whop_payment_id text,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.signups TO authenticated;
GRANT ALL ON public.signups TO service_role;
ALTER TABLE public.signups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signups owner read" ON public.signups FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "signups owner write" ON public.signups FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE TRIGGER signups_updated_at BEFORE UPDATE ON public.signups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_id uuid REFERENCES public.signups(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  whop_payment_id text UNIQUE,
  whop_membership_id text,
  whop_plan_id text,
  buyer_email text,
  amount numeric,
  currency text DEFAULT 'usd',
  status text NOT NULL,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments owner read" ON public.payments FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_slug text,
  whop_membership_id text UNIQUE,
  seats int DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subs owner read" ON public.subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE TRIGGER subs_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- API credit snapshots
CREATE TABLE public.api_credit_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  provider text NOT NULL,
  balance numeric,
  balance_unit text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_credit_snapshots TO authenticated;
GRANT ALL ON public.api_credit_snapshots TO service_role;
ALTER TABLE public.api_credit_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages credit snapshots" ON public.api_credit_snapshots FOR ALL USING (team_id = public.get_user_team(auth.uid())) WITH CHECK (team_id = public.get_user_team(auth.uid()));

-- DFD schema
create schema if not exists dfd;
grant usage on schema dfd to authenticated;
create type dfd.disposition_kind as enum ('connected_interested','connected_not_interested','no_answer','voicemail','wrong_number','callback_requested');
create type dfd.note_tag as enum ('call_attempt','voicemail','callback_requested','not_interested','hot_lead');

create table dfd.call_dispositions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  contact_id uuid not null,
  user_id uuid not null,
  disposition dfd.disposition_kind not null,
  callback_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
alter table dfd.call_dispositions enable row level security;
grant select, insert, update, delete on dfd.call_dispositions to authenticated;
create policy "team manages dispositions" on dfd.call_dispositions for all using (team_id = public.get_user_team(auth.uid())) with check (team_id = public.get_user_team(auth.uid()));

create table dfd.contact_internal_notes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  contact_id uuid not null,
  user_id uuid not null,
  tag dfd.note_tag not null default 'call_attempt',
  body text not null,
  created_at timestamptz not null default now()
);
alter table dfd.contact_internal_notes enable row level security;
grant select, insert, update, delete on dfd.contact_internal_notes to authenticated;
create policy "team manages notes" on dfd.contact_internal_notes for all using (team_id = public.get_user_team(auth.uid())) with check (team_id = public.get_user_team(auth.uid()));

create table dfd.daily_targets (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  user_id uuid not null,
  daily_call_target int not null default 30,
  weekly_lead_target int not null default 25,
  updated_at timestamptz not null default now(),
  unique (team_id, user_id)
);
alter table dfd.daily_targets enable row level security;
grant select, insert, update, delete on dfd.daily_targets to authenticated;
create policy "team manages targets" on dfd.daily_targets for all using (team_id = public.get_user_team(auth.uid())) with check (team_id = public.get_user_team(auth.uid()));

create table dfd.export_logs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  user_id uuid not null,
  export_type text not null,
  filters jsonb not null default '{}'::jsonb,
  record_count int not null default 0,
  created_at timestamptz not null default now()
);
alter table dfd.export_logs enable row level security;
grant select, insert on dfd.export_logs to authenticated;
create policy "team manages export logs" on dfd.export_logs for all using (team_id = public.get_user_team(auth.uid())) with check (team_id = public.get_user_team(auth.uid()));

-- Signup trigger
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_team_id uuid;
  user_plan plan_tier;
  user_contact_limit int;
  user_seat_limit int;
  invited_team uuid;
  invited_role_text text;
  invited_role app_role;
begin
  invited_team := nullif(new.raw_user_meta_data->>'invited_team_id','')::uuid;
  invited_role_text := new.raw_user_meta_data->>'invited_role';
  if invited_team is not null then
    begin invited_role := coalesce(invited_role_text::app_role, 'agent'::app_role);
    exception when others then invited_role := 'agent'::app_role; end;
    insert into public.profiles (id, email, name, team_id) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name',''), invited_team);
    insert into public.user_roles (user_id, team_id, role) values (new.id, invited_team, invited_role) on conflict do nothing;
    update public.team_invites set status = 'accepted', accepted_at = now() where team_id = invited_team and lower(email) = lower(new.email) and status = 'pending';
    return new;
  end if;
  user_plan := coalesce((new.raw_user_meta_data->>'plan')::plan_tier, 'starter'::plan_tier);
  user_contact_limit := case user_plan when 'starter' then 5000 when 'growth' then 25000 when 'agency' then 1000000 end;
  user_seat_limit := case user_plan when 'starter' then 1 when 'growth' then 3 when 'agency' then 10 end;
  insert into public.teams (name, owner_id, plan, contact_limit, seat_limit)
  values (coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)) || '''s Team', new.id, user_plan, user_contact_limit, user_seat_limit)
  returning id into new_team_id;
  insert into public.profiles (id, email, name, team_id) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''), new_team_id);
  insert into public.user_roles (user_id, team_id, role) values (new.id, new_team_id, 'admin');
  insert into public.team_settings (team_id) values (new_team_id);
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
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Realtime
alter publication supabase_realtime add table public.activity_log;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.pipeline_leads;
alter publication supabase_realtime add table public.searches;
alter publication supabase_realtime add table public.search_steps;
alter publication supabase_realtime add table public.search_results;
alter publication supabase_realtime add table public.search_activity;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.enrichment_jobs;
alter publication supabase_realtime add table public.individual_searches;
alter publication supabase_realtime add table public.individual_search_results;
alter publication supabase_realtime add table public.contact_notes;
alter publication supabase_realtime add table public.contacts;

-- Storage policies (bucket already created via tool)
DROP POLICY IF EXISTS "Avatars are publicly accessible" ON storage.objects;
CREATE POLICY "Avatars are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
DROP POLICY IF EXISTS "Users upload own avatar" ON storage.objects;
CREATE POLICY "Users upload own avatar" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "Users update own avatar" ON storage.objects;
CREATE POLICY "Users update own avatar" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "Users delete own avatar" ON storage.objects;
CREATE POLICY "Users delete own avatar" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);