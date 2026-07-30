
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS pause_reason text,
  ADD COLUMN IF NOT EXISTS cost_per_lead_threshold numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS total_cost numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.campaign_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  total_contacts integer NOT NULL DEFAULT 0,
  total_sent integer NOT NULL DEFAULT 0,
  total_delivered integer NOT NULL DEFAULT 0,
  total_bounced integer NOT NULL DEFAULT 0,
  total_opened integer NOT NULL DEFAULT 0,
  total_replied integer NOT NULL DEFAULT 0,
  leads_generated integer NOT NULL DEFAULT 0,
  bounce_rate numeric NOT NULL DEFAULT 0,
  reply_rate numeric NOT NULL DEFAULT 0,
  cost_per_lead numeric NOT NULL DEFAULT 0,
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id)
);

GRANT SELECT ON public.campaign_metrics TO authenticated;
GRANT ALL ON public.campaign_metrics TO service_role;

ALTER TABLE public.campaign_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team views campaign_metrics"
  ON public.campaign_metrics FOR SELECT
  TO authenticated
  USING (team_id = public.get_user_team(auth.uid()));

CREATE POLICY "super admin full access campaign_metrics"
  ON public.campaign_metrics FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER update_campaign_metrics_updated_at
  BEFORE UPDATE ON public.campaign_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_campaign_metrics_team ON public.campaign_metrics(team_id);
