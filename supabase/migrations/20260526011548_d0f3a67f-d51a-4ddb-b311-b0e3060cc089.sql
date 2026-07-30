
-- ============================================================
-- Phase 4: Operations & Compliance Upgrades
-- ============================================================

-- Extend contacts
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS detected_timezone text,
  ADD COLUMN IF NOT EXISTS timezone_source text CHECK (timezone_source IN ('area_code','address','city','manual')),
  ADD COLUMN IF NOT EXISTS timezone_confidence text CHECK (timezone_confidence IN ('high','medium','low')),
  ADD COLUMN IF NOT EXISTS is_dnc_federal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_dnc_internal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dnc_reason text,
  ADD COLUMN IF NOT EXISTS dnc_added_at timestamptz;

-- Extend contact_phones
ALTER TABLE public.contact_phones
  ADD COLUMN IF NOT EXISTS line_type text CHECK (line_type IN ('mobile','landline','voip','toll_free','unknown')),
  ADD COLUMN IF NOT EXISTS carrier_name text,
  ADD COLUMN IF NOT EXISTS carrier_lookup_date timestamptz,
  ADD COLUMN IF NOT EXISTS is_sms_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_dnc boolean NOT NULL DEFAULT false;

-- Extend contact_emails
ALTER TABLE public.contact_emails
  ADD COLUMN IF NOT EXISTS is_unsubscribed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS contact_emails_unsubscribe_token_key ON public.contact_emails(unsubscribe_token);

-- Extend business_intel
ALTER TABLE public.business_intel
  ADD COLUMN IF NOT EXISTS is_real_estate_investor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS properties_owned integer,
  ADD COLUMN IF NOT EXISTS recent_transactions_12mo integer,
  ADD COLUMN IF NOT EXISTS llc_registered_agent text,
  ADD COLUMN IF NOT EXISTS llc_mailing_address text,
  ADD COLUMN IF NOT EXISTS portfolio_size text CHECK (portfolio_size IN ('small','medium','large','unknown')),
  ADD COLUMN IF NOT EXISTS active_buyer_signal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_transaction_date date,
  ADD COLUMN IF NOT EXISTS attom_last_checked timestamptz,
  ADD COLUMN IF NOT EXISTS sos_last_checked timestamptz;

-- Extend team_settings
ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS attom_api_key text,
  ADD COLUMN IF NOT EXISTS propstream_api_key text,
  ADD COLUMN IF NOT EXISTS batchleads_api_key text,
  ADD COLUMN IF NOT EXISTS skip_trace_provider_2 text,
  ADD COLUMN IF NOT EXISTS skip_trace_key_2 text,
  ADD COLUMN IF NOT EXISTS skip_trace_provider_3 text,
  ADD COLUMN IF NOT EXISTS skip_trace_key_3 text,
  ADD COLUMN IF NOT EXISTS skip_trace_provider_4 text,
  ADD COLUMN IF NOT EXISTS skip_trace_key_4 text,
  ADD COLUMN IF NOT EXISTS skip_trace_provider_5 text,
  ADD COLUMN IF NOT EXISTS skip_trace_key_5 text,
  ADD COLUMN IF NOT EXISTS skip_trace_waterfall_order text[] NOT NULL DEFAULT ARRAY['batch','trestle','idi','spokeo','whitepages']::text[],
  ADD COLUMN IF NOT EXISTS carrier_lookup_provider text,
  ADD COLUMN IF NOT EXISTS carrier_lookup_key text,
  ADD COLUMN IF NOT EXISTS auto_carrier_lookup boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS dnc_api_provider text,
  ADD COLUMN IF NOT EXISTS dnc_api_key text,
  ADD COLUMN IF NOT EXISTS dnc_last_scrub timestamptz,
  ADD COLUMN IF NOT EXISTS sms_opt_out_footer text NOT NULL DEFAULT ' Reply STOP to unsubscribe',
  ADD COLUMN IF NOT EXISTS enforce_tcpa_hours boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sending_strategy text NOT NULL DEFAULT 'round_robin' CHECK (sending_strategy IN ('round_robin','load_balanced','random')),
  ADD COLUMN IF NOT EXISTS mxtoolbox_api_key text,
  ADD COLUMN IF NOT EXISTS account_timezone text NOT NULL DEFAULT 'America/Chicago';

