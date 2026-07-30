
CREATE TABLE public.support_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'credits',
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  admin_response TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.support_requests TO authenticated;
GRANT ALL ON public.support_requests TO service_role;

ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own support requests"
  ON public.support_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid()));

CREATE POLICY "Users create own support requests"
  ON public.support_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Super admins update support requests"
  ON public.support_requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid()));

CREATE INDEX support_requests_user_idx ON public.support_requests(user_id, created_at DESC);
CREATE INDEX support_requests_status_idx ON public.support_requests(status, created_at DESC);
