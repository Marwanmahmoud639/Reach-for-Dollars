-- Autonomous AI voice calls (Twilio Media Streams <-> OpenAI Realtime).
--
-- COMPLIANCE CONTEXT — this is not optional decoration:
-- The FCC's Feb 2024 declaratory ruling holds that AI-generated voices are
-- "artificial" under the TCPA. That means an AI sales call is an artificial-
-- voice call and carries per-call statutory damages ($500-$1,500) when placed
-- without prior express written consent, outside 8am-9pm in the CALLED party's
-- local time, or to a suppressed number. Several states additionally require
-- the AI to identify itself as non-human at the start of the conversation.
--
-- Every one of those gates is enforced before a call is dialled, and the
-- decision is recorded here so a call can be defended after the fact.

create table if not exists public.ai_call_sessions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  agent_id uuid references public.voice_agents(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  started_by uuid references auth.users(id) on delete set null,

  to_number text not null,
  from_number text not null,
  provider_call_sid text,

  -- pending -> dialing -> in_progress -> completed | failed | blocked
  -- 'blocked' means a compliance gate refused it; the row is kept as evidence
  -- that the call was stopped rather than silently dropped.
  status text not null default 'pending',
  block_reason text,

  -- Compliance evidence, captured at dial time rather than inferred later.
  disclosure_text text,
  disclosure_spoken_at timestamptz,
  consent_basis text,              -- e.g. 'prior_express_written', 'existing_business_relationship'
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

create index if not exists ai_call_sessions_team_created_idx
  on public.ai_call_sessions (team_id, created_at desc);
create index if not exists ai_call_sessions_sid_idx
  on public.ai_call_sessions (provider_call_sid) where provider_call_sid is not null;

alter table public.ai_call_sessions enable row level security;

drop policy if exists "team views ai calls" on public.ai_call_sessions;
create policy "team views ai calls"
  on public.ai_call_sessions for select to authenticated
  using (team_id = public.get_user_team(auth.uid()));

grant select on public.ai_call_sessions to authenticated;
grant all on public.ai_call_sessions to service_role;

-- Calling window + disclosure config. Defaults are the federal TCPA window;
-- teams may narrow it but the application refuses to widen past 8-21.
alter table public.team_settings
  add column if not exists ai_call_window_start_hour smallint not null default 9
    check (ai_call_window_start_hour >= 8 and ai_call_window_start_hour <= 20),
  add column if not exists ai_call_window_end_hour smallint not null default 20
    check (ai_call_window_end_hour >= 9 and ai_call_window_end_hour <= 21),
  add column if not exists ai_call_disclosure text
    not null default 'Hi, this is an AI assistant calling on behalf of {company}. This call may be recorded.',
  add column if not exists ai_calls_enabled boolean not null default false;

comment on column public.team_settings.ai_calls_enabled is
  'Master switch for autonomous AI calling. Off by default — a team must consciously enable it after configuring consent basis and caller ID.';
comment on column public.team_settings.ai_call_disclosure is
  'Spoken verbatim as the AI first turn. Removing the AI identification breaks state-level disclosure rules; {company} is substituted at dial time.';

-- Is this number suppressed for the team? Checked immediately before dialling
-- rather than trusting a stale import.
create or replace function public.is_number_suppressed(_team_id uuid, _phone text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.dnc_suppression_list
    where team_id = _team_id
      and type = 'phone'
      -- Compare on digits only so formatting differences can't create a miss.
      and regexp_replace(phone_or_email, '[^0-9]', '', 'g')
          = regexp_replace(_phone, '[^0-9]', '', 'g')
  );
$$;
