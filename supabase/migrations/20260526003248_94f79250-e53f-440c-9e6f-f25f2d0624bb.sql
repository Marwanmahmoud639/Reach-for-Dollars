create schema if not exists dfd;
grant usage on schema dfd to authenticated;

create type dfd.disposition_kind as enum (
  'connected_interested','connected_not_interested','no_answer','voicemail','wrong_number','callback_requested'
);

create type dfd.note_tag as enum (
  'call_attempt','voicemail','callback_requested','not_interested','hot_lead'
);

-- Call dispositions
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
create index on dfd.call_dispositions (team_id, created_at desc);
create index on dfd.call_dispositions (contact_id);
create index on dfd.call_dispositions (user_id, created_at desc);
alter table dfd.call_dispositions enable row level security;
grant select, insert, update, delete on dfd.call_dispositions to authenticated;

create policy "team views dispositions" on dfd.call_dispositions for select
  using (team_id = public.get_user_team(auth.uid()));
create policy "team inserts dispositions" on dfd.call_dispositions for insert
  with check (team_id = public.get_user_team(auth.uid()) and user_id = auth.uid());
create policy "managers update dispositions" on dfd.call_dispositions for update
  using (team_id = public.get_user_team(auth.uid()) and (
    public.has_team_role(auth.uid(), team_id, 'admin') or
    public.has_team_role(auth.uid(), team_id, 'manager') or user_id = auth.uid()
  ));
create policy "super admin all dispositions" on dfd.call_dispositions for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

-- Internal notes
create table dfd.contact_internal_notes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  contact_id uuid not null,
  user_id uuid not null,
  tag dfd.note_tag not null default 'call_attempt',
  body text not null,
  created_at timestamptz not null default now()
);
create index on dfd.contact_internal_notes (contact_id, created_at desc);
alter table dfd.contact_internal_notes enable row level security;
grant select, insert, update, delete on dfd.contact_internal_notes to authenticated;

create policy "team views notes" on dfd.contact_internal_notes for select
  using (team_id = public.get_user_team(auth.uid()));
create policy "team inserts notes" on dfd.contact_internal_notes for insert
  with check (team_id = public.get_user_team(auth.uid()) and user_id = auth.uid());
create policy "author updates notes" on dfd.contact_internal_notes for update
  using (user_id = auth.uid() or public.has_team_role(auth.uid(), team_id, 'admin'));
create policy "author deletes notes" on dfd.contact_internal_notes for delete
  using (user_id = auth.uid() or public.has_team_role(auth.uid(), team_id, 'admin'));
create policy "super admin all notes" on dfd.contact_internal_notes for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

-- Daily targets
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

create policy "team views targets" on dfd.daily_targets for select
  using (team_id = public.get_user_team(auth.uid()));
create policy "managers manage targets" on dfd.daily_targets for all
  using (team_id = public.get_user_team(auth.uid()) and (
    public.has_team_role(auth.uid(), team_id, 'admin') or
    public.has_team_role(auth.uid(), team_id, 'manager')
  ))
  with check (team_id = public.get_user_team(auth.uid()) and (
    public.has_team_role(auth.uid(), team_id, 'admin') or
    public.has_team_role(auth.uid(), team_id, 'manager')
  ));
create policy "super admin all targets" on dfd.daily_targets for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

-- Export logs
create table dfd.export_logs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  user_id uuid not null,
  export_type text not null,
  filters jsonb not null default '{}'::jsonb,
  record_count int not null default 0,
  created_at timestamptz not null default now()
);
create index on dfd.export_logs (team_id, created_at desc);
alter table dfd.export_logs enable row level security;
grant select, insert on dfd.export_logs to authenticated;

create policy "owner views export logs" on dfd.export_logs for select
  using (team_id = public.get_user_team(auth.uid()) and public.has_team_role(auth.uid(), team_id, 'admin'));
create policy "team inserts export logs" on dfd.export_logs for insert
  with check (team_id = public.get_user_team(auth.uid()) and user_id = auth.uid());
create policy "super admin all export logs" on dfd.export_logs for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));