-- Extend campaigns
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS sending_inbox_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS sending_strategy text NOT NULL DEFAULT 'round_robin' CHECK (sending_strategy IN ('round_robin','load_balanced','random'));

-- ============= New tables =============

-- sending_domains
CREATE TABLE IF NOT EXISTS public.sending_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  domain text NOT NULL,
  spf_configured boolean NOT NULL DEFAULT false,
  dkim_configured boolean NOT NULL DEFAULT false,
  dmarc_configured boolean NOT NULL DEFAULT false,
  tracking_cname_configured boolean NOT NULL DEFAULT false,
  warming_status text NOT NULL DEFAULT 'cold' CHECK (warming_status IN ('cold','warming','warmed')),
  health_score integer NOT NULL DEFAULT 100,
  bounce_rate numeric NOT NULL DEFAULT 0,
  spam_rate numeric NOT NULL DEFAULT 0,
  dkim_public_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, domain)
);
ALTER TABLE public.sending_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team views sending_domains" ON public.sending_domains FOR SELECT USING (team_id = get_user_team(auth.uid()));
CREATE POLICY "non-agents manage sending_domains" ON public.sending_domains FOR ALL
  USING (team_id = get_user_team(auth.uid()) AND (has_team_role(auth.uid(), team_id, 'admin') OR has_team_role(auth.uid(), team_id, 'manager')))
  WITH CHECK (team_id = get_user_team(auth.uid()) AND (has_team_role(auth.uid(), team_id, 'admin') OR has_team_role(auth.uid(), team_id, 'manager')));
CREATE POLICY "super admin full access" ON public.sending_domains FOR ALL USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS sending_domains_team_idx ON public.sending_domains(team_id);

-- sending_inboxes
CREATE TABLE IF NOT EXISTS public.sending_inboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  domain_id uuid NOT NULL REFERENCES public.sending_domains(id) ON DELETE CASCADE,
  email_address text NOT NULL,
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  smtp_password text,
  warm_up_stage integer NOT NULL DEFAULT 1 CHECK (warm_up_stage BETWEEN 1 AND 5),
  days_active integer NOT NULL DEFAULT 0,
  daily_limit integer NOT NULL DEFAULT 20,
  sent_today integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  bounce_rate numeric NOT NULL DEFAULT 0,
  spam_rate numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, email_address)
);
ALTER TABLE public.sending_inboxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team views sending_inboxes" ON public.sending_inboxes FOR SELECT USING (team_id = get_user_team(auth.uid()));
CREATE POLICY "non-agents manage sending_inboxes" ON public.sending_inboxes FOR ALL
  USING (team_id = get_user_team(auth.uid()) AND (has_team_role(auth.uid(), team_id, 'admin') OR has_team_role(auth.uid(), team_id, 'manager')))
  WITH CHECK (team_id = get_user_team(auth.uid()) AND (has_team_role(auth.uid(), team_id, 'admin') OR has_team_role(auth.uid(), team_id, 'manager')));
CREATE POLICY "super admin full access" ON public.sending_inboxes FOR ALL USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS sending_inboxes_team_idx ON public.sending_inboxes(team_id);
CREATE INDEX IF NOT EXISTS sending_inboxes_domain_idx ON public.sending_inboxes(domain_id);

-- dnc_suppression_list (append-only)
CREATE TABLE IF NOT EXISTS public.dnc_suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  phone_or_email text NOT NULL,
  type text NOT NULL CHECK (type IN ('phone','email')),
  source text NOT NULL CHECK (source IN ('federal','internal','opt_out','manual','bounce')),
  reason text,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by_user_id uuid,
  UNIQUE (team_id, phone_or_email, type)
);
ALTER TABLE public.dnc_suppression_list ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team views dnc" ON public.dnc_suppression_list FOR SELECT USING (team_id = get_user_team(auth.uid()));
CREATE POLICY "team inserts dnc" ON public.dnc_suppression_list FOR INSERT WITH CHECK (team_id = get_user_team(auth.uid()));
CREATE POLICY "super admin full access" ON public.dnc_suppression_list FOR ALL USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS dnc_team_idx ON public.dnc_suppression_list(team_id);
CREATE INDEX IF NOT EXISTS dnc_lookup_idx ON public.dnc_suppression_list(team_id, phone_or_email);

