
ALTER TABLE public.signups
  ADD COLUMN IF NOT EXISTS access_code text,
  ADD COLUMN IF NOT EXISTS access_code_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_code_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS whop_payment_id text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid;

CREATE UNIQUE INDEX IF NOT EXISTS signups_access_code_unique ON public.signups(access_code) WHERE access_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS signups_email_idx ON public.signups (lower(email));
CREATE INDEX IF NOT EXISTS signups_status_idx ON public.signups (status);

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS whop_checkout_url text;

UPDATE public.plans SET is_active = false WHERE slug IN ('growth','agency');

INSERT INTO public.plans (slug, name, price_monthly, seats, features, sort_order, is_active, whop_checkout_url)
VALUES
  ('starter', 'Starter Engine', 149, 1,
    '["1,500 decision-maker contacts / mo","5-channel surround sequence","Email + SMS + DM + Call + RVM","Verified mobile + personal email","1 seat","Pipeline + CRM included"]'::jsonb,
    1, true, 'https://whop.com/checkout/plan_J2XG0wDxz2IHMQ'),
  ('professional', 'Professional Engine', 499, 3,
    '["6,000 decision-maker contacts / mo","Everything in Starter","3 seats + team inbox","Advanced sequences + A/B","Priority enrichment queue","Slack + CRM integrations"]'::jsonb,
    2, true, 'https://whop.com/checkout/plan_uwHpvDtO2m4Ew'),
  ('enterprise', 'Enterprise Engine', 999, 10,
    '["20,000+ decision-maker contacts / mo","Everything in Professional","10 seats + sub-accounts","White-glove onboarding","Dedicated success manager","Custom data sources + API access"]'::jsonb,
    3, true, 'https://whop.com/checkout/plan_ztXNnHjgRghy4')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  price_monthly = EXCLUDED.price_monthly,
  seats = EXCLUDED.seats,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  whop_checkout_url = EXCLUDED.whop_checkout_url;
