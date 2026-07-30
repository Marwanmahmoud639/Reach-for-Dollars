ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;
CREATE INDEX IF NOT EXISTS contacts_team_latlng_idx ON public.contacts(team_id) WHERE lat IS NOT NULL AND lng IS NOT NULL;