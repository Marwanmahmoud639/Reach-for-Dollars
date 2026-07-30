
CREATE OR REPLACE FUNCTION public.team_owner_is_super_admin(_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teams t
    JOIN public.super_admins sa ON sa.user_id = t.owner_id
    WHERE t.id = _team_id
  ) OR EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.super_admins sa ON sa.user_id = p.id
    WHERE p.team_id = _team_id
  );
$$;

CREATE OR REPLACE FUNCTION public.consume_credits(_team_id uuid, _amount integer, _kind text DEFAULT 'generic'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.teams%ROWTYPE;
  new_used integer;
  pct numeric;
BEGIN
  IF _amount IS NULL OR _amount < 1 THEN _amount := 1; END IF;

  -- Super admin bypass: unlimited, uncounted
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
  pct := (new_used::numeric / NULLIF(t.credits_total,0)::numeric) * 100;

  RETURN jsonb_build_object('ok', true, 'kind', _kind, 'used', new_used, 'total', t.credits_total,
    'remaining', t.credits_total - new_used, 'warn', pct >= 90);
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_trial_quota(_team_id uuid, _kind text, _amount integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.teams%ROWTYPE;
  u public.trial_usage%ROWTYPE;
  used integer;
  cap integer;
  remaining integer;
BEGIN
  -- Super admin bypass: never enforced
  IF public.team_owner_is_super_admin(_team_id) THEN
    RETURN jsonb_build_object('ok', true, 'enforced', false, 'super_admin', true);
  END IF;

  SELECT * INTO t FROM public.teams WHERE id = _team_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team not found'; END IF;

  IF t.plan_status <> 'trial' THEN
    RETURN jsonb_build_object('ok', true, 'enforced', false);
  END IF;

  IF t.trial_ends_at IS NOT NULL AND t.trial_ends_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trial_expired');
  END IF;

  INSERT INTO public.trial_usage (team_id) VALUES (_team_id) ON CONFLICT (team_id) DO NOTHING;
  SELECT * INTO u FROM public.trial_usage WHERE team_id = _team_id FOR UPDATE;

  IF _kind = 'discovery' THEN
    used := u.discovery_used; cap := t.trial_discovery_limit;
  ELSIF _kind = 'message' THEN
    used := u.messages_used;  cap := t.trial_message_limit;
  ELSIF _kind = 'pipeline' THEN
    used := u.pipeline_used;  cap := t.trial_pipeline_limit;
  ELSE
    RAISE EXCEPTION 'Unknown quota kind: %', _kind;
  END IF;

  IF used + _amount > cap THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cap_reached', 'kind', _kind, 'used', used, 'cap', cap);
  END IF;

  IF _kind = 'discovery' THEN
    UPDATE public.trial_usage SET discovery_used = discovery_used + _amount WHERE team_id = _team_id;
  ELSIF _kind = 'message' THEN
    UPDATE public.trial_usage SET messages_used = messages_used + _amount WHERE team_id = _team_id;
  ELSIF _kind = 'pipeline' THEN
    UPDATE public.trial_usage SET pipeline_used = pipeline_used + _amount WHERE team_id = _team_id;
  END IF;

  remaining := cap - (used + _amount);
  RETURN jsonb_build_object('ok', true, 'enforced', true, 'kind', _kind, 'used', used + _amount, 'cap', cap, 'remaining', remaining);
END;
$function$;
