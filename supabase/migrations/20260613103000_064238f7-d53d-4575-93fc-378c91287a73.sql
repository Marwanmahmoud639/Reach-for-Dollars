
-- Campaigns: drop role-restricted ALL policy, allow any team member to manage; super admin retained; parent admins can view sub-account campaigns
DROP POLICY IF EXISTS "non-agents manage campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "team manages campaigns" ON public.campaigns;
CREATE POLICY "team manages campaigns" ON public.campaigns
  FOR ALL TO authenticated
  USING (team_id = public.get_user_team(auth.uid()))
  WITH CHECK (team_id = public.get_user_team(auth.uid()));

DROP POLICY IF EXISTS "parent admin views child campaigns" ON public.campaigns;
CREATE POLICY "parent admin views child campaigns" ON public.campaigns
  FOR SELECT TO authenticated
  USING (public.is_parent_admin(auth.uid(), team_id));

-- Mirror parent-admin SELECT on campaign_contacts and campaign_metrics
DROP POLICY IF EXISTS "parent admin views child campaign_contacts" ON public.campaign_contacts;
CREATE POLICY "parent admin views child campaign_contacts" ON public.campaign_contacts
  FOR SELECT TO authenticated
  USING (public.is_parent_admin(auth.uid(), team_id));

DROP POLICY IF EXISTS "parent admin views child campaign_metrics" ON public.campaign_metrics;
CREATE POLICY "parent admin views child campaign_metrics" ON public.campaign_metrics
  FOR SELECT TO authenticated
  USING (public.is_parent_admin(auth.uid(), team_id));
