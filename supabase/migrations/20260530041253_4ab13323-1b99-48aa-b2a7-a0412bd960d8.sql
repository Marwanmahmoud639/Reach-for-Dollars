-- 1. Cache table
CREATE TABLE public.search_results_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  search_type text NOT NULL CHECK (search_type IN ('business','individual')),
  cache_key text NOT NULL,
  keyword text NOT NULL,
  location text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  UNIQUE (team_id, search_type, cache_key)
);

GRANT SELECT ON public.search_results_cache TO authenticated;
GRANT ALL ON public.search_results_cache TO service_role;

ALTER TABLE public.search_results_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team views search_results_cache"
ON public.search_results_cache
FOR SELECT
TO authenticated
USING (team_id = get_user_team(auth.uid()));

CREATE POLICY "super admin full access search_results_cache"
ON public.search_results_cache
FOR ALL
TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

CREATE INDEX idx_src_lookup ON public.search_results_cache (team_id, search_type, cache_key);
CREATE INDEX idx_src_expires ON public.search_results_cache (expires_at);

-- 2. Flag on searches + individual_searches
ALTER TABLE public.searches
  ADD COLUMN IF NOT EXISTS served_from_cache boolean NOT NULL DEFAULT false;
ALTER TABLE public.individual_searches
  ADD COLUMN IF NOT EXISTS served_from_cache boolean NOT NULL DEFAULT false;
