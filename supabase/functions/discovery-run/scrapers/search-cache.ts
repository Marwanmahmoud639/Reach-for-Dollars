// deno-lint-ignore-file no-explicit-any
// ─── Search result cache ─────────────────────────────────────────────────────
//
// Discovery pays per search call, and the same queries recur constantly: the
// same city searched again next week, the same directory query issued for every
// keyword in a niche, everything reissued when a run is retried. SERP results
// for business listings change slowly, so a short-lived cache turns most of
// that repeat traffic into free reads.
//
// A miss is never fatal. Every function here swallows its own errors and
// degrades to "no cache", because a cache outage must not take discovery down —
// the worst acceptable outcome is paying for a search we already had.

export type CachedResult = { title: string; snippet: string; link: string };

/**
 * Default lifetime. Two weeks is a deliberate compromise: business listings,
 * owner names, and registry filings rarely change month to month, but a shorter
 * window than that would barely outlive a single campaign's re-runs.
 */
export const DEFAULT_TTL_HOURS = 336;

/**
 * Normalise before hashing so trivial differences don't fragment the cache.
 * Case and whitespace carry no meaning to a search engine, so `Roofing  Austin`
 * and `roofing austin` must land on the same row.
 */
function normalise(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

async function hashQuery(query: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalise(query));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Look up a cached result set.
 *
 * Returns null on a miss, on an expired row, or on any error at all. Callers
 * treat all three identically: go and pay for the search.
 */
export async function getCachedSearch(
  supabase: any,
  query: string,
): Promise<CachedResult[] | null> {
  try {
    const query_hash = await hashQuery(query);
    const { data, error } = await supabase
      .from("search_cache")
      .select("results, expires_at")
      .eq("query_hash", query_hash)
      .maybeSingle();

    if (error || !data) return null;
    // Trust the stored timestamp rather than filtering in SQL: this way a row
    // that expired a second ago is a clean miss instead of a race.
    if (new Date(data.expires_at).getTime() <= Date.now()) return null;

    const results = data.results;
    if (!Array.isArray(results) || results.length === 0) return null;
    return results as CachedResult[];
  } catch {
    return null;
  }
}

/**
 * Store a result set.
 *
 * Empty result sets are NOT cached. An empty response usually means the
 * provider was rate-limited or the key was rejected, and freezing that into a
 * two-week "no results" answer would quietly starve every later run of the
 * same query.
 */
export async function putCachedSearch(
  supabase: any,
  query: string,
  provider: string,
  results: CachedResult[],
  ttlHours: number = DEFAULT_TTL_HOURS,
): Promise<void> {
  try {
    if (!Array.isArray(results) || results.length === 0) return;
    const query_hash = await hashQuery(query);
    const expires_at = new Date(Date.now() + ttlHours * 3_600_000).toISOString();

    await supabase.from("search_cache").upsert(
      {
        query_hash,
        query: normalise(query).slice(0, 2000),
        provider,
        results,
        expires_at,
      },
      { onConflict: "query_hash" },
    );
  } catch {
    // Losing a write costs one future search, which is not worth failing a run.
  }
}

/**
 * Opportunistic cleanup, so the table doesn't grow without bound and we don't
 * need pg_cron for something this cheap. Called once per pipeline run and
 * ignored if it fails.
 */
export async function pruneSearchCache(supabase: any): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("prune_search_cache");
    if (error) return 0;
    return typeof data === "number" ? data : 0;
  } catch {
    return 0;
  }
}
