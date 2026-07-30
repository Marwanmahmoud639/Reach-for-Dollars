
-- 1. Contacts: add B2B fallback tracking
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS business_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dm_search_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dm_last_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS business_verified_sources text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_contacts_business_only ON public.contacts(team_id, business_only) WHERE business_only = true;

-- 2. Half-credit support: teams.credits_used → numeric
ALTER TABLE public.teams
  ALTER COLUMN credits_used TYPE numeric(12,2) USING credits_used::numeric;

-- 3. Update consume_credits to accept numeric amount
CREATE OR REPLACE FUNCTION public.consume_credits(_team_id uuid, _amount numeric, _kind text DEFAULT 'generic'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.teams%ROWTYPE;
  new_used numeric;
  pct numeric;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN _amount := 1; END IF;

  IF public.team_owner_is_super_admin(_team_id) THEN
    RETURN jsonb_build_object('ok', true, 'kind', _kind, 'super_admin', true, 'used', 0, 'total', 999999999, 'remaining', 999999999);
  END IF;

  SELECT * INTO t FROM public.teams WHERE id = _team_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_team'); END IF;

  IF t.plan_status = 'trial' AND t.trial_ends_at IS NOT NULL AND t.trial_ends_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trial_expired', 'used', t.credits_used, 'total', t.credits_total);
  END IF;

  new_used := t.credits_used + _amount;
  IF new_used > t.credits_total THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cap_reached', 'kind', _kind,
      'used', t.credits_used, 'total', t.credits_total, 'remaining', GREATEST(0, t.credits_total - t.credits_used));
  END IF;

  UPDATE public.teams SET credits_used = new_used WHERE id = _team_id;
  pct := (new_used / NULLIF(t.credits_total,0)::numeric) * 100;

  RETURN jsonb_build_object('ok', true, 'kind', _kind, 'used', new_used, 'total', t.credits_total,
    'remaining', t.credits_total - new_used, 'warn', pct >= 90);
END;
$function$;

-- Drop old integer signature so PostgREST resolves to numeric version
DROP FUNCTION IF EXISTS public.consume_credits(uuid, integer, text);

-- 4. Update contact-insert trigger: 0.5 credit for business_only, 1 for DM
CREATE OR REPLACE FUNCTION public.tg_charge_contact_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE res jsonb; amt numeric;
BEGIN
  IF NEW.source = 'discovery' AND NEW.team_id IS NOT NULL THEN
    amt := CASE WHEN COALESCE(NEW.business_only, false) THEN 0.5 ELSE 1 END;
    res := public.consume_credits(NEW.team_id, amt, 'discovery');
    IF (res->>'ok')::boolean IS FALSE THEN NULL; END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 5. Seed "Needs DM Research" pipeline stage for every existing team
INSERT INTO public.pipeline_stages (team_id, name, position, color)
SELECT t.id, 'Needs DM Research', -1, '#F97316'
FROM public.teams t
WHERE NOT EXISTS (
  SELECT 1 FROM public.pipeline_stages ps
  WHERE ps.team_id = t.id AND ps.name = 'Needs DM Research'
);

-- 6. Update handle_new_user + create_sub_account to seed the new stage
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
    (new_team_id, 'Needs DM Research', -1, '#F97316'),
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

CREATE OR REPLACE FUNCTION public.create_sub_account(_name text, _plan plan_tier DEFAULT 'starter'::plan_tier)
 RETURNS teams
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE parent_id uuid; new_team public.teams%ROWTYPE; contact_lim int; seat_lim int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT team_id INTO parent_id FROM public.profiles WHERE id = auth.uid();
  IF parent_id IS NULL THEN RAISE EXCEPTION 'No team'; END IF;
  IF NOT public.has_team_role(auth.uid(), parent_id, 'admin') AND NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Only agency admins can create sub-accounts'; END IF;
  IF EXISTS (SELECT 1 FROM public.teams WHERE id = parent_id AND parent_team_id IS NOT NULL) THEN RAISE EXCEPTION 'Sub-accounts cannot have sub-accounts'; END IF;
  contact_lim := CASE _plan WHEN 'starter' THEN 5000 WHEN 'growth' THEN 25000 ELSE 1000000 END;
  seat_lim := CASE _plan WHEN 'starter' THEN 1 WHEN 'growth' THEN 3 ELSE 10 END;
  INSERT INTO public.teams (name, owner_id, plan, contact_limit, seat_limit, parent_team_id, foundation_owner_id)
    VALUES (_name, auth.uid(), _plan, contact_lim, seat_lim, parent_id, auth.uid()) RETURNING * INTO new_team;
  INSERT INTO public.team_settings (team_id) VALUES (new_team.id);
  INSERT INTO public.pipeline_stages (team_id, name, position, color) VALUES
    (new_team.id, 'Needs DM Research', -1, '#F97316'),
    (new_team.id, 'New Lead', 0, '#64748B'),(new_team.id, 'Contacted (Email)', 1, '#2563EB'),(new_team.id, 'Contacted (SMS)', 2, '#10B981'),
    (new_team.id, 'Contacted (Social)', 3, '#8B5CF6'),(new_team.id, 'Responded', 4, '#F59E0B'),(new_team.id, 'Qualified', 5, '#EF4444'),
    (new_team.id, 'Closed', 6, '#22C55E'),(new_team.id, 'Not Interested', 7, '#475569');
  RETURN new_team;
END; $function$;
