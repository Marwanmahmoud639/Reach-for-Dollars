
-- Channel credentials on team_settings
ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS whatsapp_business_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_access_token text,
  ADD COLUMN IF NOT EXISTS whatsapp_default_to text,
  ADD COLUMN IF NOT EXISTS discord_webhook_url text,
  ADD COLUMN IF NOT EXISTS discord_server_id text,
  ADD COLUMN IF NOT EXISTS discord_channel_id text,
  ADD COLUMN IF NOT EXISTS telegram_bot_token text,
  ADD COLUMN IF NOT EXISTS telegram_chat_id text;

-- Backfill notification_prefs with new structure (preserve existing slack toggle if any)
UPDATE public.team_settings
SET notification_prefs = jsonb_build_object(
  'channels', jsonb_build_object(
    'slack', COALESCE((notification_prefs->'channels'->>'slack')::boolean, (notification_prefs->>'slack')::boolean, false),
    'whatsapp', COALESCE((notification_prefs->'channels'->>'whatsapp')::boolean, false),
    'discord', COALESCE((notification_prefs->'channels'->>'discord')::boolean, false),
    'telegram', COALESCE((notification_prefs->'channels'->>'telegram')::boolean, false)
  ),
  'events', COALESCE(notification_prefs->'events', jsonb_build_object(
    'campaign_milestone', true,
    'campaign_paused', true,
    'zero_replies', true,
    'high_cost_per_lead', true,
    'campaign_complete', true,
    'workflow_executed', true,
    'list_building_complete', true,
    'login_approval', true,
    'system_alert', true
  ))
);

-- Notification retry queue
CREATE TABLE IF NOT EXISTS public.notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  channel text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_queue_due ON public.notification_queue (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_notif_queue_team ON public.notification_queue (team_id);

GRANT SELECT ON public.notification_queue TO authenticated;
GRANT ALL ON public.notification_queue TO service_role;

ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team views notification_queue"
  ON public.notification_queue FOR SELECT
  TO authenticated
  USING (team_id = public.get_user_team(auth.uid()));

CREATE POLICY "super admin notification_queue"
  ON public.notification_queue FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER trg_notif_queue_updated_at
  BEFORE UPDATE ON public.notification_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
