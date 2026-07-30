
-- Add Trestle key column for completeness
ALTER TABLE public.team_settings ADD COLUMN IF NOT EXISTS trestle_api_key text;
ALTER TABLE public.team_settings ADD COLUMN IF NOT EXISTS serper_api_key text;

-- Snapshot of paid-API credit balances for the credits dashboard + safe-spend guard
CREATE TABLE IF NOT EXISTS public.api_credit_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  provider text NOT NULL,
  balance numeric,
  balance_unit text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_credit_snapshots_team_provider
  ON public.api_credit_snapshots (team_id, provider, fetched_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_credit_snapshots TO authenticated;
GRANT ALL ON public.api_credit_snapshots TO service_role;

ALTER TABLE public.api_credit_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team views credit snapshots"
  ON public.api_credit_snapshots FOR SELECT TO authenticated
  USING (team_id = public.get_user_team(auth.uid()));

CREATE POLICY "admins manage credit snapshots"
  ON public.api_credit_snapshots FOR ALL TO authenticated
  USING (public.has_team_role(auth.uid(), team_id, 'admin'::app_role))
  WITH CHECK (public.has_team_role(auth.uid(), team_id, 'admin'::app_role));

CREATE POLICY "super admin full access snapshots"
  ON public.api_credit_snapshots FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
