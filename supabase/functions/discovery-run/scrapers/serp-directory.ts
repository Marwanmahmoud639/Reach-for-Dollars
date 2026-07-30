// deno-lint-ignore-file no-explicit-any
// ─── Directory harvesting from search results, without page scrapes ──────────
//
// The existing directory scrapers (Yelp, Yellow Pages, Angi, BBB, …) each cost
// a Firecrawl *scrape* per listing page. But a site-restricted search already
// returns the listing's name, phone, and city inside the SERP title and
// snippet — one search call covers ten listings instead of ten scrape calls.
//
// So this module mines the search result itself and only leaves the expensive
// path for what it genuinely can't answer. At the unit costs recorded in
// UNIT_COST_USD (serper_search 0.0003, firecrawl_scrape 0.002), harvesting
// thirty listings costs roughly one cent here versus six through scraping.
//
// Everything below runs through the caller's existing webSearch(), so the
// fetch layer, spend ceiling, and cost ledger stay exactly as they are — this
// adds no new vendor and no new key.

export interface Business {
  name: string;
  city?: string;
  state?: string;
  country?: string;
  address?: string;
  lat?: number;
  lng?: number;
  website?: string;
  domain?: string;
  industry?: string;
  phone?: string;
  rating?: number;
  review_count?: number;
  description?: string;
  sources: string[];
  raw: Record<string, any>;
}

/** Minimal shape of the caller's webSearch, so this module stays transport-agnostic. */
export type SearchFn = (
  q: string,
  opts: { num?: number; timeoutMs?: number },
) => Promise<{ organic: { title: string; snippet: string; link: string }[] }>;

/**
 * Directories worth querying, and how to read their result titles.
 *
 * `titleRx` pulls the business name out of the SERP title, which each site
 * formats predictably ("Joe's Roofing - Austin, TX - Yellow Pages"). When it
 * doesn't match we fall back to trimming the site's own suffix, so a layout
 * tweak degrades the name rather than dropping the listing.
 */
const DIRECTORIES: {
  key: string;
  site: string;
  titleRx?: RegExp;
  suffixRx: RegExp;
}[] = [
  { key: "yellowpages", site: "yellowpages.com", suffixRx: /\s*[-|]\s*(yellow ?pages|yp\.com).*$/i },
  { key: "yelp", site: "yelp.com", suffixRx: /\s*[-|]\s*yelp.*$/i },
  { key: "bbb", site: "bbb.org", suffixRx: /\s*[-|]\s*(better business bureau|bbb).*$/i },
  { key: "angi", site: "angi.com", suffixRx: /\s*[-|]\s*(angi|angie'?s list).*$/i },
  { key: "manta", site: "manta.com", suffixRx: /\s*[-|]\s*manta.*$/i },
  { key: "chamber", site: "chamberofcommerce.com", suffixRx: /\s*[-|]\s*chamber ?of ?commerce.*$/i },
];

// US phone shapes as they appear in SERP snippets: (512) 555-0134, 512-555-0134,
// 512.555.0134, +1 512 555 0134. Deliberately narrower than the pipeline's
// GLOBAL_PHONE_RX — a false positive here becomes a wrong lead, and a missed
// phone is recovered later in the skip-trace step anyway.
const PHONE_RX = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/g;

/** Digits-only, 10-digit US number, or null when the token isn't one. */
function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return null;
  // Area code and exchange can't start with 0 or 1 in the US plan; this drops
  // things like "1000-2000" and zip+4 runs that otherwise look phone-shaped.
  if (/^[01]/.test(ten) || /^[01]/.test(ten.slice(3))) return null;
  return ten;
}

function firstPhone(text: string): string | undefined {
  PHONE_RX.lastIndex = 0;
  for (const m of text.matchAll(PHONE_RX)) {
    const n = normalizePhone(m[0]);
    if (n) return n;
  }
  return undefined;
}

/** "Austin, TX" out of a title or snippet, when the directory included it. */
function parseCityState(text: string): { city?: string; state?: string } {
  const m = text.match(/\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2}),\s*([A-Z]{2})\b/);
  if (!m) return {};
  return { city: m[1].trim(), state: m[2] };
}

/**
 * Business name from a listing title.
 *
 * Titles arrive as "Joe's Roofing - Austin, TX - Yellow Pages" or
 * "Joe's Roofing | Yelp". We strip the directory suffix, then drop a trailing
 * "City, ST" fragment, then take what's left.
 */
