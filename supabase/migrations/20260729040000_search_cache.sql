-- Cache for outbound web-search results.
--
-- Every discovery run pays per search call, and runs repeat heavily: the same
-- city gets searched weekly, the same directory query is issued for every
-- keyword in a niche, and a re-run after a failed step reissues everything. The
-- results themselves are public SERP data that changes slowly, so paying for
-- them twice inside a fortnight is pure waste.
--
-- The cache is deliberately GLOBAL rather than per-team. What is stored is a
-- public search query and its public results — no team data, no PII, nothing
-- that could leak one customer's records to another. Scoping it per team would
-- multiply cost by the number of teams for identical results.

create table if not exists public.search_cache (
  -- sha-256 of the normalised query, so lookups never depend on a long text
  -- index and identical queries collapse regardless of spacing or case.
  query_hash text primary key,

  -- Kept for debugging and for auditing what the platform searches for.
  query text not null,

  -- Which upstream produced this. A cached row is replayed regardless of which
  -- provider the caller would have used, but knowing the origin matters when a
  -- provider starts returning junk and the cache needs selective clearing.
  provider text not null,

  -- Normalised [{ title, snippet, link }] as returned to callers.
  results jsonb not null,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Expiry lookups and the cleanup job both scan on this.
create index if not exists search_cache_expires_at_idx
  on public.search_cache (expires_at);

-- Only edge functions (service role) read or write this. No team owns a row, so
-- there is no policy that would make sense for an end user, and RLS with no
-- policy denies everyone — which is exactly the intent. The service role
-- bypasses RLS, so the discovery pipeline is unaffected.
alter table public.search_cache enable row level security;

comment on table public.search_cache is
  'Cached public web-search results, keyed by query hash. Written and read only by edge functions via the service role.';

-- Drop expired rows. Called opportunistically by the pipeline rather than on a
-- schedule, so the table stays small without needing pg_cron.
create or replace function public.prune_search_cache()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.search_cache where expires_at < now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_search_cache() from public, anon, authenticated;
