
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS white_label_secondary_color text,
  ADD COLUMN IF NOT EXISTS subdomain text;

CREATE UNIQUE INDEX IF NOT EXISTS teams_subdomain_unique ON public.teams (lower(subdomain)) WHERE subdomain IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.subdomain_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  subdomain text NOT NULL CHECK (subdomain ~ '^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  denial_reason text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subdomain_requests_approved_unique
  ON public.subdomain_requests (lower(subdomain)) WHERE status = 'approved';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subdomain_requests TO authenticated;
GRANT ALL ON public.subdomain_requests TO service_role;

ALTER TABLE public.subdomain_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team views own subdomain requests"
  ON public.subdomain_requests FOR SELECT TO authenticated
  USING (team_id = get_user_team(auth.uid()) OR is_super_admin(auth.uid()));

CREATE POLICY "team admin inserts subdomain requests"
  ON public.subdomain_requests FOR INSERT TO authenticated
  WITH CHECK (
    team_id = get_user_team(auth.uid())
    AND has_team_role(auth.uid(), team_id, 'admin'::app_role)
    AND requested_by = auth.uid()
  );

CREATE POLICY "super admin full access subdomain_requests"
  ON public.subdomain_requests FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_subdomain_requests_updated_at ON public.subdomain_requests;
CREATE TRIGGER update_subdomain_requests_updated_at
  BEFORE UPDATE ON public.subdomain_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
