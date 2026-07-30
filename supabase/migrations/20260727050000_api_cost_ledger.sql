-- API cost ledger + per-run budget ceiling.
--
-- Every outbound call to a paid vendor (Firecrawl, Serper, Apollo, MillionVerifier,
-- …) is recorded here with what it actually cost us. Users are billed in our own
-- credits and never see these rows; this table exists so we can answer "what does
-- one discovery run cost us" with data instead of a guess, and so a single
-- pathological run cannot silently burn the month's API budget.

create table if not exists public.api_cost_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  -- Which run this cost belongs to. Nullable: some calls (credit-balance polls,
  -- webhook retries) are not attributable to a specific search.
  search_id uuid,
  -- 'discovery' | 'individual' | null when not run-scoped.
  search_kind text,
  provider text not null,
  operation text not null,
  -- Billable units consumed (searches, scrapes, enrichments, verifications).
  units integer not null default 1,
  -- Cost per unit at time of call, so historical rows stay accurate when
  -- vendor pricing changes.
  unit_cost_usd numeric(12, 6) not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists api_cost_events_team_created_idx
  on public.api_cost_events (team_id, created_at desc);
create index if not exists api_cost_events_search_idx
  on public.api_cost_events (search_id) where search_id is not null;

alter table public.api_cost_events enable row level security;

-- Read-only for the owning team. Rows are written by edge functions using the
-- service-role key, which bypasses RLS, so no insert policy is granted here on
-- purpose: nothing client-side should be able to forge cost rows.
drop policy if exists "team views own api costs" on public.api_cost_events;
create policy "team views own api costs"
  on public.api_cost_events for select
  using (team_id = public.get_user_team(auth.uid()));

drop policy if exists "super admins view all api costs" on public.api_cost_events;
create policy "super admins view all api costs"
  on public.api_cost_events for select
  using (exists (select 1 from public.super_admins where user_id = auth.uid()));

-- Per-run spend ceiling, in USD. A run that reaches this stops making paid
-- calls and finishes with whatever it has rather than failing outright, so the
-- user still gets partial results.
alter table public.team_settings
  add column if not exists max_run_cost_usd numeric(12, 6) not null default 1.00;

comment on column public.team_settings.max_run_cost_usd is
  'Hard ceiling on paid-vendor spend for a single discovery run. 0 disables paid calls entirely (free sources only).';

-- Total spend for one run. Deliberately NOT security definer: it reads through
-- api_cost_events' RLS, so a caller only ever sums their own team's rows. Edge
-- functions use the service-role key and bypass RLS as usual.
create or replace function public.run_cost_usd(_search_id uuid)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(sum(cost_usd), 0) from public.api_cost_events where search_id = _search_id;
$$;
