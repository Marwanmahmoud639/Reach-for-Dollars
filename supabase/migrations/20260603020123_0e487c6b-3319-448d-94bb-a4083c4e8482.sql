-- Add auto-purge column for discovery-sourced contacts (90-day retention)
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS auto_purge_at timestamptz;

-- Backfill existing discovery contacts so they also expire 90 days from now
UPDATE public.contacts
SET auto_purge_at = now() + interval '90 days'
WHERE source = 'discovery' AND auto_purge_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_auto_purge_at
  ON public.contacts (auto_purge_at)
  WHERE source = 'discovery';

-- Duplicates tracking on searches
ALTER TABLE public.searches
  ADD COLUMN IF NOT EXISTS duplicates jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS duplicates_count integer NOT NULL DEFAULT 0;

-- Purge function: only remove discovery leads the user never touched
CREATE OR REPLACE FUNCTION public.purge_expired_discovery_contacts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH del AS (
    DELETE FROM public.contacts
    WHERE source = 'discovery'
      AND auto_purge_at IS NOT NULL
      AND auto_purge_at < now()
      AND assigned_to IS NULL
      AND last_contacted_at IS NULL
      AND do_not_contact = false
    RETURNING id
  )
  SELECT count(*) INTO deleted_count FROM del;
  RETURN deleted_count;
END;
$$;

-- Schedule daily purge at 03:00 UTC
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-discovery-contacts') THEN
    PERFORM cron.unschedule('purge-discovery-contacts');
  END IF;
  PERFORM cron.schedule(
    'purge-discovery-contacts',
    '0 3 * * *',
    $cron$ SELECT public.purge_expired_discovery_contacts(); $cron$
  );
END $$;