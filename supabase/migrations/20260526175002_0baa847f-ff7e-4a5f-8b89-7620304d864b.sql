ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS campaign_round int NOT NULL DEFAULT 1;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS parent_campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS auto_scaled_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_campaigns_parent ON public.campaigns(parent_campaign_id);