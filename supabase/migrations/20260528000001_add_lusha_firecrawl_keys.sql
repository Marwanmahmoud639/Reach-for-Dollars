-- Add Lusha and Firecrawl API keys to team_settings
-- Lusha: paid email + phone enrichment (fallback after Hunter free tier)
-- Firecrawl: free web scraping for business discovery (runs first in pipeline)
ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS lusha_api_key text,
  ADD COLUMN IF NOT EXISTS firecrawl_api_key text;