-- compliance_log (append-only)
CREATE TABLE IF NOT EXISTS public.compliance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  campaign_id uuid,
  run_at timestamptz NOT NULL DEFAULT now(),
  contacts_total integer NOT NULL DEFAULT 0,
  contacts_sent integer NOT NULL DEFAULT 0,
  contacts_suppressed_dnc integer NOT NULL DEFAULT 0,
  contacts_suppressed_non_mobile integer NOT NULL DEFAULT 0,
  contacts_suppressed_timezone integer NOT NULL DEFAULT 0,
  contacts_suppressed_internal_dnc integer NOT NULL DEFAULT 0,
  compliance_passed boolean NOT NULL DEFAULT true,
  log_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.compliance_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team views compliance" ON public.compliance_log FOR SELECT USING (team_id = get_user_team(auth.uid()));
CREATE POLICY "team inserts compliance" ON public.compliance_log FOR INSERT WITH CHECK (team_id = get_user_team(auth.uid()));
CREATE POLICY "super admin full access" ON public.compliance_log FOR ALL USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS compliance_team_idx ON public.compliance_log(team_id, run_at DESC);

-- blacklist_checks
CREATE TABLE IF NOT EXISTS public.blacklist_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  domain text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  is_listed boolean NOT NULL DEFAULT false,
  listed_on text[] NOT NULL DEFAULT '{}'::text[],
  check_provider text NOT NULL DEFAULT 'mxtoolbox'
);
ALTER TABLE public.blacklist_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team views blacklist" ON public.blacklist_checks FOR SELECT USING (team_id = get_user_team(auth.uid()));
CREATE POLICY "team inserts blacklist" ON public.blacklist_checks FOR INSERT WITH CHECK (team_id = get_user_team(auth.uid()));
CREATE POLICY "super admin full access" ON public.blacklist_checks FOR ALL USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS blacklist_team_idx ON public.blacklist_checks(team_id, checked_at DESC);

-- ============= Updated lead score trigger =============
CREATE OR REPLACE FUNCTION public.compute_lead_score()
RETURNS trigger
LANGUAGE plpgsql
AS $$
declare
  re_record record;
  has_mobile boolean := false;
  has_landline_only boolean := false;
begin
  -- Real estate bonuses
  select * into re_record from public.business_intel where contact_id = new.id limit 1;
  -- Mobile detection
  select exists(select 1 from public.contact_phones where contact_id = new.id and line_type = 'mobile') into has_mobile;
  if not has_mobile then
    select exists(select 1 from public.contact_phones where contact_id = new.id and line_type = 'landline') into has_landline_only;
  end if;

  new.lead_score := 0
    + case when new.email_verified then 25 else 0 end
    + case when new.phone_verified then 25 else 0 end
    + case when new.linkedin_url is not null and new.linkedin_url <> '' then 15 else 0 end
    + case when new.instagram_url is not null and new.instagram_url <> '' then 10 else 0 end
    + case when new.facebook_url is not null and new.facebook_url <> '' then 10 else 0 end
    + case when new.industry is not null and new.industry <> '' then 10 else 0 end
    + case when array_length(new.verification_sources, 1) >= 2 then 5 else 0 end
    + case when has_mobile then 10 else 0 end
    + case when has_landline_only then -5 else 0 end
    + case when re_record.is_real_estate_investor then
        coalesce(case when re_record.active_buyer_signal then 15 else 0 end, 0)
        + coalesce(case when re_record.portfolio_size = 'large' then 10 when re_record.portfolio_size = 'medium' then 5 else 0 end, 0)
        + coalesce(case when re_record.llc_registered_agent is not null then 5 else 0 end, 0)
        + coalesce(case when re_record.last_transaction_date is not null then 3 else 0 end, 0)
      else 0 end;
  new.updated_at := now();
  return new;
end; $$;

-- Trigger to nightly-reset is handled by pg_cron worker, not a row trigger.
