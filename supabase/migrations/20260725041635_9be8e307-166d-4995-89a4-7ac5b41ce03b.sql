
ALTER TABLE public.email_accounts
  ADD COLUMN IF NOT EXISTS warmup_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS warmup_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS warmup_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS warmup_day int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warmup_target_limit int,
  ADD COLUMN IF NOT EXISTS warmup_current_limit int,
  ADD COLUMN IF NOT EXISTS warmup_flag_reason text,
  ADD COLUMN IF NOT EXISTS warmup_flag_at timestamptz,
  ADD COLUMN IF NOT EXISTS warmup_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS warmup_last_tick_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='email_accounts_warmup_status_chk') THEN
    ALTER TABLE public.email_accounts
      ADD CONSTRAINT email_accounts_warmup_status_chk
      CHECK (warmup_status IN ('idle','warming','ready','spammed','burned'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.warmup_tick()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.email_accounts%ROWTYPE;
  ramp int[] := ARRAY[5,10,20,40,60,80,100];
  next_day int;
  next_limit int;
  advanced int := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.email_accounts
    WHERE warmup_status = 'warming'
      AND (warmup_last_tick_at IS NULL OR warmup_last_tick_at < now() - interval '20 hours')
  LOOP
    next_day := LEAST(r.warmup_day + 1, 7);
    IF next_day >= 7 THEN
      UPDATE public.email_accounts
        SET warmup_status='ready',
            warmup_day=7,
            warmup_completed_at=now(),
            warmup_last_tick_at=now(),
            daily_limit = COALESCE(r.warmup_target_limit, r.daily_limit),
            warmup_current_limit = COALESCE(r.warmup_target_limit, r.daily_limit)
      WHERE id = r.id;
    ELSE
      next_limit := ramp[next_day];
      UPDATE public.email_accounts
        SET warmup_day = next_day,
            warmup_current_limit = next_limit,
            daily_limit = next_limit,
            warmup_last_tick_at = now()
      WHERE id = r.id;
    END IF;
    advanced := advanced + 1;
  END LOOP;
  RETURN advanced;
END; $$;
