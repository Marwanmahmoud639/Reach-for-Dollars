
-- Helper: staff predicate (super admin or any admin role)
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id)
      OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$$;

-- PLANS
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  price_monthly numeric NOT NULL,
  seats int NOT NULL DEFAULT 1,
  whop_plan_id text,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans public read active" ON public.plans FOR SELECT USING (is_active = true);
CREATE POLICY "plans staff all" ON public.plans FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER plans_updated_at BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- SIGNUPS
CREATE TABLE IF NOT EXISTS public.signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  company text,
  business_type text,
  team_size text,
  selected_plan_slug text,
  status text NOT NULL DEFAULT 'new',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signups_email_idx ON public.signups (lower(email));
CREATE INDEX IF NOT EXISTS signups_user_idx ON public.signups (user_id);
GRANT SELECT, INSERT, UPDATE ON public.signups TO authenticated;
GRANT ALL ON public.signups TO service_role;
ALTER TABLE public.signups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signups owner read" ON public.signups FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "signups owner write" ON public.signups FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "signups owner update" ON public.signups FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE TRIGGER signups_updated_at BEFORE UPDATE ON public.signups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PAYMENTS
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_id uuid REFERENCES public.signups(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  whop_payment_id text UNIQUE,
  whop_membership_id text,
  whop_plan_id text,
  buyer_email text,
  amount numeric,
  currency text DEFAULT 'usd',
  status text NOT NULL,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_user_idx ON public.payments (user_id);
CREATE INDEX IF NOT EXISTS payments_email_idx ON public.payments (lower(buyer_email));
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments owner or staff read" ON public.payments FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

-- SUBSCRIPTIONS
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_slug text,
  whop_membership_id text UNIQUE,
  seats int DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subs_user_idx ON public.subscriptions (user_id);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subs owner or staff read" ON public.subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "subs staff write" ON public.subscriptions FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER subs_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed plans
INSERT INTO public.plans (slug, name, price_monthly, seats, features, sort_order) VALUES
('starter','Starter', 97,  1,
 '["Contact discovery (business + individual)","1 pipeline board","Areas map","Single-user email outreach","CSV import/export"]'::jsonb, 1),
('growth','Growth',   297, 3,
 '["Everything in Starter","3 seats / team access","Multi-provider email (Brevo, Gmail, SMTP)","Saved territories & lists","Priority support"]'::jsonb, 2),
('agency','Agency',   597, 10,
 '["Everything in Growth","10 seats + RBAC","Bulk scraping & enrichment","Team performance views","Onboarding call + done-with-you setup"]'::jsonb, 3)
ON CONFLICT (slug) DO NOTHING;
