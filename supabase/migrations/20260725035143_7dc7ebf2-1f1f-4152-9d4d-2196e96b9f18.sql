
-- 1) Extend teams with trial + ideal-customer + sending-email fields
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_status text NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS trial_discovery_limit integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS trial_message_limit   integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS trial_pipeline_limit  integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ideal_customer jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sending_email_provider text,
  ADD COLUMN IF NOT EXISTS sending_email_address text;

-- 2) Onboarding progress table
CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  team_id uuid PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  current_step integer NOT NULL DEFAULT 1,
  business_name text,
  domain text,
  scan_result jsonb,
  personas jsonb,
  firmographics jsonb,
  signal_brief jsonb,
  sample_leads jsonb,
  connected_apis jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_progress TO authenticated;
GRANT ALL ON public.onboarding_progress TO service_role;

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team members read own onboarding"
  ON public.onboarding_progress FOR SELECT TO authenticated
  USING (public.is_team_member(auth.uid(), team_id) OR public.is_super_admin(auth.uid()));

CREATE POLICY "team admins write onboarding"
  ON public.onboarding_progress FOR ALL TO authenticated
  USING (public.has_team_role(auth.uid(), team_id, 'admin'::app_role) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.has_team_role(auth.uid(), team_id, 'admin'::app_role) OR public.is_super_admin(auth.uid()));

CREATE TRIGGER onboarding_progress_touch
  BEFORE UPDATE ON public.onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Trial usage counters
CREATE TABLE IF NOT EXISTS public.trial_usage (
  team_id uuid PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  discovery_used integer NOT NULL DEFAULT 0,
  messages_used  integer NOT NULL DEFAULT 0,
  pipeline_used  integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.trial_usage TO authenticated;
GRANT ALL ON public.trial_usage TO service_role;

ALTER TABLE public.trial_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team members read own trial usage"
  ON public.trial_usage FOR SELECT TO authenticated
  USING (public.is_team_member(auth.uid(), team_id) OR public.is_super_admin(auth.uid()));

CREATE TRIGGER trial_usage_touch
  BEFORE UPDATE ON public.trial_usage
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Plans get a trial_days marker + set 3 days on active plans
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS trial_days integer NOT NULL DEFAULT 0;

UPDATE public.plans SET trial_days = 3 WHERE is_active = true;

-- 5) Backfill: existing teams start in "active" (no trial disruption).
--    Only brand-new teams created after this migration go through the trial flow via handle_new_user.
UPDATE public.teams
   SET plan_status = 'active'
 WHERE plan_status = 'trial'
   AND onboarding_completed_at IS NULL
   AND created_at < now() - interval '1 minute';

-- 6) Update handle_new_user so new signups start on trial + get an onboarding row
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  insert into public.teams (name, owner_id, plan, contact_limit, seat_limit, plan_status, trial_started_at, trial_ends_at)
  values (
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)) || '''s Team',
    new.id, user_plan, user_contact_limit, user_seat_limit,
    'trial', now(), now() + interval '3 days'
  )
  returning id into new_team_id;
  insert into public.profiles (id, email, name, team_id) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''), new_team_id);
  insert into public.user_roles (user_id, team_id, role) values (new.id, new_team_id, 'admin');
  insert into public.team_settings (team_id) values (new_team_id);
  insert into public.onboarding_progress (team_id, current_step) values (new_team_id, 1);
  insert into public.trial_usage (team_id) values (new_team_id);
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
end;
$function$;
