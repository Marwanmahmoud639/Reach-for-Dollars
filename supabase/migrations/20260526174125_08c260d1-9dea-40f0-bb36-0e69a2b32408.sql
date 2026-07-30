ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS clay_key text,
  ADD COLUMN IF NOT EXISTS ai_ark_key text,
  ADD COLUMN IF NOT EXISTS ai_ark_endpoint text,
  ADD COLUMN IF NOT EXISTS apify_key text,
  ADD COLUMN IF NOT EXISTS apify_actor_id text;