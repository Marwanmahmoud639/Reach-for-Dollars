-- Per-team feature entitlements, brand colour, and the platform rate card.
--
-- Section access (roles.ts) already controls which nav items a USER sees inside
-- a team. That is a permissions concern and is not a paywall: a rep hidden from
-- a section can still be granted it by their own admin. Entitlements are the
-- separate, commercial question — has this ACCOUNT paid for the capability at
-- all — and only a super admin can change them.

create table if not exists public.team_entitlements (
  team_id uuid primary key references public.teams(id) on delete cascade,

  -- Capabilities that cost real money to operate, so each is sold separately.
  ai_caller boolean not null default false,
  dialer boolean not null default false,
  sms boolean not null default false,
  email_campaigns boolean not null default false,
  discovery boolean not null default false,
  social_dm boolean not null default false,

  -- Volume ceilings. Sends beyond the daily cap draw platform credits instead
  -- of being refused outright, which is what makes overage sellable.
  daily_email_limit integer not null default 300,
  daily_sms_limit integer not null default 100,
  monthly_ai_call_minutes integer not null default 0,
  overage_allowed boolean not null default false,

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.team_entitlements enable row level security;

-- A team may READ its own entitlements so the UI can hide or explain locked
-- features. Only the service role writes them: a team admin must never be able
-- to grant themselves a paid capability.
drop policy if exists "team views own entitlements" on public.team_entitlements;
create policy "team views own entitlements"
  on public.team_entitlements for select to authenticated
  using (team_id = public.get_user_team(auth.uid())
         or exists (select 1 from public.super_admins where user_id = auth.uid()));

grant select on public.team_entitlements to authenticated;
grant all on public.team_entitlements to service_role;

-- Every existing team keeps working: backfill from the plan it already has.
insert into public.team_entitlements (
  team_id, ai_caller, dialer, sms, email_campaigns, discovery, social_dm,
  daily_email_limit, monthly_ai_call_minutes, overage_allowed
)
select
  t.id,
  t.plan = 'agency',
  t.plan in ('growth', 'agency'),
  t.plan in ('growth', 'agency'),
  true,
  t.plan in ('growth', 'agency'),
  t.plan = 'agency',
  case t.plan when 'starter' then 300 when 'growth' then 1000 else 5000 end,
  case t.plan when 'agency' then 500 else 0 end,
  t.plan <> 'starter'
from public.teams t
on conflict (team_id) do nothing;

-- Account accent colour, used for sub-account branding.
alter table public.teams
  add column if not exists brand_color text
    check (brand_color is null or brand_color ~* '^#[0-9a-f]{6}$');

comment on column public.teams.brand_color is
  'Hex accent colour (#rrggbb) for this account''s branding. Null falls back to the platform default.';

-- ─── Platform rate card ──────────────────────────────────────────────────────
-- What a unit costs US versus what we charge for it in credits. Super-admin
-- only: this is the margin table, and exposing it to tenants would reveal
-- wholesale pricing.
create table if not exists public.platform_rate_card (
  id uuid primary key default gen_random_uuid(),
  -- e.g. 'ai_call_minute', 'sms_outbound', 'email_send', 'discovery_run'
  unit_key text not null unique,
  label text not null,
  -- Our wholesale cost from the underlying vendor.
  cost_usd numeric(12, 6) not null default 0,
  -- What the tenant is billed, in platform credits.
  credits_charged numeric(12, 4) not null default 1,
  vendor text,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.platform_rate_card enable row level security;

drop policy if exists "super admins manage rate card" on public.platform_rate_card;
create policy "super admins manage rate card"
  on public.platform_rate_card for all to authenticated
  using (exists (select 1 from public.super_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.super_admins where user_id = auth.uid()));

grant select, insert, update, delete on public.platform_rate_card to authenticated;
grant all on public.platform_rate_card to service_role;

-- Seed with current known vendor pricing (2026-07). cost_usd must be revisited
-- whenever a vendor changes price, or the margin figures silently drift.
insert into public.platform_rate_card (unit_key, label, cost_usd, credits_charged, vendor, notes) values
  ('ai_call_minute',  'AI call — per minute',   0.30,   10, 'openai+twilio', 'OpenAI Realtime audio in+out plus Twilio voice leg'),
  ('dialer_minute',   'Human dial — per minute', 0.014,  1, 'twilio',        'Outbound PSTN'),
  ('sms_outbound',    'SMS — per message',       0.0079, 1, 'twilio',        'US A2P long code'),
  ('email_send',      'Email — per send',        0.0004, 1, 'lovable_email', 'Transactional/campaign send'),
  ('discovery_run',   'Discovery — per search',  0.02,  25, 'firecrawl',     'Roughly 10 Firecrawl searches per run'),
  ('email_verify',    'Email verification',      0.0004, 1, 'millionverifier', 'Mailbox-level check')
on conflict (unit_key) do nothing;

-- Margin per unit, for the super-admin billing view.
create or replace function public.rate_card_margin()
returns table (
  unit_key text, label text, cost_usd numeric,
  credits_charged numeric, vendor text
)
language sql
stable
set search_path to 'public'
as $$
  select unit_key, label, cost_usd, credits_charged, vendor
  from public.platform_rate_card
  order by unit_key;
$$;
