-- Multiple connected email sender accounts per team, across providers, with
-- per-account daily caps for load-balanced sending (anti-spam / anti-rate-limit).
create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  provider text not null check (provider in ('gmail','brevo','smtp')),
  label text,
  from_email text not null,
  from_name text,
  -- provider credentials (nullable; which ones apply depends on provider)
  api_key text,            -- brevo
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  smtp_password text,
  oauth_refresh_token text,-- gmail
  daily_limit integer not null default 200,
  sent_today integer not null default 0,
  last_sent_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists email_accounts_team_idx on public.email_accounts(team_id);

alter table public.email_accounts enable row level security;

-- Team members can read their team's accounts; only admins/managers write.
drop policy if exists email_accounts_select on public.email_accounts;
create policy email_accounts_select on public.email_accounts
  for select using (
    team_id in (select team_id from public.user_roles where user_id = auth.uid())
  );

drop policy if exists email_accounts_write on public.email_accounts;
create policy email_accounts_write on public.email_accounts
  for all using (
    team_id in (
      select team_id from public.user_roles
      where user_id = auth.uid() and role in ('admin','manager')
    )
  ) with check (
    team_id in (
      select team_id from public.user_roles
      where user_id = auth.uid() and role in ('admin','manager')
    )
  );

-- Atomically reserve a send slot on the least-recently-used active account that
-- still has daily quota. Resets per-day counters. Returns the chosen account id.
create or replace function public.reserve_email_account(p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- roll over daily counters
  update public.email_accounts
    set sent_today = 0, last_sent_date = current_date
    where team_id = p_team_id and (last_sent_date is null or last_sent_date < current_date);

  -- pick active account with remaining quota, least used first (load balance)
  select id into v_id
    from public.email_accounts
    where team_id = p_team_id and is_active = true and sent_today < daily_limit
    order by sent_today asc, last_sent_date asc nulls first, created_at asc
    limit 1
    for update skip locked;

  if v_id is null then
    return null;
  end if;

  update public.email_accounts
    set sent_today = sent_today + 1, last_sent_date = current_date
    where id = v_id;

  return v_id;
end;
$$;
