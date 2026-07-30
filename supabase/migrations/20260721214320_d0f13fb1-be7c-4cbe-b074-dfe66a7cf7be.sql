CREATE TABLE public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event text NOT NULL,
  path text,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  session_id text,
  user_agent text,
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_analytics_events_team_created ON public.analytics_events(team_id, created_at DESC);
CREATE INDEX idx_analytics_events_event ON public.analytics_events(event);
GRANT SELECT, INSERT ON public.analytics_events TO authenticated;
GRANT INSERT ON public.analytics_events TO anon;
GRANT ALL ON public.analytics_events TO service_role;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "insert own events" ON public.analytics_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY "insert anon events" ON public.analytics_events FOR INSERT TO anon
  WITH CHECK (user_id IS NULL);
CREATE POLICY "team members read" ON public.analytics_events FOR SELECT TO authenticated
  USING (team_id IS NOT NULL AND public.can_act_as_team(auth.uid(), team_id));
CREATE POLICY "super admin read all" ON public.analytics_events FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));