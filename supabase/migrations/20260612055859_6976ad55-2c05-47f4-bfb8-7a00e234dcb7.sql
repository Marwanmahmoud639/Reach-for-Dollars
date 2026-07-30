
-- 1) Fix Starter Whop URL
UPDATE public.plans
SET whop_checkout_url = 'https://whop.com/checkout/plan_J2XG0wDx2IHMQ'
WHERE slug = 'starter';

-- 2) Ensure owner is in approved_emails
INSERT INTO public.approved_emails (email)
VALUES ('marawanmahmoud4488@gmail.com')
ON CONFLICT (email) DO NOTHING;

-- 3) Helper: does an auth.users row already exist for this email?
CREATE OR REPLACE FUNCTION public.email_has_account(_email text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE lower(email) = lower(_email)
  );
$$;

-- 4) Harden request_login
CREATE OR REPLACE FUNCTION public.request_login(_email text, _ip text DEFAULT NULL, _user_agent text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized text := lower(trim(_email));
  owner_email text := 'marawanmahmoud4488@gmail.com';
  block_row public.email_blocks%ROWTYPE;
  pending_id uuid;
  has_account boolean;
BEGIN
  IF normalized IS NULL OR normalized = '' OR position('@' in normalized) = 0 THEN
    RETURN jsonb_build_object('status','error','message','Invalid email');
  END IF;

  SELECT * INTO block_row FROM public.email_blocks WHERE email = normalized;
  IF FOUND AND block_row.expires_at > now() THEN
    RETURN jsonb_build_object('status','blocked',
      'message','This email is temporarily blocked. Try again later.',
      'expires_at', block_row.expires_at);
  END IF;

  has_account := public.email_has_account(normalized);

  -- Owner always allowed (even before first sign-in)
  IF normalized = owner_email THEN
    RETURN jsonb_build_object('status','auto_approved','owner', true);
  END IF;

  -- Approved + has account → fast path
  IF has_account AND EXISTS (SELECT 1 FROM public.approved_emails WHERE email = normalized) THEN
    RETURN jsonb_build_object('status','auto_approved');
  END IF;

  -- No account at all → tell the UI to stop, don't spam admins
  IF NOT has_account THEN
    RETURN jsonb_build_object('status','no_account',
      'message','No account found for this email. Finish setup at /signup if you have paid, otherwise pick a plan.');
  END IF;

  -- Account exists but not yet approved → rate limit + create pending request
  IF (SELECT count(*) FROM public.login_requests
      WHERE email = normalized AND requested_at > now() - interval '1 hour') >= 3 THEN
    RETURN jsonb_build_object('status','rate_limited','message','Too many requests. Try again in an hour.');
  END IF;

  SELECT id INTO pending_id FROM public.login_requests
    WHERE email = normalized AND status = 'pending'
    ORDER BY requested_at DESC LIMIT 1;

  IF pending_id IS NULL THEN
    INSERT INTO public.login_requests (email, ip_address, user_agent)
    VALUES (normalized, _ip, _user_agent)
    RETURNING id INTO pending_id;
  END IF;

  RETURN jsonb_build_object('status','pending','request_id', pending_id);
END;
$$;
