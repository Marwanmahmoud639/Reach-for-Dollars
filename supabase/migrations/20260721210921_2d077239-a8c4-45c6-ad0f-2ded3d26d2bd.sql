CREATE OR REPLACE FUNCTION public.is_parent_admin(_user_id uuid, _child_team_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.teams t JOIN public.user_roles ur ON ur.team_id = t.parent_team_id AND ur.user_id = _user_id AND ur.role = 'admin' WHERE t.id = _child_team_id AND t.parent_team_id IS NOT NULL);
$$;
CREATE OR REPLACE FUNCTION public.can_act_as_team(_user_id uuid, _team_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id) OR public.is_team_member(_user_id, _team_id) OR public.is_parent_admin(_user_id, _team_id);
$$;
CREATE OR REPLACE FUNCTION public.is_foundation_owner(_user_id uuid, _team_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.teams WHERE id = _team_id AND foundation_owner_id = _user_id);
$$;
CREATE OR REPLACE FUNCTION public.count_team_seats(_team_id uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::int FROM public.profiles p WHERE p.team_id = _team_id AND NOT public.is_super_admin(p.id);
$$;
CREATE OR REPLACE FUNCTION public.email_has_account(_email text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(_email));
$$;

CREATE OR REPLACE FUNCTION public.switch_team(_team_id uuid) RETURNS public.teams LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.teams%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_act_as_team(auth.uid(), _team_id) THEN RAISE EXCEPTION 'Not authorized to act as this team'; END IF;
  INSERT INTO public.active_team_session (user_id, acting_team_id) VALUES (auth.uid(), _team_id) ON CONFLICT (user_id) DO UPDATE SET acting_team_id = EXCLUDED.acting_team_id, set_at = now();
  SELECT * INTO t FROM public.teams WHERE id = _team_id;
  RETURN t;
END; $$;

CREATE OR REPLACE FUNCTION public.clear_team_switch() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.active_team_session WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.create_sub_account(_name text, _plan plan_tier DEFAULT 'starter'::plan_tier) RETURNS public.teams LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    (new_team.id, 'New Lead', 0, '#64748B'),(new_team.id, 'Contacted (Email)', 1, '#2563EB'),(new_team.id, 'Contacted (SMS)', 2, '#10B981'),
    (new_team.id, 'Contacted (Social)', 3, '#8B5CF6'),(new_team.id, 'Responded', 4, '#F59E0B'),(new_team.id, 'Qualified', 5, '#EF4444'),
    (new_team.id, 'Closed', 6, '#22C55E'),(new_team.id, 'Not Interested', 7, '#475569');
  RETURN new_team;
END; $$;

CREATE OR REPLACE FUNCTION public.transfer_foundation_owner(_team_id uuid, _new_owner_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.is_foundation_owner(auth.uid(), _team_id) OR public.is_super_admin(auth.uid())) THEN RAISE EXCEPTION 'Only the foundation owner can transfer ownership'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _new_owner_id AND team_id = _team_id) THEN RAISE EXCEPTION 'New owner must be a member of this team'; END IF;
  UPDATE public.teams SET foundation_owner_id = _new_owner_id WHERE id = _team_id;
END; $$;

CREATE OR REPLACE FUNCTION public.request_login(_email text, _ip text DEFAULT NULL, _user_agent text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  normalized text := lower(trim(_email));
  block_row public.email_blocks%ROWTYPE;
  pending_id uuid;
  has_account boolean;
BEGIN
  IF normalized IS NULL OR normalized = '' OR position('@' in normalized) = 0 THEN RETURN jsonb_build_object('status','error','message','Invalid email'); END IF;
  SELECT * INTO block_row FROM public.email_blocks WHERE email = normalized;
  IF FOUND AND block_row.expires_at > now() THEN RETURN jsonb_build_object('status','blocked','message','This email is temporarily blocked. Try again later.','expires_at', block_row.expires_at); END IF;
  has_account := public.email_has_account(normalized);
  IF has_account AND EXISTS (SELECT 1 FROM public.approved_emails WHERE email = normalized) THEN RETURN jsonb_build_object('status','auto_approved'); END IF;
  IF NOT has_account THEN RETURN jsonb_build_object('status','no_account','message','No account found for this email.'); END IF;
  IF (SELECT count(*) FROM public.login_requests WHERE email = normalized AND requested_at > now() - interval '1 hour') >= 3 THEN RETURN jsonb_build_object('status','rate_limited','message','Too many requests. Try again in an hour.'); END IF;
  SELECT id INTO pending_id FROM public.login_requests WHERE email = normalized AND status = 'pending' ORDER BY requested_at DESC LIMIT 1;
  IF pending_id IS NULL THEN INSERT INTO public.login_requests (email, ip_address, user_agent) VALUES (normalized, _ip, _user_agent) RETURNING id INTO pending_id; END IF;
  RETURN jsonb_build_object('status','pending','request_id', pending_id);
END; $$;

CREATE OR REPLACE FUNCTION public.approve_login_request(_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE req public.login_requests%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO req FROM public.login_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  UPDATE public.login_requests SET status = 'approved', decided_at = now(), decided_by = auth.uid() WHERE id = _request_id;
  INSERT INTO public.approved_emails (email, approved_by) VALUES (req.email, auth.uid()) ON CONFLICT (email) DO NOTHING;
  DELETE FROM public.email_blocks WHERE email = req.email;
  RETURN jsonb_build_object('status','approved','email', req.email);
END; $$;

CREATE OR REPLACE FUNCTION public.deny_login_request(_request_id uuid, _reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE req public.login_requests%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO req FROM public.login_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  UPDATE public.login_requests SET status = 'denied', decided_at = now(), decided_by = auth.uid() WHERE id = _request_id;
  INSERT INTO public.email_blocks (email, blocked_by, reason, expires_at) VALUES (req.email, auth.uid(), _reason, now() + interval '24 hours')
    ON CONFLICT (email) DO UPDATE SET blocked_by = EXCLUDED.blocked_by, reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at;
  RETURN jsonb_build_object('status','denied','email', req.email);
END; $$;

CREATE OR REPLACE FUNCTION public.reserve_email_account(p_team_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.email_accounts SET sent_today = 0, last_sent_date = current_date WHERE team_id = p_team_id AND (last_sent_date IS NULL OR last_sent_date < current_date);
  SELECT id INTO v_id FROM public.email_accounts WHERE team_id = p_team_id AND is_active = true AND sent_today < daily_limit ORDER BY sent_today ASC, last_sent_date ASC NULLS FIRST, created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.email_accounts SET sent_today = sent_today + 1, last_sent_date = current_date WHERE id = v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.purge_expired_discovery_contacts() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE deleted_count integer;
BEGIN
  WITH del AS (DELETE FROM public.contacts WHERE source = 'discovery' AND auto_purge_at IS NOT NULL AND auto_purge_at < now() AND assigned_to IS NULL AND last_contacted_at IS NULL AND do_not_contact = false RETURNING id)
  SELECT count(*) INTO deleted_count FROM del;
  RETURN deleted_count;
END; $$;

GRANT EXECUTE ON FUNCTION public.switch_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_team_switch() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sub_account(text, plan_tier) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_act_as_team(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_parent_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_foundation_owner(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_foundation_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_team_seats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_login(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_login_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deny_login_request(uuid, text) TO authenticated;