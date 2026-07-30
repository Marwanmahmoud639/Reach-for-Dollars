
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS ai_provider text NOT NULL DEFAULT 'lovable',
  ADD COLUMN IF NOT EXISTS auto_pipeline_threshold int NOT NULL DEFAULT 70;

ALTER TABLE public.follow_up_sequences
  ADD COLUMN IF NOT EXISTS open_aware boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS message_if_opened text,
  ADD COLUMN IF NOT EXISTS message_if_not_opened text;

CREATE TABLE IF NOT EXISTS public.ai_personalization_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  variant text NOT NULL DEFAULT 'initial',
  status text NOT NULL DEFAULT 'pending',
  ai_provider text,
  generated_message text,
  edited_message text,
  approved_by uuid,
  approved_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id, variant)
);

CREATE INDEX IF NOT EXISTS ai_pj_campaign_idx ON public.ai_personalization_jobs(campaign_id);
CREATE INDEX IF NOT EXISTS ai_pj_team_idx ON public.ai_personalization_jobs(team_id);

ALTER TABLE public.ai_personalization_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team views ai jobs" ON public.ai_personalization_jobs;
CREATE POLICY "team views ai jobs"
  ON public.ai_personalization_jobs FOR SELECT
  USING (team_id = public.get_user_team(auth.uid()));

DROP POLICY IF EXISTS "non-agents manage ai jobs" ON public.ai_personalization_jobs;
CREATE POLICY "non-agents manage ai jobs"
  ON public.ai_personalization_jobs FOR ALL
  USING (team_id = public.get_user_team(auth.uid())
    AND (public.has_team_role(auth.uid(), team_id, 'admin'::app_role)
      OR public.has_team_role(auth.uid(), team_id, 'manager'::app_role)))
  WITH CHECK (team_id = public.get_user_team(auth.uid())
    AND (public.has_team_role(auth.uid(), team_id, 'admin'::app_role)
      OR public.has_team_role(auth.uid(), team_id, 'manager'::app_role)));

DROP TRIGGER IF EXISTS ai_pj_updated_at ON public.ai_personalization_jobs;
CREATE TRIGGER ai_pj_updated_at
  BEFORE UPDATE ON public.ai_personalization_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
