-- 1. parent_team_id on teams
ALTER TABLE public.teams ADD COLUMN parent_team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE;
CREATE INDEX idx_teams_parent_team_id ON public.teams(parent_team_id);

-- 2. active_team_session
CREATE TABLE public.active_team_session (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  acting_team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  set_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.active_team_session TO authenticated;
GRANT ALL ON public.active_team_session TO service_role;
ALTER TABLE public.active_team_session ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self manage active team" ON public.active_team_session
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "super admin full access ats" ON public.active_team_session
  FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- 3. update get_user_team to consider active session
CREATE OR REPLACE FUNCTION public.get_user_team(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT acting_team_id FROM public.active_team_session WHERE user_id = _user_id),
    (SELECT team_id FROM public.profiles WHERE id = _user_id LIMIT 1)
  );
$$;

-- 4. helpers
CREATE OR REPLACE FUNCTION public.is_parent_admin(_user_id uuid, _child_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.teams t
    JOIN public.user_roles ur ON ur.team_id = t.parent_team_id AND ur.user_id = _user_id AND ur.role = 'admin'
    WHERE t.id = _child_team_id AND t.parent_team_id IS NOT NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.can_act_as_team(_user_id uuid, _team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id)
      OR public.is_team_member(_user_id, _team_id)
      OR public.is_parent_admin(_user_id, _team_id);
$$;

-- 5. switch_team RPC
CREATE OR REPLACE FUNCTION public.switch_team(_team_id uuid)
RETURNS public.teams LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.teams%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_act_as_team(auth.uid(), _team_id) THEN
    RAISE EXCEPTION 'Not authorized to act as this team';
  END IF;
  INSERT INTO public.active_team_session (user_id, acting_team_id)
    VALUES (auth.uid(), _team_id)
    ON CONFLICT (user_id) DO UPDATE SET acting_team_id = EXCLUDED.acting_team_id, set_at = now();
  SELECT * INTO t FROM public.teams WHERE id = _team_id;

  -- audit super-admin impersonation
  IF public.is_super_admin(auth.uid()) AND NOT public.is_team_member(auth.uid(), _team_id) THEN
    INSERT INTO public.activity_log (team_id, user_id, action, note)
      VALUES (_team_id, auth.uid(), 'super_admin_impersonate', 'Switched into team');
  END IF;

  RETURN t;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_team_switch()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.active_team_session WHERE user_id = auth.uid();
$$;

-- 6. create_sub_account RPC (parent-admin only)
CREATE OR REPLACE FUNCTION public.create_sub_account(_name text, _plan plan_tier DEFAULT 'starter'::plan_tier)
RETURNS public.teams LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  parent_id uuid;
  new_team public.teams%ROWTYPE;
  contact_lim int;
  seat_lim int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- caller's HOME team (ignore active session — sub-accounts hang off home team)
  SELECT team_id INTO parent_id FROM public.profiles WHERE id = auth.uid();
  IF parent_id IS NULL THEN RAISE EXCEPTION 'No team'; END IF;
  IF NOT public.has_team_role(auth.uid(), parent_id, 'admin') AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only agency admins can create sub-accounts';
  END IF;
  -- parent must itself be a top-level team (no nested agencies)
  IF EXISTS (SELECT 1 FROM public.teams WHERE id = parent_id AND parent_team_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Sub-accounts cannot have sub-accounts';
  END IF;

  contact_lim := CASE _plan WHEN 'starter' THEN 5000 WHEN 'growth' THEN 25000 ELSE 1000000 END;
  seat_lim := CASE _plan WHEN 'starter' THEN 1 WHEN 'growth' THEN 3 ELSE 10 END;

  INSERT INTO public.teams (name, owner_id, plan, contact_limit, seat_limit, parent_team_id)
    VALUES (_name, auth.uid(), _plan, contact_lim, seat_lim, parent_id)
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
$$;

-- 7. allow parent admins to read child team rows + view child team metadata
DROP POLICY IF EXISTS "parent admin views child teams" ON public.teams;
CREATE POLICY "parent admin views child teams" ON public.teams
  FOR SELECT TO authenticated
  USING (
    parent_team_id IS NOT NULL
    AND public.has_team_role(auth.uid(), parent_team_id, 'admin')
  );

-- 8. drop unused placeholder
DROP TABLE IF EXISTS public.sub_accounts;

-- 9. grant execute on new RPCs
GRANT EXECUTE ON FUNCTION public.switch_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_team_switch() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sub_account(text, plan_tier) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_act_as_team(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_parent_admin(uuid, uuid) TO authenticated;