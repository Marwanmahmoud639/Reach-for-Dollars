
-- 1. HIDE SUPER ADMIN FROM SUB-ACCOUNT VIEWS
-- Replace "users view team profiles" policy to exclude super admin
DROP POLICY IF EXISTS "users view team profiles" ON public.profiles;
CREATE POLICY "users view team profiles"
  ON public.profiles FOR SELECT
  USING (
    team_id = public.get_user_team(auth.uid())
    AND (
      public.is_super_admin(auth.uid())
      OR NOT public.is_super_admin(id)
    )
  );

-- user_roles: admins view team roles should hide super admin's roles
DROP POLICY IF EXISTS "admins view team roles" ON public.user_roles;
CREATE POLICY "admins view team roles"
  ON public.user_roles FOR SELECT
  USING (
    public.has_team_role(auth.uid(), team_id, 'admin'::app_role)
    AND (
      public.is_super_admin(auth.uid())
      OR NOT public.is_super_admin(user_id)
    )
  );

-- activity_log: hide entries authored by super admin from team members
DROP POLICY IF EXISTS "team views activity" ON public.activity_log;
CREATE POLICY "team views activity"
  ON public.activity_log FOR SELECT
  USING (
    team_id = public.get_user_team(auth.uid())
    AND (
      public.is_super_admin(auth.uid())
      OR user_id IS NULL
      OR NOT public.is_super_admin(user_id)
    )
  );

-- Seat counter that excludes super admin so impersonation doesn't burn a seat
CREATE OR REPLACE FUNCTION public.count_team_seats(_team_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.profiles p
  WHERE p.team_id = _team_id
    AND NOT public.is_super_admin(p.id);
$$;

GRANT EXECUTE ON FUNCTION public.count_team_seats(uuid) TO authenticated, service_role;

-- 2. FOUNDATION OWNER (per sub-account)
-- Track foundation owner on teams table
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS foundation_owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill: existing teams -> their owner_id becomes foundation_owner_id
UPDATE public.teams SET foundation_owner_id = owner_id WHERE foundation_owner_id IS NULL;

-- Helper: is caller the foundation owner of this team?
CREATE OR REPLACE FUNCTION public.is_foundation_owner(_user_id uuid, _team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teams
    WHERE id = _team_id AND foundation_owner_id = _user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_foundation_owner(uuid, uuid) TO authenticated, service_role;

-- Update create_sub_account to set foundation_owner_id = creator
CREATE OR REPLACE FUNCTION public.create_sub_account(_name text, _plan plan_tier DEFAULT 'starter'::plan_tier)
 RETURNS teams
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  parent_id uuid;
  new_team public.teams%ROWTYPE;
  contact_lim int;
  seat_lim int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT team_id INTO parent_id FROM public.profiles WHERE id = auth.uid();
  IF parent_id IS NULL THEN RAISE EXCEPTION 'No team'; END IF;
  IF NOT public.has_team_role(auth.uid(), parent_id, 'admin') AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only agency admins can create sub-accounts';
  END IF;
  IF EXISTS (SELECT 1 FROM public.teams WHERE id = parent_id AND parent_team_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Sub-accounts cannot have sub-accounts';
  END IF;

  contact_lim := CASE _plan WHEN 'starter' THEN 5000 WHEN 'growth' THEN 25000 ELSE 1000000 END;
  seat_lim := CASE _plan WHEN 'starter' THEN 1 WHEN 'growth' THEN 3 ELSE 10 END;

  INSERT INTO public.teams (name, owner_id, plan, contact_limit, seat_limit, parent_team_id, foundation_owner_id)
    VALUES (_name, auth.uid(), _plan, contact_lim, seat_lim, parent_id, auth.uid())
    RETURNING * INTO new_team;

  INSERT INTO public.team_settings (team_id) VALUES (new_team.id);

  INSERT INTO public.pipeline_stages (team_id, name, position, color) VALUES
    (new_team.id, 'New Lead', 0, '#64748B'),
    (new_team.id, 'Contacted (Email)', 1, '#2563EB'),
    (new_team.id, 'Contacted (SMS)', 2, '#10B981'),
    (new_team.id, 'Contacted (Social)', 3, '#8B5CF6'),
    (new_team.id, 'Responded', 4, '#F59E0B'),
    (new_team.id, 'Qualified', 5, '#EF4444'),
    (new_team.id, 'Closed', 6, '#22C55E'),
    (new_team.id, 'Not Interested', 7, '#475569');

  RETURN new_team;
END;
$function$;

-- Allow foundation owner to transfer ownership
CREATE OR REPLACE FUNCTION public.transfer_foundation_owner(_team_id uuid, _new_owner_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_foundation_owner(auth.uid(), _team_id) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Only the foundation owner can transfer ownership';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _new_owner_id AND team_id = _team_id) THEN
    RAISE EXCEPTION 'New owner must be a member of this team';
  END IF;
  UPDATE public.teams SET foundation_owner_id = _new_owner_id WHERE id = _team_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_foundation_owner(uuid, uuid) TO authenticated;

-- 3. PLUGGABLE DIALER PROVIDERS
DO $$ BEGIN
  CREATE TYPE public.dialer_provider AS ENUM (
    'twilio','telnyx','bandwidth','vonage','plivo','signalwire','custom_sip'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.team_dialer_providers (
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

CREATE UNIQUE INDEX IF NOT EXISTS team_dialer_one_active
  ON public.team_dialer_providers (team_id) WHERE is_active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_dialer_providers TO authenticated;
GRANT ALL ON public.team_dialer_providers TO service_role;

ALTER TABLE public.team_dialer_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "foundation owner or super admin manage providers"
  ON public.team_dialer_providers FOR ALL
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_foundation_owner(auth.uid(), team_id)
    OR public.has_team_role(auth.uid(), team_id, 'admin'::app_role)
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.is_foundation_owner(auth.uid(), team_id)
    OR public.has_team_role(auth.uid(), team_id, 'admin'::app_role)
  );

CREATE TRIGGER trg_team_dialer_providers_updated
  BEFORE UPDATE ON public.team_dialer_providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
