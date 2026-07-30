
CREATE OR REPLACE FUNCTION public.consume_trial_quota(_team_id uuid, _kind text, _amount integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.teams%ROWTYPE;
  u public.trial_usage%ROWTYPE;
  used integer;
  cap integer;
  remaining integer;
BEGIN
  SELECT * INTO t FROM public.teams WHERE id = _team_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team not found'; END IF;

  -- Only enforce during trial
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
$$;

GRANT EXECUTE ON FUNCTION public.consume_trial_quota(uuid, text, integer) TO authenticated, service_role;
