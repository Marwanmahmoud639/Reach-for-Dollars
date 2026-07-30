-- Voice agents
CREATE TABLE public.voice_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  voice_id text NOT NULL DEFAULT 'alloy',
  voice_provider text NOT NULL DEFAULT 'web_speech',
  language text NOT NULL DEFAULT 'en-US',
  script text NOT NULL DEFAULT '',
  system_prompt text NOT NULL DEFAULT 'You are a friendly, professional AI cold caller. Introduce yourself, listen carefully, and handle objections gracefully.',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  is_default boolean NOT NULL DEFAULT false,
  total_calls integer NOT NULL DEFAULT 0,
  total_connected integer NOT NULL DEFAULT 0,
  total_converted integer NOT NULL DEFAULT 0,
  avg_duration_seconds numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX voice_agents_team_idx ON public.voice_agents(team_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_agents TO authenticated;
GRANT ALL ON public.voice_agents TO service_role;
ALTER TABLE public.voice_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages voice_agents" ON public.voice_agents FOR ALL TO authenticated
  USING (team_id = public.get_user_team(auth.uid()))
  WITH CHECK (team_id = public.get_user_team(auth.uid()));
CREATE TRIGGER voice_agents_updated_at BEFORE UPDATE ON public.voice_agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Agent knowledge base
CREATE TABLE public.agent_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.voice_agents(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','pdf','doc','url')),
  storage_path text,
  content text NOT NULL DEFAULT '',
  tokens integer NOT NULL DEFAULT 0,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_knowledge_agent_idx ON public.agent_knowledge(agent_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_knowledge TO authenticated;
GRANT ALL ON public.agent_knowledge TO service_role;
ALTER TABLE public.agent_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages agent_knowledge" ON public.agent_knowledge FOR ALL TO authenticated
  USING (team_id = public.get_user_team(auth.uid()))
  WITH CHECK (team_id = public.get_user_team(auth.uid()));

-- Objections learned
CREATE TABLE public.agent_objections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.voice_agents(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  objection text NOT NULL,
  rebuttal text NOT NULL DEFAULT '',
  times_encountered integer NOT NULL DEFAULT 1,
  times_resolved integer NOT NULL DEFAULT 0,
  auto_learned boolean NOT NULL DEFAULT true,
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_objections_agent_idx ON public.agent_objections(agent_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_objections TO authenticated;
GRANT ALL ON public.agent_objections TO service_role;
ALTER TABLE public.agent_objections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages agent_objections" ON public.agent_objections FOR ALL TO authenticated
  USING (team_id = public.get_user_team(auth.uid()))
  WITH CHECK (team_id = public.get_user_team(auth.uid()));
CREATE TRIGGER agent_objections_updated_at BEFORE UPDATE ON public.agent_objections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Call runs
CREATE TABLE public.call_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.voice_agents(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  initiated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  phone_number text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','dialing','connected','completed','failed','paused','no_answer')),
  outcome text CHECK (outcome IN ('interested','not_interested','callback','voicemail','wrong_number','no_answer','converted') OR outcome IS NULL),
  duration_seconds integer NOT NULL DEFAULT 0,
  transcript text NOT NULL DEFAULT '',
  summary text,
  objections_encountered text[] NOT NULL DEFAULT '{}',
  recording_url text,
  cost_usd numeric NOT NULL DEFAULT 0,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_runs_team_created_idx ON public.call_runs(team_id, created_at DESC);
CREATE INDEX call_runs_agent_idx ON public.call_runs(agent_id, created_at DESC);
CREATE INDEX call_runs_contact_idx ON public.call_runs(contact_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_runs TO authenticated;
GRANT ALL ON public.call_runs TO service_role;
ALTER TABLE public.call_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages call_runs" ON public.call_runs FOR ALL TO authenticated
  USING (team_id = public.get_user_team(auth.uid()))
  WITH CHECK (team_id = public.get_user_team(auth.uid()));

-- Call events (timeline within a call)
CREATE TABLE public.call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_run_id uuid NOT NULL REFERENCES public.call_runs(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  role text CHECK (role IN ('agent','contact','system') OR role IS NULL),
  content text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_events_run_idx ON public.call_events(call_run_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_events TO authenticated;
GRANT ALL ON public.call_events TO service_role;
ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages call_events" ON public.call_events FOR ALL TO authenticated
  USING (team_id = public.get_user_team(auth.uid()))
  WITH CHECK (team_id = public.get_user_team(auth.uid()));

-- Training sessions (user talking to the AI to teach it)
CREATE TABLE public.training_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.voice_agents(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_seconds integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX training_sessions_agent_idx ON public.training_sessions(agent_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_sessions TO authenticated;
GRANT ALL ON public.training_sessions TO service_role;
ALTER TABLE public.training_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manages training_sessions" ON public.training_sessions FOR ALL TO authenticated
  USING (team_id = public.get_user_team(auth.uid()))
  WITH CHECK (team_id = public.get_user_team(auth.uid()));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_events;

-- Storage policies for voice-agent-knowledge bucket (bucket already created via tool).
-- Files are stored under `<team_id>/...` so authenticated users can only read/write their own team's files.
DROP POLICY IF EXISTS "team reads voice-agent-knowledge" ON storage.objects;
CREATE POLICY "team reads voice-agent-knowledge" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'voice-agent-knowledge'
    AND (storage.foldername(name))[1] = public.get_user_team(auth.uid())::text);

DROP POLICY IF EXISTS "team writes voice-agent-knowledge" ON storage.objects;
CREATE POLICY "team writes voice-agent-knowledge" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'voice-agent-knowledge'
    AND (storage.foldername(name))[1] = public.get_user_team(auth.uid())::text);

DROP POLICY IF EXISTS "team updates voice-agent-knowledge" ON storage.objects;
CREATE POLICY "team updates voice-agent-knowledge" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'voice-agent-knowledge'
    AND (storage.foldername(name))[1] = public.get_user_team(auth.uid())::text);

DROP POLICY IF EXISTS "team deletes voice-agent-knowledge" ON storage.objects;
CREATE POLICY "team deletes voice-agent-knowledge" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'voice-agent-knowledge'
    AND (storage.foldername(name))[1] = public.get_user_team(auth.uid())::text);