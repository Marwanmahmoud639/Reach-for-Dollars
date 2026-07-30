
CREATE TABLE public.whop_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  tier text NOT NULL,
  whop_user_id text,
  whop_session_id text UNIQUE,
  whop_membership_id text,
  status text NOT NULL DEFAULT 'pending',
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whop_purchases_email_idx ON public.whop_purchases (lower(email));
GRANT SELECT ON public.whop_purchases TO authenticated;
GRANT ALL ON public.whop_purchases TO service_role;
ALTER TABLE public.whop_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super admin reads all whop purchases"
  ON public.whop_purchases FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));
CREATE TRIGGER update_whop_purchases_updated_at
  BEFORE UPDATE ON public.whop_purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
