
-- Credits pool on teams (per-team monthly reset)
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS credits_total integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS credits_used  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_period_start timestamptz NOT NULL DEFAULT now();

-- Update plan defaults for existing rows (trial keeps 100)
UPDATE public.teams SET credits_total = 100 WHERE plan_status = 'trial' AND credits_total = 100;

-- Update plans table content per new pricing
UPDATE public.plans SET
  name = 'Starter Engine',
  price_monthly = 149,
  seats = 1,
  features = '["5,000 credits / month","1 credit = 1 discovery contact, 1 skip trace, or 1 email","Pipeline + CRM","5-channel surround sequence","1 seat","3-day free trial"]'::jsonb
WHERE slug = 'starter';

UPDATE public.plans SET
  name = 'Professional Dashboard',
  price_monthly = 499,
  seats = 3,
  features = '["15,000 credits / month","1 credit = 1 discovery contact, 1 skip trace, or 1 email","Team inbox + shared pipeline","Advanced automations","AI Voice Caller included","3 seats","3-day free trial"]'::jsonb
WHERE slug = 'professional';

UPDATE public.plans SET
  name = 'Enterprise Engine',
  price_monthly = 0,
  seats = 10,
  features = '["50,000+ credits / month (custom)","Custom pricing tailored to your volume","Unlimited sub-accounts + white-label","Dedicated success manager","Priority skip-trace waterfall + higher rate limits","SSO + custom SLA","Custom integrations & API access","Onboarding & migration support"]'::jsonb,
  whop_checkout_url = NULL
WHERE slug = 'enterprise';

-- Credit consumption RPC — soft warn at 90%, hard block at 100%
CREATE OR REPLACE FUNCTION public.consume_credits(_team_id uuid, _amount integer, _kind text DEFAULT 'generic')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.teams%ROWTYPE;
  new_used integer;
  pct numeric;
BEGIN
  IF _amount IS NULL OR _amount < 1 THEN _amount := 1; END IF;
  SELECT * INTO t FROM public.teams WHERE id = _team_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_team'); END IF;

  -- Trial expiry gate
  IF t.plan_status = 'trial' AND t.trial_ends_at IS NOT NULL AND t.trial_ends_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trial_expired', 'used', t.credits_used, 'total', t.credits_total);
  END IF;

  new_used := t.credits_used + _amount;
  IF new_used > t.credits_total THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cap_reached', 'kind', _kind,
      'used', t.credits_used, 'total', t.credits_total, 'remaining', GREATEST(0, t.credits_total - t.credits_used));
  END IF;

  UPDATE public.teams SET credits_used = new_used WHERE id = _team_id;
  pct := (new_used::numeric / NULLIF(t.credits_total,0)::numeric) * 100;

  RETURN jsonb_build_object('ok', true, 'kind', _kind, 'used', new_used, 'total', t.credits_total,
    'remaining', t.credits_total - new_used, 'warn', pct >= 90);
END;
$$;

-- Reset credits for a team (called by Whop webhook on renewal/upgrade)
CREATE OR REPLACE FUNCTION public.reset_credits(_team_id uuid, _total integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.teams
     SET credits_total = _total,
         credits_used = 0,
         credits_period_start = now()
   WHERE id = _team_id;
$$;

-- Trigger: discovery contact insert = 1 credit
CREATE OR REPLACE FUNCTION public.tg_charge_contact_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE res jsonb;
BEGIN
  IF NEW.source = 'discovery' AND NEW.team_id IS NOT NULL THEN
    res := public.consume_credits(NEW.team_id, 1, 'discovery');
    -- do not block insert if trial_expired or cap_reached; just log via updated column
    IF (res->>'ok')::boolean IS FALSE THEN
      -- leave row but mark for downstream awareness; callers should pre-check
      NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_charge_contact_credit ON public.contacts;
CREATE TRIGGER trg_charge_contact_credit
AFTER INSERT ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.tg_charge_contact_credit();

-- Trigger: skip trace phone insert = 1 credit
CREATE OR REPLACE FUNCTION public.tg_charge_phone_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE tid uuid;
BEGIN
  SELECT team_id INTO tid FROM public.contacts WHERE id = NEW.contact_id;
  IF tid IS NOT NULL THEN
    PERFORM public.consume_credits(tid, 1, 'skip_trace');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_charge_phone_credit ON public.contact_phones;
CREATE TRIGGER trg_charge_phone_credit
AFTER INSERT ON public.contact_phones
FOR EACH ROW EXECUTE FUNCTION public.tg_charge_phone_credit();

-- Trigger: email message insert = 1 credit
CREATE OR REPLACE FUNCTION public.tg_charge_email_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(coalesce(NEW.type::text, '')) IN ('email','warmup') AND NEW.team_id IS NOT NULL THEN
    PERFORM public.consume_credits(NEW.team_id, 1, lower(NEW.type::text));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_charge_email_credit ON public.messages;
CREATE TRIGGER trg_charge_email_credit
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.tg_charge_email_credit();

-- Grant execute on public RPCs to authenticated
GRANT EXECUTE ON FUNCTION public.consume_credits(uuid, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_credits(uuid, integer) TO service_role;
