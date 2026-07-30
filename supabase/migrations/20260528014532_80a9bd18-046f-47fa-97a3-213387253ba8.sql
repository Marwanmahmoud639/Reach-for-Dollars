ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS lusha_api_key text,
  ADD COLUMN IF NOT EXISTS firecrawl_api_key text;