
-- ============== LOGIN APPROVAL SYSTEM ==============

CREATE TABLE IF NOT EXISTS public.login_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  ip_address text,
  user_agent text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_login_requests_email ON public.login_requests(email);
CREATE INDEX IF NOT EXISTS idx_login_requests_status ON public.login_requests(status);
CREATE INDEX IF NOT EXISTS idx_login_requests_requested_at ON public.login_requests(requested_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.login_requests TO authenticated;
GRANT ALL ON public.login_requests TO service_role;

ALTER TABLE public.login_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super admin full access login_requests"
  ON public.login_requests FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- Public read of own pending request is not needed — login page calls a SECURITY DEFINER RPC.

CREATE TABLE IF NOT EXISTS public.approved_emails (
  email text PRIMARY KEY,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.approved_emails TO authenticated;
GRANT ALL ON public.approved_emails TO service_role;

ALTER TABLE public.approved_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super admin full access approved_emails"
  ON public.approved_emails FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.email_blocks (
  email text PRIMARY KEY,
  blocked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_blocks_expires_at ON public.email_blocks(expires_at);

GRANT SELECT ON public.email_blocks TO authenticated;
GRANT ALL ON public.email_blocks TO service_role;

ALTER TABLE public.email_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super admin full access email_blocks"
  ON public.email_blocks FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- ============== LOGIN APPROVAL RPCs ==============

CREATE OR REPLACE FUNCTION public.request_login(
  _email text,
  _ip text DEFAULT NULL,
  _user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized text := lower(trim(_email));
  block_row public.email_blocks%ROWTYPE;
  pending_id uuid;
BEGIN
  IF normalized IS NULL OR normalized = '' OR position('@' in normalized) = 0 THEN
    RETURN jsonb_build_object('status','error','message','Invalid email');
  END IF;

  -- Blocked?
  SELECT * INTO block_row FROM public.email_blocks WHERE email = normalized;
  IF FOUND AND block_row.expires_at > now() THEN
    RETURN jsonb_build_object(
      'status','blocked',
      'message','This email is temporarily blocked. Try again later.',
      'expires_at', block_row.expires_at
    );
  END IF;

  -- Already approved → fast path
  IF EXISTS (SELECT 1 FROM public.approved_emails WHERE email = normalized) THEN
    RETURN jsonb_build_object('status','auto_approved');
  END IF;

  -- Rate limit: max 3 pending requests per hour per email
  IF (SELECT count(*) FROM public.login_requests
      WHERE email = normalized
        AND requested_at > now() - interval '1 hour') >= 3 THEN
    RETURN jsonb_build_object('status','rate_limited','message','Too many requests. Try again in an hour.');
  END IF;

  -- Reuse an existing pending row if one exists, else insert
  SELECT id INTO pending_id FROM public.login_requests
    WHERE email = normalized AND status = 'pending'
    ORDER BY requested_at DESC LIMIT 1;

  IF pending_id IS NULL THEN
    INSERT INTO public.login_requests (email, ip_address, user_agent)
    VALUES (normalized, _ip, _user_agent)
    RETURNING id INTO pending_id;
  END IF;

  RETURN jsonb_build_object('status','pending','request_id', pending_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_login(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_login_request(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.login_requests%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO req FROM public.login_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;

  UPDATE public.login_requests
    SET status = 'approved', decided_at = now(), decided_by = auth.uid()
    WHERE id = _request_id;

  INSERT INTO public.approved_emails (email, approved_by)
    VALUES (req.email, auth.uid())
    ON CONFLICT (email) DO NOTHING;

  -- Clear any active block
  DELETE FROM public.email_blocks WHERE email = req.email;

  RETURN jsonb_build_object('status','approved','email', req.email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_login_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.deny_login_request(_request_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.login_requests%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO req FROM public.login_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;

  UPDATE public.login_requests
    SET status = 'denied', decided_at = now(), decided_by = auth.uid()
    WHERE id = _request_id;

  INSERT INTO public.email_blocks (email, blocked_by, reason, expires_at)
    VALUES (req.email, auth.uid(), _reason, now() + interval '24 hours')
    ON CONFLICT (email) DO UPDATE SET
      blocked_by = EXCLUDED.blocked_by,
      reason = EXCLUDED.reason,
      expires_at = EXCLUDED.expires_at;

  RETURN jsonb_build_object('status','denied','email', req.email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.deny_login_request(uuid, text) TO authenticated;

-- Realtime for super-admin live view
ALTER PUBLICATION supabase_realtime ADD TABLE public.login_requests;

-- ============== CONTACT NOTES ==============

CREATE TABLE IF NOT EXISTS public.contact_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_notes_contact_id ON public.contact_notes(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_notes_team_id ON public.contact_notes(team_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_notes TO authenticated;
GRANT ALL ON public.contact_notes TO service_role;

ALTER TABLE public.contact_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team views contact_notes"
  ON public.contact_notes FOR SELECT TO authenticated
  USING (team_id = public.get_user_team(auth.uid()));

CREATE POLICY "team inserts contact_notes"
  ON public.contact_notes FOR INSERT TO authenticated
  WITH CHECK (team_id = public.get_user_team(auth.uid()) AND user_id = auth.uid());

CREATE POLICY "author or admin updates contact_notes"
  ON public.contact_notes FOR UPDATE TO authenticated
  USING (team_id = public.get_user_team(auth.uid()) AND
         (user_id = auth.uid()
          OR public.has_team_role(auth.uid(), team_id, 'admin')
          OR public.has_team_role(auth.uid(), team_id, 'manager')));

CREATE POLICY "author or admin deletes contact_notes"
  ON public.contact_notes FOR DELETE TO authenticated
  USING (team_id = public.get_user_team(auth.uid()) AND
         (user_id = auth.uid()
          OR public.has_team_role(auth.uid(), team_id, 'admin')
          OR public.has_team_role(auth.uid(), team_id, 'manager')));

CREATE POLICY "super admin full access contact_notes"
  ON public.contact_notes FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER update_contact_notes_updated_at
  BEFORE UPDATE ON public.contact_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_notes;

-- ============== CALL HISTORY ==============

CREATE TABLE IF NOT EXISTS public.call_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('outbound','inbound')),
  duration_seconds int,
  call_status text,
  recording_url text,
  transcription text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_history_contact_id ON public.call_history(contact_id);
CREATE INDEX IF NOT EXISTS idx_call_history_team_id ON public.call_history(team_id);
CREATE INDEX IF NOT EXISTS idx_call_history_created_at ON public.call_history(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_history TO authenticated;
GRANT ALL ON public.call_history TO service_role;

ALTER TABLE public.call_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team views call_history"
  ON public.call_history FOR SELECT TO authenticated
  USING (team_id = public.get_user_team(auth.uid()));

CREATE POLICY "team inserts call_history"
  ON public.call_history FOR INSERT TO authenticated
  WITH CHECK (team_id = public.get_user_team(auth.uid()) AND user_id = auth.uid());

CREATE POLICY "user or admin updates call_history"
  ON public.call_history FOR UPDATE TO authenticated
  USING (team_id = public.get_user_team(auth.uid()) AND
         (user_id = auth.uid()
          OR public.has_team_role(auth.uid(), team_id, 'admin')));

CREATE POLICY "user or admin deletes call_history"
  ON public.call_history FOR DELETE TO authenticated
  USING (team_id = public.get_user_team(auth.uid()) AND
         (user_id = auth.uid()
          OR public.has_team_role(auth.uid(), team_id, 'admin')));

CREATE POLICY "super admin full access call_history"
  ON public.call_history FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- ============== EXTENDED CONTACT FIELDS ==============

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS deal_value numeric;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS next_followup_at timestamptz;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS contact_frequency text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS priority text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS custom_field_1 text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS custom_field_2 text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS custom_field_3 text;
