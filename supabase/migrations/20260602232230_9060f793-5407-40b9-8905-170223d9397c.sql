CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop existing schedule if present so this migration is idempotent
DO $$
BEGIN
  PERFORM cron.unschedule('retry-notifications');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'retry-notifications',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--cf04a8da-2943-49b6-b855-3864ef0edc8f.lovable.app/api/public/hooks/retry-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNncWtudnFhc3pjaGxtamdqamViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDA0MTksImV4cCI6MjA5NTMxNjQxOX0.dJI60fFMhFlhGHPhEimFuVA2h5zUAXiK5wOKYkoRtC4',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);