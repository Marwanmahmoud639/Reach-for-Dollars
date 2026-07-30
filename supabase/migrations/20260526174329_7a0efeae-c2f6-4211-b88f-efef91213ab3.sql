ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email_verified_by_ai boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_ai_confidence integer,
  ADD COLUMN IF NOT EXISTS email_ai_reason text,
  ADD COLUMN IF NOT EXISTS icp_fit_score integer,
  ADD COLUMN IF NOT EXISTS icp_fit_reason text,
  ADD COLUMN IF NOT EXISTS icp_matches boolean,
  ADD COLUMN IF NOT EXISTS ai_verified_at timestamptz;

ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS claude_api_key text,
  ADD COLUMN IF NOT EXISTS icp_definition text;

CREATE INDEX IF NOT EXISTS idx_contacts_icp_fit_score ON public.contacts(team_id, icp_fit_score DESC NULLS LAST);