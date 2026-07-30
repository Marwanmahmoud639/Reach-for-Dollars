CREATE TABLE public.search_activity (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  search_id uuid NOT NULL,
  team_id uuid NOT NULL,
  step text NOT NULL,
  status text NOT NULL DEFAULT 'info',
  icon text,
  message text NOT NULL,
  count integer,
  percent integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_search_activity_search ON public.search_activity(search_id, created_at);

GRANT SELECT, INSERT ON public.search_activity TO authenticated;
GRANT ALL ON public.search_activity TO service_role;

ALTER TABLE public.search_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team views search_activity" ON public.search_activity
  FOR SELECT TO authenticated
  USING (team_id = public.get_user_team(auth.uid()));

CREATE POLICY "service inserts search_activity" ON public.search_activity
  FOR INSERT TO authenticated
  WITH CHECK (team_id = public.get_user_team(auth.uid()));

CREATE POLICY "super admin search_activity" ON public.search_activity
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.search_activity;
ALTER TABLE public.search_activity REPLICA IDENTITY FULL;