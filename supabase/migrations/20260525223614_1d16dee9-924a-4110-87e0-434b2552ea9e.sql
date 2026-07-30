
-- 1. Super admin registry (separate from team-scoped user_roles)
create table if not exists public.super_admins (
  user_id uuid primary key,
  granted_at timestamptz not null default now(),
  granted_by uuid
);

alter table public.super_admins enable row level security;

-- 2. Security definer check
create or replace function public.is_super_admin(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.super_admins where user_id = _user_id);
$$;

-- Self-view + super-admins manage list
drop policy if exists "users view own super admin" on public.super_admins;
create policy "users view own super admin" on public.super_admins
  for select using (auth.uid() = user_id or public.is_super_admin(auth.uid()));

drop policy if exists "super admins manage list" on public.super_admins;
create policy "super admins manage list" on public.super_admins
  for all using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

-- 3. Blanket override policies on every business table
do $$
declare
  t text;
  tables text[] := array[
    'teams','profiles','team_settings','user_roles','sub_accounts',
    'contacts','contact_emails','contact_phones','business_intel',
    'campaigns','campaign_contacts','follow_up_sequences',
    'pipeline_stages','pipeline_leads',
    'searches','search_steps','search_results',
    'ai_personalization_jobs','job_queue',
    'activity_log','notifications','custom_field_defs'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists "super admin full access" on public.%I', t);
    execute format(
      'create policy "super admin full access" on public.%I for all to public using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()))',
      t
    );
  end loop;
end $$;