function parseName(title: string, dir: { titleRx?: RegExp; suffixRx: RegExp }): string {
  if (dir.titleRx) {
    const m = title.match(dir.titleRx);
    if (m?.[1]) return m[1].trim();
  }
  let name = title.replace(dir.suffixRx, "");
  name = name.replace(/\s*[-|]\s*[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2},\s*[A-Z]{2}\s*$/, "");
  name = name.replace(/\s*[-|]\s*(reviews?|contact|about|home|profile)\s*$/i, "");
  return name.replace(/\s{2,}/g, " ").trim();
}

/** Names that are the directory's own furniture rather than a business. */
const NOT_A_BUSINESS_RX =
  /^(top|best|\d+\s+best|find|search|browse|directory|listings?|results?|near me|categories|home)\b/i;

function looksLikeBusiness(name: string): boolean {
  if (name.length < 3 || name.length > 80) return false;
  if (NOT_A_BUSINESS_RX.test(name)) return false;
  // A listing title is mostly words; a page of navigation is mostly punctuation.
  const letters = (name.match(/[a-zA-Z]/g) || []).length;
  return letters >= Math.max(3, name.length * 0.5);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Harvest businesses for a keyword + location from public directories, using
 * only search calls.
 *
 * One query per directory. Results whose host doesn't match the directory are
 * dropped — a site: query occasionally leaks an unrelated result, and letting
 * those through would attribute a random page to a directory it isn't on.
 *
 * Never throws: a directory that errors or returns nothing is skipped, because
 * this runs inside a pipeline step where one bad source must not fail the run.
 */
export async function harvestDirectoriesViaSerp(
  keyword: string,
  location: string,
  search: SearchFn,
  opts: {
    /** Stop starting new queries past this timestamp. */
    deadlineMs?: number;
    /** Cap on directories queried, so a caller can trade coverage for spend. */
    maxDirectories?: number;
    /** Results requested per query. */
    perQuery?: number;
  } = {},
): Promise<{ businesses: Business[]; directoriesUsed: string[] }> {
  const perQuery = opts.perQuery ?? 10;
  const dirs = DIRECTORIES.slice(0, opts.maxDirectories ?? DIRECTORIES.length);

  const out: Business[] = [];
  const used: string[] = [];

  for (const dir of dirs) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;

    const q = `site:${dir.site} ${keyword} ${location}`.trim();
    let organic: { title: string; snippet: string; link: string }[] = [];
    try {
      const res = await search(q, { num: perQuery, timeoutMs: 5500 });
      organic = res.organic || [];
    } catch {
      continue; // directory unavailable this run; the others still contribute
    }
    if (!organic.length) continue;

    let kept = 0;
    for (const r of organic) {
      const host = hostOf(r.link);
      if (!host.endsWith(dir.site)) continue;

      const name = parseName(r.title || "", dir);
      if (!looksLikeBusiness(name)) continue;

      const blob = `${r.title || ""} ${r.snippet || ""}`;
      const { city, state } = parseCityState(blob);

      out.push({
        name,
        city,
        state,
        country: "USA",
        phone: firstPhone(blob),
        description: (r.snippet || "").slice(0, 300) || undefined,
        sources: [dir.key],
        raw: { directory: dir.key, listing_url: r.link, title: r.title },
      });
      kept++;
    }
    if (kept > 0) used.push(dir.key);
  }

  return { businesses: dedupe(out), directoriesUsed: used };
}

/** Comparison key: name without punctuation or common suffixes, plus city. */
function dedupeKey(b: Business): string {
  const name = b.name
    .toLowerCase()
    .replace(/\b(llc|inc|co|corp|company|ltd|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  return `${name}|${(b.city || "").toLowerCase()}`;
}

/**
 * Collapse the same business appearing on several directories into one record,
 * keeping every source and filling blanks from the later copies. A business
 * listed on three directories is a stronger signal than one listed on a single
 * directory, and the merged `sources` array preserves that.
 */
export function dedupe(items: Business[]): Business[] {
  const byKey = new Map<string, Business>();
  for (const b of items) {
    if (!b.name) continue;
    const key = dedupeKey(b);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...b, sources: [...b.sources] });
      continue;
    }
    existing.phone ??= b.phone;
    existing.city ??= b.city;
    existing.state ??= b.state;
    existing.address ??= b.address;
    existing.website ??= b.website;
    existing.description ??= b.description;
    for (const s of b.sources) if (!existing.sources.includes(s)) existing.sources.push(s);
  }
  return Array.from(byKey.values());
}
