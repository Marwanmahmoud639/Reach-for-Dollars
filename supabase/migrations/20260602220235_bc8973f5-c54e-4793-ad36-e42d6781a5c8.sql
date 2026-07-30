
CREATE TABLE public.notifications_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_log_team_created
  ON public.notifications_log (team_id, created_at DESC);

GRANT SELECT ON public.notifications_log TO authenticated;
GRANT ALL ON public.notifications_log TO service_role;

ALTER TABLE public.notifications_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team views notifications_log"
  ON public.notifications_log
  FOR SELECT
  TO authenticated
  USING (team_id = public.get_user_team(auth.uid()));

CREATE POLICY "super admin notifications_log"
  ON public.notifications_log
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
