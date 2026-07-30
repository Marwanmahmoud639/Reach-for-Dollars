
ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_run_stats jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  team_id uuid NOT NULL,
  triggered_by uuid,
  trigger_source text NOT NULL DEFAULT 'manual' CHECK (trigger_source IN ('manual','auto','scheduled','webhook')),
  contacts_matched integer NOT NULL DEFAULT 0,
  contacts_processed integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','errored')),
  error_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_runs TO authenticated;
GRANT ALL ON public.workflow_runs TO service_role;

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team views workflow_runs" ON public.workflow_runs
  FOR SELECT TO authenticated
  USING (team_id = get_user_team(auth.uid()));

CREATE POLICY "team inserts workflow_runs" ON public.workflow_runs
  FOR INSERT TO authenticated
  WITH CHECK (team_id = get_user_team(auth.uid()));

CREATE POLICY "non-agents manage workflow_runs" ON public.workflow_runs
  FOR ALL TO authenticated
  USING (team_id = get_user_team(auth.uid()) AND (has_team_role(auth.uid(), team_id, 'admin'::app_role) OR has_team_role(auth.uid(), team_id, 'manager'::app_role)))
  WITH CHECK (team_id = get_user_team(auth.uid()) AND (has_team_role(auth.uid(), team_id, 'admin'::app_role) OR has_team_role(auth.uid(), team_id, 'manager'::app_role)));

CREATE POLICY "super admin workflow_runs" ON public.workflow_runs
  FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_started ON public.workflow_runs(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_team ON public.workflow_runs(team_id);
