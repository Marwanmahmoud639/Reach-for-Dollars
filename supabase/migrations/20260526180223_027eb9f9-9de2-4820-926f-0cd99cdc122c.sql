-- 1. Restrict SMTP credential reads on sending_inboxes to admin/manager only
DROP POLICY IF EXISTS "team views sending_inboxes" ON public.sending_inboxes;
CREATE POLICY "admins and managers view sending_inboxes"
ON public.sending_inboxes
FOR SELECT
TO authenticated
USING (
  team_id = get_user_team(auth.uid())
  AND (has_team_role(auth.uid(), team_id, 'admin'::app_role) OR has_team_role(auth.uid(), team_id, 'manager'::app_role))
);

-- 2. Lock down user_roles INSERT to prevent privilege escalation.
-- Only allow inserting the lowest privilege role ('agent') and only for the user's own profile team.
DROP POLICY IF EXISTS "system inserts initial role" ON public.user_roles;
CREATE POLICY "users self-assign agent role on own team"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND role = 'agent'::app_role
  AND team_id = get_user_team(auth.uid())
);

-- 3. Remove login_requests from Realtime publication (contains email/IP/UA)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'login_requests'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.login_requests';
  END IF;
END $$;

-- 4. Set immutable search_path on compute_lead_score (trigger fn)
ALTER FUNCTION public.compute_lead_score() SET search_path = public;

-- 5. Tighten EXECUTE on SECURITY DEFINER admin functions to authenticated only
-- (request_login intentionally remains anon-callable for the login flow)
REVOKE EXECUTE ON FUNCTION public.approve_login_request(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deny_login_request(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_jobs(integer) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_login_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deny_login_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(integer) TO service_role;