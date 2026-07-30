-- 1. Lock super admin to creator email
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = _user_id
      AND lower(email) = 'marawanmahmoud4488@gmail.com'
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_super_admin_creator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uemail text;
BEGIN
  SELECT lower(email) INTO uemail FROM auth.users WHERE id = NEW.user_id;
  IF uemail IS DISTINCT FROM 'marawanmahmoud4488@gmail.com' THEN
    RAISE EXCEPTION 'Super admin is locked to the platform creator only.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_super_admin_to_creator ON public.super_admins;
CREATE TRIGGER lock_super_admin_to_creator
  BEFORE INSERT OR UPDATE ON public.super_admins
  FOR EACH ROW EXECUTE FUNCTION public.enforce_super_admin_creator();

-- 2. SMS tables
CREATE TABLE public.sms_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_preview text,
  unread_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, phone_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_threads TO authenticated;
GRANT ALL ON public.sms_threads TO service_role;
ALTER TABLE public.sms_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team members manage own SMS threads" ON public.sms_threads
  FOR ALL TO authenticated
  USING (team_id = public.get_user_team(auth.uid()) OR public.is_super_admin(auth.uid()))
  WITH CHECK (team_id = public.get_user_team(auth.uid()) OR public.is_super_admin(auth.uid()));
CREATE INDEX sms_threads_team_lastmsg_idx ON public.sms_threads(team_id, last_message_at DESC);

CREATE TABLE public.sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.sms_threads(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  body text NOT NULL,
  status text,
  twilio_sid text,
  from_number text NOT NULL,
  to_number text NOT NULL,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_messages TO authenticated;
GRANT ALL ON public.sms_messages TO service_role;
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team members manage own SMS messages" ON public.sms_messages
  FOR ALL TO authenticated
  USING (team_id = public.get_user_team(auth.uid()) OR public.is_super_admin(auth.uid()))
  WITH CHECK (team_id = public.get_user_team(auth.uid()) OR public.is_super_admin(auth.uid()));
CREATE INDEX sms_messages_thread_idx ON public.sms_messages(thread_id, sent_at DESC);

CREATE TRIGGER update_sms_threads_updated_at
  BEFORE UPDATE ON public.sms_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();