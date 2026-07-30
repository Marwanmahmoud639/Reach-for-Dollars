DROP POLICY IF EXISTS "read cache" ON public.ai_lookup_cache;
REVOKE SELECT ON public.ai_lookup_cache FROM authenticated;