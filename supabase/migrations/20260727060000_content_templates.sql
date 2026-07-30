-- Reusable outreach content library.
--
-- Until now campaigns stored their body/subject inline, so nothing could be
-- reused across campaigns and there was no way to ask "which opener actually
-- books meetings". This table is the single home for every piece of outreach
-- copy — email, SMS, call scripts, and social DMs — plus the counters the
-- Intelligence section reads to rank what performs.

create table if not exists public.content_templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,

  kind text not null check (kind in ('email', 'sms', 'call_script', 'dm')),
  -- Only meaningful for kind='dm'; each network has its own tone and limits.
  platform text check (platform in ('facebook', 'instagram', 'linkedin')),

  name text not null,
  description text,
  -- Lets the AI trainer and discovery pull copy matched to the lead's vertical.
  industry text,

  subject text,                       -- email only
  body_text text not null default '', -- plain text; the canonical body for sms/dm/script
  body_html text,                     -- email only, optional rich version

  -- Merge fields found in the body, e.g. {first_name}. Denormalised so the UI
  -- can warn about unknown variables without re-parsing on every render.
  variables text[] not null default '{}',
  tags text[] not null default '{}',
  is_active boolean not null default true,

  -- Outcome counters. Written by the send/reply paths, read by Intelligence.
  times_used integer not null default 0,
  times_responded integer not null default 0,
  times_converted integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A DM must say which network it targets; nothing else may.
  constraint content_templates_platform_only_for_dm
    check ((kind = 'dm' and platform is not null) or (kind <> 'dm' and platform is null)),
  -- Email is the only kind with a subject line.
  constraint content_templates_subject_only_for_email
    check (kind = 'email' or subject is null)
);

create index if not exists content_templates_team_kind_idx
  on public.content_templates (team_id, kind, is_active);
create index if not exists content_templates_industry_idx
  on public.content_templates (team_id, industry) where industry is not null;

alter table public.content_templates enable row level security;

drop policy if exists "team views templates" on public.content_templates;
create policy "team views templates"
  on public.content_templates for select to authenticated
  using (team_id = public.get_user_team(auth.uid()));

drop policy if exists "team manages templates" on public.content_templates;
create policy "team manages templates"
  on public.content_templates for all to authenticated
  using (team_id = public.get_user_team(auth.uid()))
  with check (team_id = public.get_user_team(auth.uid()));

grant select, insert, update, delete on public.content_templates to authenticated;
grant all on public.content_templates to service_role;

-- Keep updated_at honest without every caller remembering to set it.
create or replace function public.touch_content_templates_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists content_templates_touch_updated_at on public.content_templates;
create trigger content_templates_touch_updated_at
  before update on public.content_templates
  for each row execute function public.touch_content_templates_updated_at();

-- Response rate is the ranking signal for "what's working". Division guarded so
-- an unused template sorts as 0 rather than erroring.
create or replace function public.template_response_rate(_template_id uuid)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select case when times_used > 0
              then round((times_responded::numeric / times_used) * 100, 2)
              else 0 end
  from public.content_templates where id = _template_id;
$$;
