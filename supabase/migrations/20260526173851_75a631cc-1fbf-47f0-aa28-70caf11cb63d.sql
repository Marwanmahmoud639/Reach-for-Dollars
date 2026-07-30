ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS n8n_webhook_url text,
  ADD COLUMN IF NOT EXISTS make_webhook_url text;