CREATE TABLE public.csv_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  total_rows int NOT NULL DEFAULT 0,
  imported_rows int NOT NULL DEFAULT 0,
  skipped_rows int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  error_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.csv_import_jobs TO authenticated;
GRANT ALL ON public.csv_import_jobs TO service_role;

ALTER TABLE public.csv_import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team views csv_import_jobs" ON public.csv_import_jobs
  FOR SELECT TO authenticated
  USING (team_id = get_user_team(auth.uid()));

CREATE POLICY "team inserts csv_import_jobs" ON public.csv_import_jobs
  FOR INSERT TO authenticated
  WITH CHECK (team_id = get_user_team(auth.uid()) AND user_id = auth.uid());

CREATE POLICY "team updates csv_import_jobs" ON public.csv_import_jobs
  FOR UPDATE TO authenticated
  USING (team_id = get_user_team(auth.uid()));

CREATE POLICY "super admin csv_import_jobs" ON public.csv_import_jobs
  FOR ALL TO authenticated
  USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

CREATE TRIGGER update_csv_import_jobs_updated_at
  BEFORE UPDATE ON public.csv_import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_csv_import_jobs_team_created ON public.csv_import_jobs(team_id, created_at DESC);