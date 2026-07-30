-- Drop old single-arg claim_jobs and replace with type-filtered version
DROP FUNCTION IF EXISTS public.claim_jobs(integer);

CREATE OR REPLACE FUNCTION public.claim_jobs(_job_types text[] DEFAULT NULL, _limit integer DEFAULT 5)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  return query
  update public.job_queue jq
  set status = 'running', locked_at = now(), attempts = attempts + 1
  where jq.id in (
    select id from public.job_queue
    where status in ('pending','retry')
      and scheduled_for <= now()
      and (_job_types is null or job_type = any(_job_types))
    order by priority asc, scheduled_for asc
    limit _limit
    for update skip locked
  )
  returning *;
end;
$function$;

-- Recover any rows orphaned in 'running' for >10 minutes
UPDATE public.job_queue
SET status = 'pending', locked_at = NULL, attempts = GREATEST(0, attempts - 1)
WHERE status = 'running' AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes');