// deno-lint-ignore-file no-explicit-any
// Global directory scrapers powered by Firecrawl's extract endpoint
// plus a free Reddit JSON scraper. Each function returns the same
// Business shape used by ../index.ts so downstream pipeline steps work
// unchanged.

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";

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

// ─── Country/Region tables ──────────────────────────────────────────────────
const COUNTRY_DOMAINS: Record<string, string> = {
  "united states": "com",
  "usa": "com",
  "us": "com",
  "uk": "co.uk",
  "united kingdom": "co.uk",
  "canada": "ca",
  "australia": "com.au",
  "germany": "de",
  "france": "fr",
  "spain": "es",
  "italy": "it",
  "netherlands": "nl",
  "sweden": "se",
  "norway": "no",
  "denmark": "dk",
  "finland": "fi",
  "japan": "co.jp",
  "south korea": "co.kr",
  "singapore": "sg",
  "india": "in",
  "mexico": "com.mx",
  "brazil": "com.br",
  "argentina": "com.ar",
  "chile": "cl",
  "uae": "ae",
  "saudi arabia": "sa",
};

const CRAIGSLIST_CITIES: Record<string, string> = {
  austin: "austin", dallas: "dallas", houston: "houston", miami: "miami",
  orlando: "orlando", atlanta: "atlanta", phoenix: "phoenix",
  "los angeles": "losangeles", "new york": "newyork", chicago: "chicago",
  denver: "denver", seattle: "seattle", "san francisco": "sfbay",
  boston: "boston", washington: "washdc", philadelphia: "philadelphia",
  toronto: "toronto", vancouver: "vancouver",
};

function getCountryFromLocation(location: string): string {
  const l = (location || "").toLowerCase();
  for (const country of Object.keys(COUNTRY_DOMAINS)) {
    if (l.includes(country)) return country;
  }
  return "united states";
}

function cityOf(location: string): string | undefined {
  return location?.split(",")[0]?.trim() || undefined;
}

// ─── Generic Firecrawl extract helper ───────────────────────────────────────
async function firecrawlScrape(
  url: string,
  apiKey: string,
  extractSchema: Record<string, any>,
  systemPrompt = "Extract all business listings from this page. Include name, address, phone, website, rating.",
): Promise<any> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 45000);
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["extract"],
        extract: { schema: extractSchema, systemPrompt },
        timeout: 30000,
      }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      console.error(`Firecrawl scrape failed for ${url}: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data?.data?.extract ?? data?.data?.json ?? null;
  } catch (e) {
    console.error(`Firecrawl scrape error for ${url}:`, String(e));
    return null;
  } finally {
    clearTimeout(to);
  }
}

function unwrap(extract: any, key: string): any[] {
  if (!extract) return [];
  if (Array.isArray(extract)) {
    if (extract.length && extract[0]?.[key]) return extract[0][key];
    return extract;
  }
  if (Array.isArray(extract[key])) return extract[key];
  return [];
}

// ─── YELP (GLOBAL) ──────────────────────────────────────────────────────────
export async function scrapeYelpGlobal(
  keyword: string,
  location: string,
  apiKey: string,
): Promise<Business[]> {
  const country = getCountryFromLocation(location);
  const domain = COUNTRY_DOMAINS[country] || "com";
  const url = `https://www.yelp.${domain}/search?find_desc=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(location)}`;
  const schema = {
    type: "object",
    properties: {
      businesses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            address: { type: "string" },
            rating: { type: "number" },
            category: { type: "string" },
            website: { type: "string" },
          },
        },
      },
    },
  };
  const extract = await firecrawlScrape(url, apiKey, schema);
  const list = unwrap(extract, "businesses");
  return list
    .filter((b: any) => b?.name)
    .map((b: any): Business => ({
      name: b.name,
      phone: b.phone,
      rating: typeof b.rating === "number" ? b.rating : undefined,
      industry: b.category,
      website: b.website,
      city: cityOf(location),
      country: country.toUpperCase(),
      sources: ["yelp"],
      raw: { yelp: b },
    }));
}

// ─── YELLOW PAGES (US/Canada) ───────────────────────────────────────────────
export async function scrapeYellowPagesGlobal(
  keyword: string,
  location: string,
  apiKey: string,
): Promise<Business[]> {
  const country = getCountryFromLocation(location);
  const url = `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(keyword)}&geo_location_terms=${encodeURIComponent(location)}`;
  const schema = {
    type: "object",
    properties: {
      businesses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            address: { type: "string" },
            website: { type: "string" },
            category: { type: "string" },
          },
        },
      },
    },
  };
  const extract = await firecrawlScrape(url, apiKey, schema);
  const list = unwrap(extract, "businesses");
  return list
    .filter((b: any) => b?.name)
    .map((b: any): Business => ({
      name: b.name,
      phone: b.phone,
      website: b.website,
      industry: b.category,
      city: cityOf(location),
      country: country.toUpperCase(),
      sources: ["yellow_pages"],
      raw: { yellow_pages: b },
    }));
}

// ─── ANGI (US/Canada) ──────────────────────────────────────────────────────
export async function scrapeAngiGlobal(
  keyword: string,
  location: string,
  apiKey: string,
): Promise<Business[]> {
  const country = getCountryFromLocation(location);
  if (!["united states", "usa", "us", "canada"].includes(country)) return [];
  const url = `https://www.angi.com/companylist/us/${encodeURIComponent(location)}/${encodeURIComponent(keyword)}.htm`;
  const schema = {
    type: "object",
    properties: {
      businesses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            rating: { type: "number" },
            website: { type: "string" },
            address: { type: "string" },
          },
        },
      },
    },
  };
  const extract = await firecrawlScrape(url, apiKey, schema);
  const list = unwrap(extract, "businesses");
  return list
    .filter((b: any) => b?.name)
    .map((b: any): Business => ({
      name: b.name,
      phone: b.phone,
      rating: typeof b.rating === "number" ? b.rating : undefined,
      website: b.website,
      city: cityOf(location),
      country: country.toUpperCase(),
      sources: ["angi"],
      raw: { angi: b },
    }));
}

// ─── BBB (GLOBAL) ──────────────────────────────────────────────────────────
export async function scrapeBBBGlobal(
  keyword: string,
  location: string,
  apiKey: string,
): Promise<Business[]> {
  const url = `https://www.bbb.org/search?find_text=${encodeURIComponent(keyword)}&find_loc=${encodeURIComponent(location)}`;
  const schema = {
    type: "object",
    properties: {
      businesses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            address: { type: "string" },
            website: { type: "string" },
            accredited: { type: "boolean" },
            rating: { type: "string" },
          },
        },
      },
    },
  };
  const extract = await firecrawlScrape(url, apiKey, schema);
  const list = unwrap(extract, "businesses");
  return list
    .filter((b: any) => b?.name)
    .map((b: any): Business => ({
      name: b.name,
      phone: b.phone,
      website: b.website,
      city: cityOf(location),
      country: getCountryFromLocation(location).toUpperCase(),
      sources: ["bbb"],
      raw: { bbb: b },
    }));
}

// ─── BIGGERPOCKETS (US Real Estate) ────────────────────────────────────────
export async function scrapeBiggerPocketsGlobal(
  keyword: string,
  location: string,
  apiKey: string,
): Promise<Business[]> {
  const q = encodeURIComponent(`${keyword} ${location}`);
  const url = `https://www.biggerpockets.com/users/search?search[keywords]=${q}`;
  const schema = {
    type: "object",
    properties: {
      investors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            username: { type: "string" },
            location: { type: "string" },
            role: { type: "string" },
            profile_url: { type: "string" },
            bio: { type: "string" },
          },
        },
      },
    },
  };
  const extract = await firecrawlScrape(
    url,
    apiKey,
    schema,
    "Extract investor profiles. Include name, profile_url, location, bio.",
  );
  const list = unwrap(extract, "investors");
  return list
    .filter((p: any) => p?.name)
    .map((p: any): Business => ({
      name: p.name,
      website: p.profile_url,
      description: p.bio,
      city: cityOf(location),
      country: "USA",
      sources: ["biggerpockets"],
      raw: { biggerpockets: p },
    }));
}

// ─── CRAIGSLIST (US/Canada) ────────────────────────────────────────────────
export async function scrapeCraigslistGlobal(
  keyword: string,
  location: string,
  apiKey: string,
): Promise<Business[]> {
  const country = getCountryFromLocation(location);
  if (!["united states", "usa", "us", "canada"].includes(country)) return [];
  const cityKey = (cityOf(location) || "").toLowerCase();
  const subdomain = CRAIGSLIST_CITIES[cityKey];
  // No subdomain match → skip Craigslist rather than spamming sfbay with the
  // wrong region's query (was causing irrelevant results for non-listed cities).
  if (!subdomain) return [];
  const url = `https://${subdomain}.craigslist.org/search/reo?query=${encodeURIComponent(keyword)}`;
  const schema = {
    type: "object",
    properties: {
      listings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            price: { type: "string" },
            location: { type: "string" },
            url: { type: "string" },
            date: { type: "string" },
          },
        },
      },
    },
  };
  const extract = await firecrawlScrape(
    url,
    apiKey,
    schema,
    "Extract real estate listings. Include title, price, location, url.",
  );
  const list = unwrap(extract, "listings");
  return list
    .filter((l: any) => l?.title)
    .map((l: any): Business => ({
      name: l.title,
      description: `${l.price ?? ""} — ${l.location ?? ""}`.trim(),
      website: l.url,
      city: cityOf(location),
      country: country.toUpperCase(),
      sources: ["craigslist"],
      raw: { craigslist: l },
    }));
}

// ─── REDDIT (FREE, GLOBAL) ─────────────────────────────────────────────────
export async function scrapeRedditGlobal(
  keyword: string,
  subreddits: string[],
  country?: string,
): Promise<Business[]> {
  const subs = (subreddits || []).filter(Boolean).join("+") || "all";
  const url = `https://www.reddit.com/r/${subs}/search.json?q=${encodeURIComponent(keyword)}&limit=50&sort=new&restrict_sr=on`;
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 10000);
    const res = await fetch(url, {
      headers: { "User-Agent": "R4D Discovery Bot/1.0" },
      signal: ctl.signal,
    });
    clearTimeout(to);
    if (!res.ok) return [];
    const data = await res.json();
    const posts = data?.data?.children ?? [];
    const seen = new Set<string>();
    const out: Business[] = [];
    for (const post of posts) {
      const author = post?.data?.author;
      if (!author || author === "[deleted]" || seen.has(author)) continue;
      seen.add(author);
      out.push({
        name: author,
        description: post?.data?.title,
        website: `https://reddit.com/u/${author}`,
        country: country?.toUpperCase(),
        sources: ["reddit"],
        raw: { reddit: post.data },
      });
    }
    return out;
  } catch (e) {
    console.error("Reddit scrape failed:", String(e));
    return [];
  }
}
