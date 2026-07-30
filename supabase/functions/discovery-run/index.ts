// deno-lint-ignore-file no-explicit-any
// R4D Phase 2 — Discovery Engine orchestrator
// Runs the full 6-step pipeline for a given search_id, streaming progress
// via search_steps updates (Realtime broadcasts them to the UI).
// Sources without configured API keys are marked failed for that step and skipped.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  scrapeYelpGlobal,
  scrapeYellowPagesGlobal,
  scrapeAngiGlobal,
  scrapeBBBGlobal,
  scrapeBiggerPocketsGlobal,
  scrapeCraigslistGlobal,
  scrapeRedditGlobal,
} from "./scrapers/firecrawl-global.ts";
import { scrapeOpenStreetMap } from "./scrapers/osm-global.ts";
import { harvestDirectoriesViaSerp } from "./scrapers/serp-directory.ts";
import { runDmAgent } from "./scrapers/dm-agent.ts";
import { getCachedSearch, putCachedSearch, pruneSearchCache } from "./scrapers/search-cache.ts";
import { lookupOwners } from "./scrapers/property-records.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// No literal fallback: a key hardcoded here is a key published to anyone who
// can read the repo, and billable Google usage runs against it. Set
// GOOGLE_MAPS_KEY (or GOOGLE_MAPS_SERVER_KEY) as a Supabase secret. Empty means
// the Google Maps source is skipped and reported as unconfigured, which is a
// far better failure than leaking a credential.
const GOOGLE_MAPS_KEY = Deno.env.get("GOOGLE_MAPS_KEY") ?? Deno.env.get("GOOGLE_MAPS_SERVER_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type StepName = "business" | "decisionmakers" | "social" | "skiptrace" | "verify" | "score" | "finalize";

interface Business {
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
  employee_count?: number;
  founded_year?: number;
  description?: string;
  services?: string[];
  sources: string[];
  raw: Record<string, any>;
  // decision maker
  contact_name?: string;
  contact_title?: string;
  emails_found?: { email: string; source: string }[];
  phones_found?: { phone: string; source: string; type?: string }[];
  linkedin_url?: string;
  instagram_url?: string;
  facebook_url?: string;
  twitter_url?: string;
  youtube_url?: string;
  /** Set by the early persist, so later enrichment updates the row it created
   *  instead of inserting a duplicate. */
  contact_id?: string;
}

// ─── Social profile lookup (Serper) ───────────────────────────────────────────
const SOCIAL_PLATFORMS = [
  { key: "facebook_url" as const, site: "facebook.com", hostRx: /(^|\.)facebook\.com$/i },
  { key: "instagram_url" as const, site: "instagram.com", hostRx: /(^|\.)instagram\.com$/i },
  { key: "twitter_url" as const, site: "twitter.com OR site:x.com", hostRx: /(^|\.)(twitter|x)\.com$/i },
  { key: "youtube_url" as const, site: "youtube.com", hostRx: /(^|\.)youtube\.com$/i },
];

// Strict identity match: candidate must reference the person's name AND
// (company OR city) inside the title/snippet/link path. Prevents attaching
// random Facebook/Instagram/LinkedIn profiles that share a common name.
function strictIdentityMatch(
  hay: string,
  fullName: string,
  company: string | undefined,
  city: string | undefined,
): boolean {
  const h = hay.toLowerCase();
  const nameParts = fullName.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (nameParts.length < 2) return false;
  // Require first + last name to both appear.
  const first = nameParts[0];
  const last = nameParts[nameParts.length - 1];
  if (!h.includes(first) || !h.includes(last)) return false;
  const comp = (company || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const cty = (city || "").toLowerCase().trim();
  const compTokens = comp.split(/\s+/).filter(w => w.length >= 3 && !["llc","inc","the","and","group","company","co"].includes(w));
  const compHit = compTokens.length > 0 && compTokens.some(t => h.includes(t));
  const cityHit = cty.length >= 3 && h.includes(cty);
  return compHit || cityHit;
}

async function serperStrictMatchUrl(
  query: string,
  apiKey: string | null,
  hostRx: RegExp,
  fullName: string,
  company: string | undefined,
  city: string | undefined,
  firecrawlKey: string | null = null,
): Promise<string | null> {
  try {
    const { organic } = await webSearch(query, { serperKey: apiKey, firecrawlKey, num: 8, timeoutMs: 5000 });
    for (const o of organic) {
      if (!o.link) continue;
      try {
        const url = new URL(o.link);
        if (!hostRx.test(url.hostname)) continue;
        const hay = `${o.title || ""} ${o.snippet || ""} ${url.pathname}`;
        if (!strictIdentityMatch(hay, fullName, company, city)) continue;
        return o.link;
      } catch { /* ignore */ }
    }
    return null;
  } catch {
    return null;
  }
}

async function enrichSocials(
  fullName: string | undefined,
  company: string | undefined,
  serperKey: string | null | undefined,
  city?: string | undefined,
  firecrawlKey?: string | null,
): Promise<Partial<Record<"facebook_url" | "instagram_url" | "twitter_url" | "youtube_url", string>>> {
  if (!fullName) return {};
  const q = `"${fullName}"${company ? ` "${company}"` : ""}${city ? ` "${city}"` : ""}`;
  const results = await Promise.allSettled(
    SOCIAL_PLATFORMS.map((p) =>
      serperStrictMatchUrl(`site:${p.site} ${q}`, serperKey ?? null, p.hostRx, fullName, company, city, firecrawlKey ?? null)
        .then((url) => ({ key: p.key, url })),
    ),
  );
  const out: Record<string, string> = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.url) out[r.value.key] = r.value.url;
  }
  return out;
}


function normCompany(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function mergeBusinesses(items: Business[]): Business[] {
  const map = new Map<string, Business>();
  for (const b of items) {
    const key = `${normCompany(b.name)}|${(b.city || "").toLowerCase()}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, b);
    } else {
      // merge fields
      existing.sources = Array.from(new Set([...existing.sources, ...b.sources]));
      existing.website ||= b.website;
      existing.domain ||= b.domain;
      existing.phone ||= b.phone;
      existing.address ||= b.address;
      existing.lat ??= b.lat;
      existing.lng ??= b.lng;
      existing.industry ||= b.industry;
      existing.rating ||= b.rating;
      existing.review_count ||= b.review_count;
      existing.employee_count ||= b.employee_count;
      existing.founded_year ||= b.founded_year;
      existing.description ||= b.description;
      existing.contact_name ||= b.contact_name;
      existing.contact_title ||= b.contact_title;
      existing.linkedin_url ||= b.linkedin_url;
      existing.instagram_url ||= b.instagram_url;
      existing.facebook_url ||= b.facebook_url;
      existing.services = Array.from(new Set([...(existing.services || []), ...(b.services || [])]));
      existing.emails_found = [...(existing.emails_found || []), ...(b.emails_found || [])];
      existing.phones_found = [...(existing.phones_found || []), ...(b.phones_found || [])];
      existing.raw = { ...existing.raw, ...b.raw };
    }
  }
  return Array.from(map.values());
}

// ─── Geocode a free-form business address to lat/lng for the Areas map. ──
// Returns null on failure so callers can fall back to other coords.
async function geocodeAddress(address: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
  if (!address || !apiKey) return null;
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", address);
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const loc = data?.results?.[0]?.geometry?.location;
    if (typeof loc?.lat === "number" && typeof loc?.lng === "number") {
      return { lat: loc.lat, lng: loc.lng };
    }
    return null;
  } catch {
    return null;
  }
}

function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

// ─── USA + Canada gate ──────────────────────────────────────────────────────
// Discovery is restricted to North America. We accept common spellings of
// US/Canada and the 50 US states + 13 Canadian provinces/territories. If a
// search comes in for any other region, the pipeline aborts cleanly with a
// user-facing message instead of running degraded queries.
const US_STATES = new Set([
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida",
  "georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine",
  "maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana","nebraska",
  "nevada","new hampshire","new jersey","new mexico","new york","north carolina","north dakota",
  "ohio","oklahoma","oregon","pennsylvania","rhode island","south carolina","south dakota",
  "tennessee","texas","utah","vermont","virginia","washington","west virginia","wisconsin","wyoming",
  "district of columbia","dc","puerto rico",
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la","me","md",
  "ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc",
  "sd","tn","tx","ut","vt","va","wa","wv","wi","wy","pr",
]);
const CA_PROVINCES = new Set([
  "ontario","quebec","british columbia","alberta","manitoba","saskatchewan","nova scotia",
  "new brunswick","newfoundland and labrador","prince edward island","yukon","northwest territories","nunavut",
  "on","qc","bc","ab","mb","sk","ns","nb","nl","pe","yt","nt","nu",
]);
const US_TOKENS = new Set(["usa","us","u.s.","u.s.a.","united states","united states of america","america"]);
const CA_TOKENS = new Set(["canada","ca","can"]);

function resolveCountry(location: string): "USA" | "Canada" | null {
  if (!location) return "USA"; // empty location defaults to USA (matches existing UX)
  const tokens = location.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  for (const t of tokens) {
    if (US_TOKENS.has(t)) return "USA";
    if (CA_TOKENS.has(t)) return "Canada";
  }
  for (const t of tokens) {
    if (US_STATES.has(t)) return "USA";
    if (CA_PROVINCES.has(t)) return "Canada";
  }
  return null;
}

// ─── Source: Google Maps Places ──────────────────────────────────────────────
async function queryGoogleMaps(keyword: string, location: string, apiKey: string): Promise<Business[]> {
  const key = apiKey || GOOGLE_MAPS_KEY;
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", `${keyword} ${location}`);
  url.searchParams.set("key", key);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`gmaps ${res.status}`);
  const data = await res.json();
  const results = (data.results || []) as any[];
  return results.slice(0, 60).map((r): Business => {
    const comps = String(r.formatted_address || "").split(",").map((s) => s.trim());
    return {
      name: r.name,
      address: r.formatted_address,
      lat: r.geometry?.location?.lat,
      lng: r.geometry?.location?.lng,
      city: comps.length >= 3 ? comps[comps.length - 3] : location.split(",")[0]?.trim(),
      industry: (r.types || [])[0],
      phone: r.formatted_phone_number,
      rating: r.rating,
      review_count: r.user_ratings_total,
      website: r.website,
      sources: ["google_maps"],
      raw: { google_maps: r },
    };
  });
}

// ─── Source: Apollo.io ────────────────────────────────────────────────────────
// Two-step: People Search (credit-free) finds candidates by role,
// then we map the orgs found from those people into Business records.
// Per-contact enrichment (people/match) is called later for confirmed
// decision-makers — that endpoint consumes credits.
async function queryApollo(keyword: string, location: string, apiKey: string): Promise<Business[]> {
  const res = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey, "Cache-Control": "no-cache" },
    body: JSON.stringify({
      q_keywords: keyword,
      person_locations: [location],
      person_titles: ["owner", "ceo", "founder", "co-founder", "president", "managing director", "principal"],
      page: 1,
      per_page: 50,
    }),
  });
  if (!res.ok) throw new Error(`apollo ${res.status}`);
  const data = await res.json();
  const people = data.people || data.contacts || [];
  // Group people by org so each org becomes one Business with its top decision maker pre-filled
  const byOrg = new Map<string, any[]>();
  for (const p of people) {
    const orgName = p.organization?.name || p.organization_name;
    if (!orgName) continue;
    const k = orgName.toLowerCase();
    if (!byOrg.has(k)) byOrg.set(k, []);
    byOrg.get(k)!.push(p);
  }
  return Array.from(byOrg.values()).map((peopleAtOrg): Business => {
    const top = peopleAtOrg[0];
    const o = top.organization || {};
    return {
      name: o.name || top.organization_name,
      city: top.city || o.city || location.split(",")[0]?.trim(),
      state: top.state || o.state,
      country: top.country || o.country,
      website: o.website_url,
      domain: o.primary_domain,
      industry: o.industry,
      employee_count: o.estimated_num_employees,
      founded_year: o.founded_year,
      description: o.short_description,
      contact_name: [top.first_name, top.last_name].filter(Boolean).join(" ") || top.name,
      contact_title: top.title,
      linkedin_url: top.linkedin_url,
      sources: ["apollo"],
      raw: { apollo: { top, org: o, all_people: peopleAtOrg } },
    };
  });
}

// Per-contact enrichment (use only on confirmed decision-makers, costs credits)
async function apolloEnrichPerson(args: {
  firstName?: string; lastName?: string; companyName?: string; domain?: string;
}, apiKey: string): Promise<{ email?: string; emails?: string[]; phones?: string[]; linkedin?: string } | null> {
  const res = await fetch("https://api.apollo.io/api/v1/people/match", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({
      first_name: args.firstName,
      last_name: args.lastName,
      organization_name: args.companyName,
      domain: args.domain,
      reveal_personal_emails: true,
      reveal_phone_number: true,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const p = data.person;
  if (!p) return null;
  return {
    email: p.email,
    emails: [p.email, ...(p.personal_emails || [])].filter(Boolean),
    phones: (p.phone_numbers || []).map((x: any) => x.sanitized_number || x.raw_number).filter(Boolean),
    linkedin: p.linkedin_url,
  };
}

// ─── Source: Seamless.ai public API ──────────────────────────────────────────
//
// Corrected against the published spec. The previous implementation posted to
// /v2/contacts/search with an `Authorization: Bearer` header and a
// {keyword, location, titles} body — wrong path, wrong auth scheme, wrong body
// shape — which is why every call returned 404 and the source silently
// contributed nothing.
//
// Real contract: POST /api/client/v1/contacts/search, `Token: <key>` header,
// structured filters, and results under `data` with `supplementalData` paging.
// Search does not consume credits; only /contacts/research does. So this is a
// free way to get named owners with LinkedIn URLs, which is exactly what the
// SERP-based hunt struggles to infer.
const SEAMLESS_API = "https://api.seamless.ai/api/client/v1";

/** Seamless filters on full state names, but locations arrive as codes. */
const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

/** US state name out of "Miami, FL, USA" or "Texas, USA". */
function stateFromLocation(location: string): string | null {
  const parts = (location || "").split(",").map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    if (/^usa?$/i.test(p)) continue;
    const byCode = US_STATE_NAMES[p.toUpperCase()];
    if (byCode) return byCode;
    const known = Object.values(US_STATE_NAMES).find((n) => n.toLowerCase() === p.toLowerCase());
    if (known) return known;
  }
  return null;
}

async function querySeamless(keyword: string, location: string, apiKey: string): Promise<Business[]> {
  const state = stateFromLocation(location);
  const res = await fetch(`${SEAMLESS_API}/contacts/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Token: apiKey },
    body: JSON.stringify({
      limit: 50,
      // Owners and principals only — the whole point of this source is the
      // decision maker, not another switchboard number.
      seniority: ["C-Level"],
      jobTitle: ["Owner", "CEO", "Founder", "President", "Managing Director"],
      contactKeyword: keyword ? [keyword] : undefined,
      ...(state ? { contactState: [state], locationType: "bothOR" } : {}),
    }),
  });
  if (!res.ok) throw new Error(`seamless ${res.status}`);
  const data = await res.json();
  const contacts = data.data || data.contacts || [];
  const byOrg = new Map<string, any[]>();
  // Search results are flat: `company` is a string, `name` is the person, and
  // `liUrl` is their LinkedIn. Emails and phones are deliberately absent —
  // those come from /contacts/research, which is the step that costs credits.
  for (const c of contacts) {
    const orgName: string | undefined = typeof c.company === "string" ? c.company : c.company?.name;
    if (!orgName) continue;
    const k = orgName.toLowerCase();
    if (!byOrg.has(k)) byOrg.set(k, []);
    byOrg.get(k)!.push({ ...c, __org: orgName });
  }
  return Array.from(byOrg.values()).map((list): Business => {
    // Prefer the most senior title when a company returns several people.
    const top = list.find((c: any) => /owner|founder|ceo|president/i.test(c.title || "")) || list[0];
    return {
      name: top.__org,
      city: top.companyCity || top.city || location.split(",")[0]?.trim(),
      state: top.companyState || top.state,
      country: top.companyCountry || "USA",
      domain: top.domain,
      website: top.domain ? `https://${top.domain}` : undefined,
      industry: Array.isArray(top.industries) ? top.industries[0] : top.industry,
      contact_name: top.name || null,
      contact_title: top.title,
      linkedin_url: top.liUrl,
      emails_found: [],
      phones_found: [],
      sources: ["seamless"],
      // searchResultId is what /contacts/research needs to fetch the email and
      // phone later, so keep it rather than discarding the handle.
      raw: {
        seamless: {
          searchResultId: top.searchResultId,
          companyLinkedIn: top.companyLIProfileUrl,
          revenueRange: top.companyRevenue ?? top.companyRevenueRange,
          people: list.length,
        },
      },
    };
  });
}


// ─── Source: Leads Gorilla (best-effort generic shape) ────────────────────────
async function queryLeadsGorilla(keyword: string, location: string, apiKey: string): Promise<Business[]> {
  const res = await fetch("https://api.leadsgorilla.com/v1/businesses/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ keyword, location, limit: 50 }),
  });
  if (!res.ok) throw new Error(`leads_gorilla ${res.status}`);
  const data = await res.json();
  const list = data.businesses || data.data || [];
  return list.map((b: any): Business => ({
    name: b.name,
    city: b.city || location.split(",")[0]?.trim(),
    phone: b.phone,
    website: b.website,
    industry: b.category,
    rating: b.rating,
    sources: ["leads_gorilla"],
    raw: { leads_gorilla: b },
  }));
}

// ─── Source: Clay (company search) ───────────────────────────────────────────
async function queryClay(keyword: string, location: string, apiKey: string): Promise<Business[]> {
  const res = await fetch("https://api.clay.com/v1/companies/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query: keyword, location, limit: 50 }),
  });
  if (!res.ok) throw new Error(`clay ${res.status}`);
  const data = await res.json();
  const list = data.companies || data.results || data.data || [];
  return list.map((c: any): Business => ({
    name: c.name || c.company_name,
    city: c.city || c.location?.city || location.split(",")[0]?.trim(),
    website: c.website || c.domain,
    industry: Array.isArray(c.industries) ? c.industries[0] : (c.industry || c.category),
    phone: c.phone,
    sources: ["clay"],
    raw: { clay: c },
  }));
}

// ─── Source: AI Ark (AI-powered company/people search) ───────────────────────
async function queryAIArk(keyword: string, location: string, apiKey: string, endpoint: string): Promise<Business[]> {
  if (!endpoint) throw new Error("ai_ark endpoint not configured");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query: keyword, location, limit: 50 }),
  });
  if (!res.ok) throw new Error(`ai_ark ${res.status}`);
  const data = await res.json();
  const list = data.results || data.companies || data.data || data.items || [];
  return list.map((c: any): Business => ({
    name: c.name || c.company || c.company_name,
    city: c.city || c.location || location.split(",")[0]?.trim(),
    website: c.website || c.url,
    industry: c.industry || c.category,
    phone: c.phone,
    emails_found: c.email ? [{ email: c.email, source: "ai_ark" }] : [],
    sources: ["ai_ark"],
    raw: { ai_ark: c },
  }));
}

// ─── Source: Apify (web scraping actor) ──────────────────────────────────────
async function queryApify(keyword: string, location: string, apiKey: string, actorId: string): Promise<Business[]> {
  if (!actorId) throw new Error("apify actor_id not configured");
  // Run actor synchronously and wait for dataset items
  const runRes = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ search: keyword, query: keyword, location, maxItems: 50 }),
  });
  if (!runRes.ok) throw new Error(`apify ${runRes.status}`);
  const list = await runRes.json();
  if (!Array.isArray(list)) return [];
  return list.map((c: any): Business => ({
    name: c.name || c.title || c.businessName || c.company,
    city: c.city || c.address?.city || location.split(",")[0]?.trim(),
    website: c.website || c.url || c.domain,
    phone: c.phone || c.phoneNumber,
    industry: c.category || c.industry,
    emails_found: c.email ? [{ email: c.email, source: "apify" }] : [],
    sources: ["apify"],
    raw: { apify: c },
  }));
}

// ─── Source: Firecrawl (free web scraping) ───────────────────────────────────
const DIRECTORY_SITES_RX = /yelp|yellowpages|bbb|houzz|angi|thumbtack|bark\.com|facebook\.com|linkedin\.com|instagram\.com|twitter\.com|x\.com|reddit\.com|google\.com|bing\.com|mapquest|tripadvisor|trustpilot/i;

async function queryFirecrawl(keyword: string, location: string, apiKey: string): Promise<Business[]> {
  const query = location
    ? `${keyword} businesses in ${location} contact website`
    : `${keyword} businesses contact website`;
  const res = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ query, limit: 10 }),
  });
  if (!res.ok) throw new Error(`firecrawl ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(`firecrawl: ${(data as any).error || "unknown"}`);
  const results: Business[] = [];
  for (const item of (data.data || [])) {
    const url = item.url as string;
    if (!url) continue;
    try {
      const domain = new URL(url).hostname.replace(/^www\./, "");
      if (DIRECTORY_SITES_RX.test(domain)) continue;
      const title = (item.metadata?.title || "") as string;
      const desc = (item.metadata?.description || "") as string;
      const name = title.split(/[|\-–—]/)[0]?.trim() || domain.split(".")[0];
      if (!name || name.length < 2) continue;
      results.push({
        name,
        website: url,
        domain,
        description: desc || undefined,
        city: location ? location.split(",")[0]?.trim() : undefined,
        sources: ["firecrawl"],
        raw: { firecrawl: item },
      });
    } catch { /* skip malformed URLs */ }
  }
  return results;
}

// ─── Hunter.io free email discovery ──────────────────────────────────────────
async function hunterDomainSearch(domain: string, apiKey: string): Promise<{ email: string; first_name?: string; last_name?: string; position?: string }[]> {
  try {
    const params = new URLSearchParams({ domain, api_key: apiKey, limit: "10" });
    const res = await fetch(`https://api.hunter.io/v2/domain-search?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return ((data.data?.emails || []) as any[])
      .filter((e: any) => (e.confidence || 0) >= 50)
      .map((e: any) => ({
        email: e.value as string,
        first_name: e.first_name as string | undefined,
        last_name: e.last_name as string | undefined,
        position: e.position as string | undefined,
      }));
  } catch {
    return [];
  }
}

async function hunterEmailFinder(firstName: string, lastName: string, domain: string, apiKey: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ domain, first_name: firstName, last_name: lastName, api_key: apiKey });
    const res = await fetch(`https://api.hunter.io/v2/email-finder?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const email = data.data?.email as string | undefined;
    const score = (data.data?.score || 0) as number;
    return email && score >= 40 ? email : null;
  } catch {
    return null;
  }
}

// Hunter combined/find — enriches a known email with person + company data
async function hunterCombinedFind(email: string, apiKey: string): Promise<{ first_name?: string; last_name?: string; position?: string; linkedin?: string; company?: string } | null> {
  try {
    const params = new URLSearchParams({ email, api_key: apiKey });
    const res = await fetch(`https://api.hunter.io/v2/combined/find?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const person = data?.data?.person;
    const company = data?.data?.company;
    if (!person && !company) return null;
    return {
      first_name: person?.name?.givenName,
      last_name: person?.name?.familyName,
      position: person?.employment?.title,
      linkedin: person?.linkedin?.handle ? `https://linkedin.com/in/${person.linkedin.handle}` : undefined,
      company: company?.name,
    };
  } catch {
    return null;
  }
}


// ─── FREE decision-maker hunt via Serper (LinkedIn / BiggerPockets / FB / web)
// ─── Free web search (no API key) ────────────────────────────────────────────
// Unified search: Serper first (if key present), then Firecrawl search, then
// the legacy direct-scrape tiers. Returns a normalized organic array.
type WebResult = { title: string; snippet: string; link: string };

// Firecrawl's search endpoint. Unlike raw SERP scraping it runs server-side
// behind their own anti-bot handling, so it keeps working from datacenter IPs
// (Supabase Edge Functions) where Google/DDG/Bing/Mojeek all serve challenge
// pages instead of results.
async function firecrawlSearch(
  q: string,
  apiKey: string,
  num: number,
  timeoutMs: number,
): Promise<WebResult[]> {
  const res = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query: q, limit: num }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`firecrawl search ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(`firecrawl search: ${data.error || "unknown"}`);
  // Firecrawl returns title/description either top-level or under metadata
  // depending on whether the result was scraped; accept both shapes.
  return ((data.data || []) as any[]).map((item) => ({
    title: (item.title || item.metadata?.title || "") as string,
    snippet: (item.description || item.metadata?.description || item.markdown || "") as string,
    link: (item.url || item.metadata?.sourceURL || "") as string,
  })).filter((r) => r.link);
}

// ─── Rate-limit circuit breaker ──────────────────────────────────────────────
// A provider that answered 429 will answer 429 to the next call too, and the
// one after that. Retrying into it is not merely wasteful: each attempt eats
// wall clock from a step deadline, which is how a rate limit turns into a
// decision-maker step that appears to hang and then dies with nothing found.
// Once a provider rate-limits us, it is skipped until the cooldown passes.
const rateLimitedUntil: Record<string, number> = {};
const RATE_LIMIT_COOLDOWN_MS = 120_000;
// Consecutive timeouts are the other face of saturation. Counted separately so
// one slow query doesn't sideline a provider that is otherwise answering.
let firecrawlTimeouts = 0;

function isRateLimited(provider: string): boolean {
  const until = rateLimitedUntil[provider];
  return typeof until === "number" && Date.now() < until;
}

function markRateLimited(provider: string) {
  rateLimitedUntil[provider] = Date.now() + RATE_LIMIT_COOLDOWN_MS;
}

/** True when this run has been throttled and results will be thin. */
export function searchProviderThrottled(): boolean {
  return isRateLimited("firecrawl") || isRateLimited("serper");
}

async function webSearch(
  q: string,
  opts: {
    serperKey?: string | null;
    firecrawlKey?: string | null;
    num?: number;
    timeoutMs?: number;
    // When present, paid tiers are skipped once the run hits its spend ceiling
    // and each paid call that does happen is written to the cost ledger.
    budget?: RunBudget;
  } = {},
): Promise<{ organic: WebResult[]; source: "cache" | "serper" | "firecrawl" | "duckduckgo" | "google" | "none" }> {
  const num = opts.num ?? 8;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const budget = opts.budget;

  // 0) Cache. Checked before every paid tier, because a repeat query is the
  // most common call this function receives — the same city gets searched
  // again next week, the same directory query is issued once per keyword, and
  // a retried run reissues the lot. A hit costs nothing and records nothing to
  // the ledger, which is the entire point.
  const cached = await getCachedSearch(SUPABASE, q);
  if (cached && cached.length) return { organic: cached, source: "cache" };

  // 1) Serper (paid, best signal)
  if (opts.serperKey && !isRateLimited("serper") && (!budget || budget.canSpend("serper_search"))) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": opts.serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q, num }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429) markRateLimited("serper");
      if (res.ok) {
        const data = await res.json();
        const organic = ((data.organic || []) as any[]).map((r) => ({
          title: r.title || "", snippet: r.snippet || "", link: r.link || "",
        }));
        // Fold in knowledge graph / answer box text as a synthetic result so
        // downstream regex extractors can pull phones/emails out of it.
        const kg = data.knowledgeGraph || data.answerBox;
        if (kg) organic.push({ title: kg.title || "", snippet: JSON.stringify(kg), link: kg.website || "" });
        if (organic.length) {
          await budget?.record("serper", "serper_search");
          await putCachedSearch(SUPABASE, q, "serper", organic);
          return { organic, source: "serper" };
        }
        // Configured, authorised, and genuinely nothing to return. That is an
        // ANSWER, not a failure — the ladder is full of narrow site: queries
        // that correctly match nothing. Asking a second provider the same
        // question just buys the same empty answer at a higher price, and it
        // was generating almost all of our rate-limit errors.
        await budget?.record("serper", "serper_search", 1, false, "no organic results");
        return { organic: [], source: "serper" };
      } else {
        // A rejected key used to fall through in silence, leaving no trace in
        // the ledger — indistinguishable from having configured no key at all.
        // Record it, because "the key is wrong" and "there is no key" need
        // very different fixes and only one of them is obvious from the UI.
        const body = await res.text().catch(() => "");
        await budget?.record("serper", "serper_search", 1, false, `serper ${res.status}: ${body.slice(0, 200)}`);
      }
    } catch (e) {
      await budget?.record("serper", "serper_search", 1, false, `serper request failed: ${String(e).slice(0, 200)}`);
    }
  }

  // 1b) Firecrawl search — the working fallback when no Serper key is set.
  if (opts.firecrawlKey && !isRateLimited("firecrawl") && (!budget || budget.canSpend("firecrawl_search"))) {
    try {
      // Firecrawl runs a real browser server-side, so it is inherently slower
      // than a SERP API — commonly 8-12s where Serper answers in under one.
      // The callers' 5.5s budget is tuned for Serper and was cutting Firecrawl
      // off mid-flight: the request had already been billed, and we threw the
      // answer away. Give it a floor that matches how it actually behaves.
      const firecrawlTimeout = Math.max(timeoutMs, 15_000);
      const organic = await firecrawlSearch(q, opts.firecrawlKey, num, firecrawlTimeout);
      await budget?.record("firecrawl", "firecrawl_search", 1, organic.length > 0);
      if (organic.length) {
        await putCachedSearch(SUPABASE, q, "firecrawl", organic);
        return { organic, source: "firecrawl" };
      }
    } catch (e) {
      const msg = String(e);
      // 429 means the plan's rate limit is exhausted, not that this query
      // failed. Trip the breaker so the remaining lookups in this run fail
      // fast instead of spending the step's whole deadline being refused.
      // Repeated timeouts mean the same thing in practice — the provider is
      // saturated — so treat a run of them the same way rather than spending
      // 15 seconds per business discovering it again.
      if (msg.includes("429")) markRateLimited("firecrawl");
      else if (/timed out|TimeoutError|aborted/i.test(msg)) {
        firecrawlTimeouts++;
        if (firecrawlTimeouts >= 3) markRateLimited("firecrawl");
      }
      await budget?.record("firecrawl", "firecrawl_search", 1, false, msg);
    }
  }

  // NOTE: the direct-scrape tiers below are retained as a last resort only.
  // As of 2026-07 they are effectively dead — Google serves an "enablejs"
  // page, DuckDuckGo returns an anti-bot challenge, Bing a proof-of-work
  // challenge, and Mojeek a captcha. They are kept because they cost nothing
  // to attempt, but a Serper or Firecrawl key is required in practice.
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

  // 2) DuckDuckGo HTML (free, no key)
  try {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const html = await res.text();
      const results: WebResult[] = [];
      // DDG HTML result blocks
      const rx = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(html)) !== null && results.length < num) {
        let link = m[1];
        // DDG wraps links: /l/?uddg=<encoded>
        const uddg = link.match(/[?&]uddg=([^&]+)/);
        if (uddg) { try { link = decodeURIComponent(uddg[1]); } catch { /* keep */ } }
        const title = m[2].replace(/<[^>]+>/g, "").trim();
        const snippet = m[3].replace(/<[^>]+>/g, "").trim();
        if (link.startsWith("http")) results.push({ title, snippet, link });
      }
      if (results.length) return { organic: results, source: "duckduckgo" };
    }
  } catch { /* fall through */ }

  // 3) Google HTML SERP (last resort, matches the example URL the user gave)
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=${num}&hl=en&pws=0`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const html = await res.text();
      const results: WebResult[] = [];
      // Parse Google result blocks. Two common shapes covered.
      // Shape 1: <a href="/url?q=<real>&...">...<h3>Title</h3>...</a>
      const rx = /<a href="\/url\?q=([^&"]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>([\s\S]{0,600}?)(?=<a href="\/url\?q=|<\/div><\/div>)/g;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(html)) !== null && results.length < num) {
        let link = m[1];
        try { link = decodeURIComponent(link); } catch { /* keep */ }
        if (!link.startsWith("http")) continue;
        if (/google\.com|gstatic\.com|googleusercontent\.com/.test(link)) continue;
        const title = m[2].replace(/<[^>]+>/g, "").trim();
        const snippetHtml = m[3];
        // Snippet lives in a div right after the anchor
        const snipMatch = snippetHtml.match(/<div[^>]*>([\s\S]*?)<\/div>/);
        const snippet = (snipMatch ? snipMatch[1] : snippetHtml).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
        results.push({ title, snippet, link });
      }
      if (results.length) return { organic: results, source: "google" };
    }
  } catch { /* fall through */ }

  return { organic: [], source: "none" };
}

async function serperFreeDmHunt(
  companyName: string,
  location: string | null,
  serperKey: string | null,
  firecrawlKey: string | null = null,
  budget?: RunBudget,
  deadlineMs?: number,
): Promise<{ name: string; title: string; source: string; linkedin_url?: string } | null> {
  const loc = location || "USA";
  const stateToken = loc.split(",").map((part) => part.trim()).find((part) => /^[A-Z]{2}$/.test(part)) || "";
  const queries = [
    { source: "linkedin_people", q: `site:linkedin.com/in "${companyName}" (CEO OR Owner OR Founder OR President) ${loc}` },
    { source: "linkedin_company", q: `site:linkedin.com/in "${companyName}" "${loc}" (owner OR founder OR president)` },
    { source: "google_role", q: `"${companyName}" (owner OR founder OR CEO OR president) ${loc}` },
    { source: "company_about", q: `"${companyName}" (about OR team OR leadership) (owner OR founder OR CEO) ${loc}` },
    { source: "state_registry", q: `"${companyName}" "Secretary of State" ${stateToken || loc}` },
    { source: "opencorporates", q: `"${companyName}" site:opencorporates.com ${stateToken || loc}` },
    { source: "bizapedia", q: `"${companyName}" site:bizapedia.com ${stateToken || loc}` },
    { source: "facebook", q: `site:facebook.com "${companyName}" (owner OR founder) ${loc}` },
    { source: "owner_responses", q: `"${companyName}" "owner" "response" ${loc}` },
    { source: "wide_web", q: `${companyName} ${loc} owner founder CEO president` },
  ];
  const ROLE_RX = /\b(CEO|Owner|Founder|Co[- ]?Founder|President|Principal|Managing\s+Partner|Chief\s+\w+|Director)\b/i;

  /** Pull a person out of one result set, or null if nothing qualifies. */
  const extract = (
    organic: WebResult[],
    fallbackSource: string,
  ): { name: string; title: string; source: string; linkedin_url?: string } | null => {
    for (const r of organic) {
      const blob = `${r.title || ""} ${r.snippet || ""} ${r.link || ""}`;
      const roleMatch = blob.match(ROLE_RX);
      if (!roleMatch) continue;
      const titleParts = (r.title || "").split(/[-–—|·]/).map((s: string) => s.trim()).filter(Boolean);
      const candidateName = titleParts.find((part) => {
        const words = part.trim().split(/\s+/);
        return words.length >= 2 && words.length <= 5 && /^[A-Z][a-zA-Z'\-.]+(?:\s+[A-Z][a-zA-Z'\-.]+)+$/.test(part);
      }) || "";
      const words = candidateName.trim().split(/\s+/);
      if (words.length < 2 || words.length > 5) continue;
      if (candidateName.length < 4 || candidateName.length > 60) continue;
      if (/^[\d\W]+$/.test(candidateName)) continue;
      if (/^(the|a|an|in|at|of|for|with|by|from|and|or)$/i.test(words[0])) continue;
      if (!strictIdentityMatch(blob, candidateName, companyName, loc.split(",")[0]?.trim())) continue;
      const source = (r.link || "").includes("linkedin.com") ? "linkedin"
        : (r.link || "").includes("facebook.com") ? "facebook"
        : fallbackSource;
      return {
        name: candidateName,
        title: roleMatch[0],
        source,
        linkedin_url: source === "linkedin" ? r.link : undefined,
      };
    }
    return null;
  };

  // Run the queries in small parallel waves rather than one at a time. Ten
  // sequential lookups is ~55s per business, which is what pushed the whole
  // step past the edge function's wall clock. Waves keep the query priority
  // order intact — earlier entries are higher-signal — while cutting the time
  // to first answer roughly threefold, and most businesses resolve on wave one.
  const WAVE = 3;
  for (let i = 0; i < queries.length; i += WAVE) {
    if (deadlineMs && Date.now() > deadlineMs) return null;
    // Once the spend ceiling is reached further lookups can only return
    // nothing, so stop instead of iterating pointlessly.
    if (budget && !budget.canSpend("firecrawl_search", WAVE)) return null;

    const wave = queries.slice(i, i + WAVE);
    const settled = await Promise.allSettled(
      wave.map((item) =>
        webSearch(item.q, { serperKey, firecrawlKey, num: 8, timeoutMs: 5500, budget })
          .then(({ organic }) => extract(organic, item.source)),
      ),
    );
    // Take the earliest hit within the wave so query priority still decides.
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) return s.value;
    }
  }
  return null;
}

// ─── FREE skip-trace via open-web search (Serper + Firecrawl) ────────────────
// Instead of scraping CAPTCHA-protected people-search sites (TruePeopleSearch,
// ThatsThem, CyberBackgroundChecks), we Google-search the person's name +
// company across the entire open internet, then scrape the top results and
// extract phone numbers & emails from those pages. Also scrapes the company's
// own website contact/about pages as a high-value free source.
const GLOBAL_PHONE_RX =
  /(?:(?:\+|00)\d{1,3}[\s.\-]?)?(?:\(\d{1,4}\)[\s.\-]?)?\d{2,4}(?:[\s.\-]?\d{2,4}){1,4}/g;

function normalizePhoneToken(raw: string): string | null {
  const hadPlus = /^\s*(?:\+|00)/.test(raw);
  let digits = raw.replace(/\D/g, "");
  if (hadPlus && digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `+${digits}`;
}

function extractPhones(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(GLOBAL_PHONE_RX)) {
    const norm = normalizePhoneToken(m[0]);
    if (norm) out.add(norm);
  }
  return Array.from(out);
}

async function freeSkiptraceViaWeb(
  args: { name: string; company?: string; city?: string | null; state?: string | null; website?: string | null },
  serperKey: string | null,
  firecrawlKey: string | null,
  deadlineMs?: number,
): Promise<{ phones: string[]; emails: string[]; sources: string[] }> {
  const overBudget = () => typeof deadlineMs === "number" && Date.now() > deadlineMs;
  const EMAIL_RX2 = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const JUNK_EMAIL_RX = /example\.com|sentry|wixpress|cloudflare|domain\.com|sentry\.io|googleapis|schema\.org|w3\.org|placeholder|noreply|no-reply|mailer-daemon/i;
  const JUNK_DOMAIN_RX = /facebook\.com|linkedin\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|google\.com|bing\.com|yahoo\.com|reddit\.com|wikipedia\.org|github\.com|pinterest\.com|tiktok\.com|apple\.com|microsoft\.com|amazon\.com/i;

  const allPhones = new Set<string>();
  const allEmails = new Set<string>();
  const okSources: string[] = [];

  const loc = [args.city, args.state].filter(Boolean).join(", ");

  // ─── Strategy 1: web search (Serper → DuckDuckGo → Google SERP) ─────────
  const queries = [
    `"${args.name}" "${args.company || ""}" phone email contact`,
    `"${args.name}" ${args.company || ""} ${loc} phone OR email OR contact`,
    `"${args.name}" ${loc} phone number email address`,
    // Loose match on the raw name + company (mirrors user's example URL)
    `${args.name} ${args.company || ""}${loc ? ` ${loc}` : ""}`,
  ].filter(q => q.trim().length > 10);

  for (const q of queries) {
    if (overBudget()) break;
    try {
      const { organic, source } = await webSearch(q, { serperKey, firecrawlKey, num: 10, timeoutMs: 5000 });
      if (!organic.length) continue;

      for (const r of organic) {
        const blob = `${r.title || ""} ${r.snippet || ""}`;
        for (const ph of extractPhones(blob)) allPhones.add(ph);
        for (const m of blob.matchAll(EMAIL_RX2)) {
          const email = m[0].toLowerCase();
          if (!JUNK_EMAIL_RX.test(email)) {
            try {
              const emailDomain = email.split("@")[1];
              if (!JUNK_DOMAIN_RX.test(emailDomain)) allEmails.add(email);
            } catch { /* skip */ }
          }
        }
      }

      if (allPhones.size > 0 || allEmails.size > 0) {
        const tag = source === "serper" ? "serper_web" : source === "duckduckgo" ? "duckduckgo_web" : "google_web";
        if (!okSources.includes(tag)) okSources.push(tag);
      }

      // ─── Scrape top non-social results with Firecrawl ──
      if (firecrawlKey) {
        const urlsToScrape: string[] = [];
        for (const r of organic) {
          if (!r.link) continue;
          try {
            const host = new URL(r.link).hostname.toLowerCase();
            if (JUNK_DOMAIN_RX.test(host)) continue;
            if (/truepeoplesearch|thatsthem|cyberbackgroundchecks|spokeo|whitepages|beenverified|intelius|peoplefinder|fastpeoplesearch|zabasearch/i.test(host)) continue;
            urlsToScrape.push(r.link);
          } catch { /* skip */ }
        }
        for (const pageUrl of urlsToScrape.slice(0, 2)) {
          if (overBudget()) break;
          try {
            const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${firecrawlKey}` },
              body: JSON.stringify({ url: pageUrl, formats: ["markdown"], onlyMainContent: true, waitFor: 1500, timeout: 8000 }),
              signal: AbortSignal.timeout(10000),
            });
            if (!scrapeRes.ok) continue;
            const scrapeData = await scrapeRes.json();
            const md: string = scrapeData?.data?.markdown || "";
            if (!md || md.length < 50) continue;
            for (const ph of extractPhones(md)) allPhones.add(ph);
            for (const m of md.matchAll(EMAIL_RX2)) {
              const email = m[0].toLowerCase();
              if (!JUNK_EMAIL_RX.test(email)) {
                try {
                  const emailDomain = email.split("@")[1];
                  if (!JUNK_DOMAIN_RX.test(emailDomain)) allEmails.add(email);
                } catch { /* skip */ }
              }
            }
            if (!okSources.includes("firecrawl_web")) okSources.push("firecrawl_web");
          } catch { /* skip page */ }
        }
      }

      // If we already found good data, stop searching
      if (allPhones.size >= 2 || allEmails.size >= 2) break;
    } catch { /* try next query */ }
  }

  // ─── Strategy 2: Scrape the company's own website contact/about page ──
  if (firecrawlKey && args.website) {
    const baseUrl = args.website.startsWith("http") ? args.website : `https://${args.website}`;
    const contactPages = [
      baseUrl,
      `${baseUrl.replace(/\/+$/, "")}/contact`,
      `${baseUrl.replace(/\/+$/, "")}/about`,
      `${baseUrl.replace(/\/+$/, "")}/contact-us`,
      `${baseUrl.replace(/\/+$/, "")}/about-us`,
    ];
    for (const pageUrl of contactPages) {
      if (overBudget()) break;
      try {
        const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${firecrawlKey}` },
          body: JSON.stringify({ url: pageUrl, formats: ["markdown"], onlyMainContent: true, waitFor: 1500, timeout: 8000 }),
          signal: AbortSignal.timeout(10000),
        });
        if (!scrapeRes.ok) continue;
        const scrapeData = await scrapeRes.json();
        const md: string = scrapeData?.data?.markdown || "";
        if (!md || md.length < 30) continue;
        for (const ph of extractPhones(md)) allPhones.add(ph);
        for (const m of md.matchAll(EMAIL_RX2)) {
          const email = m[0].toLowerCase();
          if (!JUNK_EMAIL_RX.test(email)) {
            try {
              const emailDomain = email.split("@")[1];
              if (!JUNK_DOMAIN_RX.test(emailDomain)) allEmails.add(email);
            } catch { /* skip */ }
          }
        }
        if (!okSources.includes("company_website")) okSources.push("company_website");
        // If we found data from the company site, that's high quality — stop
        if (allPhones.size > 0 || allEmails.size > 0) break;
      } catch { /* try next page */ }
    }
  }

  return {
    phones: Array.from(allPhones).slice(0, 5),
    emails: Array.from(allEmails).slice(0, 5),
    sources: okSources,
  };
}

// ─── Lusha paid enrichment (fallback after Hunter) ────────────────────────────
async function lushaEnrichPerson(
  args: { firstName?: string; lastName?: string; company?: string },
  apiKey: string,
): Promise<{ emails: string[]; phones: string[] } | null> {
  try {
    const params = new URLSearchParams();
    if (args.firstName) params.set("firstName", args.firstName);
    if (args.lastName) params.set("lastName", args.lastName);
    if (args.company) params.set("company", args.company);
    const res = await fetch(`https://api.lusha.co/person?${params}`, {
      headers: { "api_key": apiKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const emails = ((data.emailAddresses || []) as any[])
      .map((e: any) => (typeof e === "string" ? e : e.emailAddress))
      .filter(Boolean) as string[];
    const phones = ((data.phoneNumbers || []) as any[])
      .map((p: any) => (typeof p === "string" ? p : (p.internationalNumber || p.localNumber)))
      .filter(Boolean) as string[];
    return { emails, phones };
  } catch {
    return null;
  }
}

// ─── Email validation: syntax + MX (DNS-over-HTTPS) ──────────────────────────
const EMAIL_RX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
async function checkMx(domain: string): Promise<boolean> {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=MX`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return false;
    const j = await r.json();
    return Array.isArray(j.Answer) && j.Answer.length > 0;
  } catch {
    return false;
  }
}

// ─── Mailbox-level verification via MillionVerifier ──────────────────────────
// checkMx() above only proves the DOMAIN accepts mail, which is why
// pattern-generated addresses still bounce. This checks the actual mailbox.
// Returns null when we can't get a definitive answer (no key, timeout, unknown),
// so callers can fall back to MX-only behaviour instead of dropping good leads.
type MvResult = { deliverable: boolean; result: string };
async function verifyEmailMillionVerifier(
  email: string,
  apiKey: string,
): Promise<MvResult | null> {
  try {
    const url = `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}&timeout=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const j = await res.json();
    const result = String(j.result || "").toLowerCase();
    // "ok" = deliverable. "catch_all" and "unknown" are indeterminate, not proof
    // of failure, so we treat them as inconclusive rather than dropping them.
    if (result === "ok") return { deliverable: true, result };
    if (result === "invalid" || result === "disposable") return { deliverable: false, result };
    return null;
  } catch {
    return null;
  }
}

function generatePatterns(firstName: string, lastName: string, domain: string): string[] {
  const f = firstName.toLowerCase();
  const l = lastName.toLowerCase();
  const fi = f[0] || "";
  const li = l[0] || "";
  return [
    `${f}@${domain}`,
    `${f}.${l}@${domain}`,
    `${fi}.${l}@${domain}`,
    `${fi}${l}@${domain}`,
    `${l}@${domain}`,
    `${f}_${l}@${domain}`,
    `info@${domain}`,
    `owner@${domain}`,
    `ceo@${domain}`,
    `contact@${domain}`,
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SUPABASE = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// ─── Paid-API credit probes ───────────────────────────────────────────────────
// Returns remaining balance for each provider. -1 = unknown / probe failed (we still try).
// 0 = quota exhausted — skip all calls.
async function probeHunterCredits(key: string): Promise<number> {
  try {
    const r = await fetch(`https://api.hunter.io/v2/account?api_key=${key}`);
    if (!r.ok) return -1;
    const j = await r.json();
    const used = j?.data?.requests?.searches?.used ?? 0;
    const avail = j?.data?.requests?.searches?.available ?? 0;
    return Math.max(0, avail - used);
  } catch { return -1; }
}
async function probeApolloCredits(key: string): Promise<number> {
  try {
    const r = await fetch("https://api.apollo.io/v1/auth/health", {
      headers: { "Cache-Control": "no-cache", "Content-Type": "application/json", "X-Api-Key": key },
    });
    if (r.status === 401 || r.status === 403) return 0; // bad key
    if (!r.ok) return -1;
    return -1; // Apollo doesn't expose credits cleanly here; assume unknown
  } catch { return -1; }
}
async function probeLushaCredits(key: string): Promise<number> {
  try {
    const r = await fetch("https://api.lusha.com/credits", { headers: { api_key: key } });
    if (r.status === 401 || r.status === 403) return 0;
    if (!r.ok) return -1;
    const j = await r.json();
    return typeof j?.credits === "number" ? j.credits : -1;
  } catch { return -1; }
}
async function recordCreditSnapshot(teamId: string, provider: string, balance: number, error?: string) {
  try {
    await SUPABASE.from("api_credit_snapshots").insert({
      team_id: teamId,
      provider,
      balance: balance < 0 ? null : balance,
      balance_unit: "credits",
      error: error || null,
      raw: {},
    });
  } catch { /* swallow */ }
}

async function upsertStep(searchId: string, teamId: string, step: StepName, patch: Record<string, any>) {
  const { data: existing } = await SUPABASE
    .from("search_steps")
    .select("id")
    .eq("search_id", searchId)
    .eq("step", step)
    .maybeSingle();
  if (existing) {
    await SUPABASE.from("search_steps").update(patch).eq("id", existing.id);
  } else {
    await SUPABASE.from("search_steps").insert({ search_id: searchId, team_id: teamId, step, ...patch });
  }
}

async function setStepRunning(searchId: string, teamId: string, step: StepName, sub?: string) {
  await upsertStep(searchId, teamId, step, { status: "running", sub_status: sub ?? null, started_at: new Date().toISOString() });
}
async function setStepDone(searchId: string, teamId: string, step: StepName, detail: any, success: string[], failed: string[]) {
  await upsertStep(searchId, teamId, step, {
    status: failed.length && !success.length ? "failed" : "complete",
    sub_status: null,
    detail,
    sources_success: success,
    sources_failed: failed,
    completed_at: new Date().toISOString(),
  });
}

async function logActivity(
  searchId: string,
  teamId: string,
  step: string,
  status: "info" | "running" | "success" | "error",
  icon: string,
  message: string,
  opts?: { count?: number; percent?: number },
) {
  try {
    await SUPABASE.from("search_activity").insert({
      search_id: searchId,
      team_id: teamId,
      step,
      status,
      icon,
      message,
      count: opts?.count ?? null,
      percent: opts?.percent ?? null,
    });
  } catch (e) {
    console.error("logActivity failed", e);
  }
}

// ─── Paid-vendor cost ledger + per-run budget ceiling ────────────────────────
// Users are billed in our own credits; these rows record what a run actually
// costs US, so margin is measurable and one run can't drain the API budget.
// Prices are USD per unit as of 2026-07 — update alongside vendor pricing.
const UNIT_COST_USD: Record<string, number> = {
  firecrawl_search: 0.002,
  firecrawl_scrape: 0.002,
  serper_search: 0.0003,
  apollo_enrich: 0.02,
  seamless_search: 0.02,
  hunter_find: 0.006,
  millionverifier_verify: 0.0004,
  // Owner of record from county property data, priced per address submitted.
  // Roughly an order of magnitude above a search call, and worth it: it returns
  // a named owner instead of a page that might mention one, and it has no rate
  // limit, so it keeps producing decision makers when search is throttled.
  property_owner_lookup: 0.02,
};

class RunBudget {
  spentUsd = 0;
  constructor(
    private searchId: string,
    private teamId: string,
    readonly ceilingUsd: number,
  ) {}

  /** True when another paid call of this kind would still fit in budget. */
  canSpend(operation: string, units = 1): boolean {
    if (this.ceilingUsd <= 0) return false; // 0 = free sources only
    const cost = (UNIT_COST_USD[operation] ?? 0) * units;
    return this.spentUsd + cost <= this.ceilingUsd;
  }

  /** Record a paid call. Never throws — billing telemetry must not break a run. */
  async record(provider: string, operation: string, units = 1, ok = true, error?: string) {
    const unit = UNIT_COST_USD[operation] ?? 0;
    const cost = unit * units;
    this.spentUsd += cost;
    try {
      await SUPABASE.from("api_cost_events").insert({
        team_id: this.teamId,
        search_id: this.searchId,
        search_kind: "discovery",
        provider,
        operation,
        units,
        unit_cost_usd: unit,
        cost_usd: cost,
        ok,
        error: error ?? null,
      });
    } catch (e) {
      console.error("cost ledger insert failed", e);
    }
  }
}

function scoreContact(b: Business, verifiedEmail: boolean, patternVerified: boolean, verifiedPhone: boolean): number {
  let s = 0;
  if (verifiedEmail) s += 25;
  if (patternVerified && !verifiedEmail) s += 15;
  if (verifiedPhone) s += 25;
  if (b.linkedin_url) s += 15;
  if (b.instagram_url) s += 5;
  if (b.facebook_url) s += 5;
  if (b.employee_count) s += 5;
  if (b.rating) s += 3;
  if ((b.sources || []).length >= 2) s += 5;
  if (b.description) s += 2;
  if (b.founded_year) s += 3;
  if (b.services && b.services.length) s += 2;
  return Math.min(100, s);
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { search_id } = await req.json();
    if (!search_id) return new Response("missing search_id", { status: 400, headers: corsHeaders });

    const { data: search } = await SUPABASE.from("searches").select("team_id").eq("id", search_id).maybeSingle();
    if (!search) return new Response("not found", { status: 404, headers: corsHeaders });

    // Run in background so the HTTP caller returns immediately
    const work = runPipeline(search_id);
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    } else {
      // best-effort: don't await
      work.catch((e) => console.error("pipeline error", e));
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "content-type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
  }
});

/**
 * Wall-clock ceiling for an entire run.
 *
 * Each step used to carry its own deadline with nothing bounding the total, so
 * a large result set could stack 45s of directories onto 60s of property
 * lookups onto 90s of decision-maker hunting onto an unbounded skip trace. The
 * user watched a bar crawl for minutes with nothing to show.
 *
 * A search that returns forty solid leads in three minutes is worth far more
 * than one that returns seventy perfect ones in fifteen. Past this point the
 * run stops enriching, keeps everything it has, and finishes as partial.
 */
const RUN_BUDGET_MS = 150_000;

/** Deep-agent escalations per run.
 *
 *  Set high deliberately: the step deadline is what should stop this work, not
 *  an arbitrary count. The cap exists only so a thousand-business result set
 *  can't queue twelve thousand queries — within a normal run it never binds,
 *  so it costs no decision makers. */
const MAX_AGENT_ESCALATIONS = 120;

async function runPipeline(searchId: string) {
  const t0 = Date.now();
  const RUN_DEADLINE_MS = t0 + RUN_BUDGET_MS;
  /** Clamp any step deadline to what's left of the run. */
  const stepDeadline = (ms: number) => Math.min(Date.now() + ms, RUN_DEADLINE_MS);
  const outOfTime = () => Date.now() > RUN_DEADLINE_MS;

  const { data: search } = await SUPABASE.from("searches").select("*").eq("id", searchId).single();
  if (!search) return;
  const teamId = search.team_id as string;

  await SUPABASE.from("searches").update({ status: "running" }).eq("id", searchId);
  await logActivity(searchId, teamId, "start", "info", "🚀", `Pipeline starting for "${search.keyword}"…`, { percent: 1 });

  // Drop expired cache rows once per run. Cheap, keeps the table bounded, and
  // avoids needing pg_cron for it. Deliberately not awaited for correctness —
  // a failed prune is irrelevant to this run.
  pruneSearchCache(SUPABASE).catch(() => {});

  const { data: settings } = await SUPABASE.from("team_settings").select("*").eq("team_id", teamId).maybeSingle();

  // Ceiling on paid-vendor spend for this run. Free sources (OpenStreetMap,
  // Google Places on the existing key) are never gated by this.
  const budget = new RunBudget(
    searchId,
    teamId,
    Number(settings?.max_run_cost_usd ?? 1.0),
  );

  const sources_success: Record<string, boolean> = {};
  const sources_failed: Record<string, string> = {};

  try {
    const keyword = search.keyword as string;
    const location = (search.location as string) || "";

    // ── US-only gate ────────────────────────────────────────────────────────
    const country = "USA";
    const countryHint = "USA";

    async function checkCancelled(): Promise<boolean> {
      const { data } = await SUPABASE.from("searches").select("status").eq("id", searchId).single();
      return data?.status === "cancelled";
    }

    if (await checkCancelled()) return;

    // ── STEP 1: business discovery (parallel, US-only) ─────────────────────
    await setStepRunning(searchId, teamId, "business", `Scraping ${country} directories`);
    await logActivity(searchId, teamId, "business", "running", "🌎",
      `Searching business directories across ${country}…`,
      { percent: 10 });

    const isRealEstate = /cash buyer|wholesale|investor|investment|property|real estate/i.test(keyword);
    const isLocalBiz = /cleaning|roofing|hvac|plumb|contractor|landscap|pest|electric|service/i.test(keyword);

    const tasks: Promise<{ name: string; items: Business[] }>[] = [];
    const wrap = (name: string, p: Promise<Business[]>) =>
      p.then(items => ({ name, items }))
       .catch((e) => {
         console.error(`${name} failed`, e);
         sources_failed[name] = String(e);
         return { name, items: [] as Business[] };
       });

    // Always-on free sources. OpenStreetMap needs no key and still runs when
    // Google Maps is unconfigured, so discovery degrades rather than dying.
    const mapsKey = (settings?.google_maps_key as string | undefined) || GOOGLE_MAPS_KEY;
    if (mapsKey) tasks.push(wrap("google_maps", queryGoogleMaps(keyword, location, mapsKey)));
    else sources_failed["google_maps"] = "no api key configured";

    // OpenStreetMap (Overpass) — free, keyless. Returns exact address + coords.
    tasks.push(wrap("openstreetmap", scrapeOpenStreetMap(keyword, location, countryHint)));

    // Directory listings mined straight out of search results. One search call
    // covers ~10 listings, where the scraper path below costs one page scrape
    // each, so this runs first and the scrapers become the fallback for what it
    // misses. Uses the same webSearch transport, so the run's spend ceiling and
    // cost ledger already cover it.
    const serperKeyForDirs = (settings?.serper_api_key as string | undefined) || Deno.env.get("SERPER_API_KEY") || null;
    const firecrawlKeyForDirs = (settings?.firecrawl_api_key as string | undefined) || Deno.env.get("FIRECRAWL_API_KEY") || null;
    if (serperKeyForDirs || firecrawlKeyForDirs) {
      tasks.push(wrap("directories", (async () => {
        const { businesses } = await harvestDirectoriesViaSerp(
          keyword,
          location,
          (q, o) => webSearch(q, {
            serperKey: serperKeyForDirs,
            firecrawlKey: firecrawlKeyForDirs,
            num: o.num,
            timeoutMs: o.timeoutMs,
            budget,
          }).then(({ organic }) => ({ organic })),
          { deadlineMs: stepDeadline(45_000) },
        );
        return businesses as Business[];
      })()));
    }

    const defaultSubs = (settings?.default_subreddits as string[] | undefined) ?? [];
    const subreddits = defaultSubs.length > 0
      ? defaultSubs
      : (isRealEstate
          ? ["Wholesaling", "RealEstate", "realestateinvesting", "cashbuyers"]
          : ["smallbusiness", "Entrepreneur"]);
    tasks.push(wrap("reddit", scrapeRedditGlobal(keyword, subreddits, countryHint)));

    // Firecrawl-powered global scrapers (cheap, only if key is configured)
    const firecrawlKey = (settings?.firecrawl_api_key as string | undefined) || Deno.env.get("FIRECRAWL_API_KEY");
    if (firecrawlKey) {
      if (isRealEstate) {
        tasks.push(wrap("biggerpockets", scrapeBiggerPocketsGlobal(keyword, location, firecrawlKey)));
        tasks.push(wrap("craigslist", scrapeCraigslistGlobal(keyword, location, firecrawlKey)));
      }
      if (isLocalBiz || !isRealEstate) {
        tasks.push(wrap("yelp", scrapeYelpGlobal(keyword, location, firecrawlKey)));
        tasks.push(wrap("yellow_pages", scrapeYellowPagesGlobal(keyword, location, firecrawlKey)));
        tasks.push(wrap("angi", scrapeAngiGlobal(keyword, location, firecrawlKey)));
        tasks.push(wrap("bbb", scrapeBBBGlobal(keyword, location, firecrawlKey)));
      }
    } else {
      sources_failed["firecrawl"] = "no api key configured";
    }

    // Paid backup sources (Apollo, Seamless, etc.)
    // A key that answers 403 or 404 is a dead key, not a transient failure, and
    // every run pays the round trip to rediscover that. Sources that have
    // failed authentication recently are skipped until someone fixes the key.
    const deadSources = new Set<string>();
    try {
      const { data: recentFails } = await SUPABASE
        .from("api_cost_events")
        .select("provider, error")
        .eq("team_id", teamId)
        .eq("ok", false)
        .gt("created_at", new Date(Date.now() - 6 * 3600_000).toISOString())
        .limit(200);
      for (const row of recentFails ?? []) {
        if (/\b(401|403|404)\b/.test(String((row as any).error || ""))) {
          deadSources.add(String((row as any).provider));
        }
      }
    } catch { /* advisory only — never block a run on this */ }

    const apolloKeyEnv = (settings?.apollo_key as string | undefined) || Deno.env.get("APOLLO_API_KEY");
    if (apolloKeyEnv && !deadSources.has("apollo")) tasks.push(wrap("apollo", queryApollo(keyword, location, apolloKeyEnv)));
    else sources_failed["apollo"] = apolloKeyEnv ? "key rejected recently — skipped" : "no api key configured";
    // Same settings-then-platform pattern the keys above use: a team that has
    // configured nothing still runs on our credentials and is billed in
    // credits, while a team that brings its own key runs on their vendor
    // account instead. Onboarding therefore requires no keys at all.
    const seamlessKeyEnv = (settings?.seamless_key as string | undefined) || Deno.env.get("SEAMLESS_API_KEY");
    if (seamlessKeyEnv) tasks.push(wrap("seamless", querySeamless(keyword, location, seamlessKeyEnv)));
    else sources_failed["seamless"] = "no api key configured";
    const leadsGorillaKeyEnv = (settings?.leads_gorilla_key as string | undefined) || Deno.env.get("LEADS_GORILLA_API_KEY");
    if (leadsGorillaKeyEnv) tasks.push(wrap("leads_gorilla", queryLeadsGorilla(keyword, location, leadsGorillaKeyEnv)));
    else sources_failed["leads_gorilla"] = "no api key configured";
    const clayKeyEnv = (settings?.clay_key as string | undefined) || Deno.env.get("CLAY_API_KEY");
    if (clayKeyEnv) tasks.push(wrap("clay", queryClay(keyword, location, clayKeyEnv)));
    else sources_failed["clay"] = "no api key configured";
    const aiArkKeyEnv = (settings?.ai_ark_key as string | undefined) || Deno.env.get("AI_ARK_API_KEY");
    const aiArkEndpoint = (settings?.ai_ark_endpoint as string | undefined) || Deno.env.get("AI_ARK_ENDPOINT") || "";
    if (aiArkKeyEnv) tasks.push(wrap("ai_ark", queryAIArk(keyword, location, aiArkKeyEnv, aiArkEndpoint)));
    else sources_failed["ai_ark"] = "no api key configured";
    const apifyKeyEnv = (settings?.apify_key as string | undefined) || Deno.env.get("APIFY_API_KEY");
    const apifyActorId = (settings?.apify_actor_id as string | undefined) || Deno.env.get("APIFY_ACTOR_ID") || "compass~google-maps-extractor";
    if (apifyKeyEnv) tasks.push(wrap("apify", queryApify(keyword, location, apifyKeyEnv, apifyActorId)));
    else sources_failed["apify"] = "no api key configured";

    if (tasks.length === 0) {
      await logActivity(searchId, teamId, "business", "error", "⚠️",
        "No API keys configured. Add at least one source in Settings → APIs to get results.",
        { percent: 25 });
    }

    const ok: string[] = [];
    const fail: string[] = Object.keys(sources_failed);
    let all: Business[] = [];
    const settled = await Promise.allSettled(tasks);
    for (const r of settled) {
      if (r.status === "fulfilled") {
        if (r.value.items.length > 0 || !sources_failed[r.value.name]) {
          ok.push(r.value.name);
          sources_success[r.value.name] = true;
          // remove from failed list if it succeeded
          if (!sources_failed[r.value.name]) {
            const idx = fail.indexOf(r.value.name);
            if (idx >= 0) fail.splice(idx, 1);
          }
        }
        all = all.concat(r.value.items);
      }
    }
    let merged = mergeBusinesses(all);

    // ── Industry filter ─────────────────────────────────────────────────
    // If the user picked an Industry preset on the Discovery form, drop
    // merged results whose name / industry / description / services don't
    // match. Prevents a "real estate companies" search from returning tire
    // shops, salons, etc. Keep the regex list in sync with
    // src/lib/discovery-industries.ts.
    const industryFilter = (search.industry_filter as string | null) || null;
    if (industryFilter) {
      const INDUSTRY_RX: Record<string, RegExp> = {
        real_estate: /(real ?estate|realtor|realty|wholesal|cash ?buyer|invest(or|ment)|property|properties|home ?buyer|we buy houses|reia|landlord|rental)/i,
        roofing: /(roof(ing|er)?)/i,
        hvac: /(hvac|heating|cooling|air ?condition|furnace|hvac\/r)/i,
        plumbing: /(plumb(er|ing)|drain|sewer|water heater)/i,
        electrical: /(electric(ian|al)?)/i,
        landscaping: /(landscap|lawn|tree service|arborist|gardening)/i,
        cleaning: /(clean(ing|er)?|janitor|maid|housekeep)/i,
        pest_control: /(pest|exterminat|termite|rodent)/i,
        construction: /(construction|contractor|builder|remodel|renovation|handyman|carpent)/i,
        legal: /(law(yer)?|attorney|legal|law firm|counsel)/i,
        accounting: /(accountant|accounting|cpa|bookkeep|tax\b|payroll)/i,
        insurance: /(insurance|insur(er|ance)|broker)/i,
        medical: /(medical|clinic|physician|doctor|dentist|dental|chiropract|therap|health)/i,
        automotive: /(auto(motive)?|mechanic|body shop|tire|car repair|collision|dealership)/i,
        restaurant: /(restaurant|cafe|coffee|bakery|catering|food truck|pizzeria|bar & grill|diner)/i,
        retail: /(store|shop|boutique|retail|market\b|apparel)/i,
        fitness: /(gym|fitness|yoga|pilates|crossfit|personal train)/i,
        marketing: /(marketing|seo|advertising|agency|digital agency|creative agency|branding)/i,
        it_services: /(it services|managed services|msp|computer repair|tech support|it consult|it company|software)/i,
      };
      const rx = INDUSTRY_RX[industryFilter];
      if (rx) {
        const before = merged.length;
        merged = merged.filter((b) => {
          const hay = [
            b.name,
            b.industry,
            b.description,
            b.contact_title,
            ...(b.services ?? []),
          ].filter(Boolean).join(" ");
          return rx.test(hay);
        });
        await logActivity(
          searchId, teamId, "business", "info", "🎯",
          `Industry filter "${industryFilter}" kept ${merged.length}/${before} businesses`,
          { percent: 20 },
        );
      }
    }

    // Geocode any merged businesses that have an address but no lat/lng yet,
    // so each lead pins on the Areas map at its real street location.
    const mapsKeyForGeocode = (settings?.google_maps_key as string | undefined) || GOOGLE_MAPS_KEY;
    if (mapsKeyForGeocode) {
      const needGeo = merged.filter(b => b.address && (typeof b.lat !== "number" || typeof b.lng !== "number"));
      const BATCH = 5;
      for (let i = 0; i < needGeo.length; i += BATCH) {
        const slice = needGeo.slice(i, i + BATCH);
        await Promise.allSettled(slice.map(async (b) => {
          const coords = await geocodeAddress(b.address!, mapsKeyForGeocode);
          if (coords) { b.lat = coords.lat; b.lng = coords.lng; }
        }));
      }
    }

    await SUPABASE.from("searches").update({ businesses_found: merged.length, sources_success, sources_failed }).eq("id", searchId);
    await setStepDone(searchId, teamId, "business", { count: merged.length }, ok, fail);
    await logActivity(searchId, teamId, "business", merged.length > 0 ? "success" : "error", "🔗",
      `Found ${merged.length} businesses`,
      { count: merged.length, percent: 25 });

    // ── Save what we have, before spending a second on enrichment ──────────
    //
    // Everything used to be written at the very end, so a run that found 71
    // businesses and was then killed mid-enrichment left nothing at all — not
    // even the businesses it definitely had. Edge functions get terminated on a
    // wall-clock limit, so that was not a rare case; it was every long run.
    //
    // Each business gets a skeleton contact now and is enriched in place later.
    // Worst case the user keeps a real list of companies with phone numbers.
    {
      let saved = 0;
      for (const b of merged) {
        if (await checkCancelled()) break;
        try {
          const { data: existing } = await SUPABASE
            .from("contacts")
            .select("id")
            .eq("team_id", teamId)
            .ilike("company", b.name.replace(/[,()]/g, ""))
            .limit(1);

          if (existing?.[0]?.id) {
            // Already known. The final pass handles it as a duplicate; don't
            // claim the row here or enrichment would overwrite a real contact.
            continue;
          }

          const { data: ins } = await SUPABASE.from("contacts").insert({
            team_id: teamId,
            name: b.contact_name || b.name,
            company: b.name,
            phone: b.phone || null,
            city: b.city || null,
            state: b.state || null,
            country: b.country || "US",
            industry: b.industry || null,
            address: b.address || null,
            source: "discovery",
            discovery_keyword: keyword,
            auto_added_by_discovery: true,
            business_only: !b.contact_name,
            lead_score: 0,
            last_activity_at: new Date().toISOString(),
            auto_purge_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
          }).select("id").single();

          if (ins?.id) { b.contact_id = ins.id; saved++; }
        } catch (e) {
          console.error("early persist failed", b.name, String(e).slice(0, 160));
        }
      }
      if (saved > 0) {
        await logActivity(searchId, teamId, "business", "info", "💾",
          `${saved} leads saved — enriching them now`, { count: saved, percent: 28 });
      }
    }

    if (await checkCancelled()) return;

    // ── STEP 2: decision-maker extraction + business intel ───────────────
    await setStepRunning(searchId, teamId, "decisionmakers", "Filtering owners/CEOs");
    const titleFilter = (search.title_filters as string[]) || [];
    const titleParts = titleFilter.length > 0
      ? titleFilter.map(t => t.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))
      : [];
    const baseRoles = ["owner", "founder", "chief", "president", "managing director", "principal", "partner"];
    const dmRegexParts = [...titleParts, ...baseRoles];
    const dmRegex = new RegExp(`\\b(${dmRegexParts.join("|")})\\b`, "i");
    const blockRegex = /\b(receptionist|assistant|coordinator|secretary|front desk|customer service|support|intern)\b/i;

    let dmCount = 0;
    for (const b of merged) {
      // BUG FIX: Apollo stores top contact as raw.apollo.top (not primary_contact/contacts[])
      // BUG FIX: Seamless stores top contact as raw.seamless.top (not seamless.contacts[0])
      const apolloPerson = b.raw?.apollo?.top;
      const seamlessPerson = b.raw?.seamless?.top;
      const cand = apolloPerson || seamlessPerson;
      if (cand) {
        const title = (cand.title || "") as string;
        // If title passes the DM filter, set this as our contact — also accept if no title filter set
        if ((titleFilter.length === 0 || dmRegex.test(title)) && !blockRegex.test(title)) {
          b.contact_name = cand.name || `${cand.first_name || ""} ${cand.last_name || ""}`.trim();
          // undefined, not null: the field is declared optional (contact_title?:
          // string), and null would also defeat the ||= merge at line 171 that
          // lets a later source fill in a title this one didn't have.
          b.contact_title = title || undefined;
          // Pull any email/phone Apollo already returned (free, no credit cost)
          const apolloEmail = cand.email;
          const apolloPhones: string[] = (cand.phone_numbers || []).map((x: any) => x.sanitized_number || x.raw_number).filter(Boolean);
          if (apolloEmail) b.emails_found = [...(b.emails_found || []), { email: apolloEmail, source: "apollo" }];
          if (apolloPhones.length > 0) b.phones_found = [...(b.phones_found || []), ...apolloPhones.map((p: string) => ({ phone: p, source: "apollo", type: "direct" as const }))];
          // Seamless direct fields
          const seamlessEmail = seamlessPerson?.email;
          const seamlessPhone = seamlessPerson?.phone;
          if (!apolloEmail && seamlessEmail) b.emails_found = [...(b.emails_found || []), { email: seamlessEmail, source: "seamless" }];
          if (!apolloPhones.length && seamlessPhone) b.phones_found = [...(b.phones_found || []), { phone: seamlessPhone, source: "seamless", type: "direct" as const }];
        }
      }
      if (b.contact_name) dmCount++;
    }

    // DM hunt: always runs. Prefers Serper, then Firecrawl search. The direct
    // SERP-scrape tiers inside webSearch() no longer return results, so one of
    // those two keys must be configured for this step to find anything.
    const serperKeyForDm = (settings?.serper_api_key as string | undefined) || Deno.env.get("SERPER_API_KEY") || null;
    const firecrawlKeyForDm = (settings?.firecrawl_api_key as string | undefined) || Deno.env.get("FIRECRAWL_API_KEY") || null;
    let freeDmFound = 0;
    let dmSkipped = 0;
    let ownersFromRecords = 0;
    let agentEscalations = 0;

    // ── Owner of record, before any search ──────────────────────────────────
    // County assessor data names the owner outright, has no rate limit, and
    // costs nothing in search quota. Running it first means the SERP hunt below
    // only has to cover the businesses records couldn't answer — and that a
    // throttled search provider no longer means zero decision makers.
    {
      const propertyActorId = (settings?.apify_property_actor_id as string | undefined) || Deno.env.get("APIFY_PROPERTY_ACTOR_ID") || "";
      const apifyToken = (settings?.apify_key as string | undefined) || Deno.env.get("APIFY_API_KEY") || "";
      const candidates = merged.filter((b) => !b.contact_name && (b.address || "").trim().length > 4);

      if (propertyActorId && apifyToken && candidates.length) {
        await setStepRunning(searchId, teamId, "decisionmakers", "Checking property records for owners");

        const byKey = new Map(candidates.map((b, i) => [`b${i}`, b]));
        const { owners, attempted, error } = await lookupOwners(
          candidates.map((b, i) => ({
            key: `b${i}`,
            company: b.name,
            address: b.address ?? null,
            city: b.city ?? null,
            state: b.state ?? null,
          })),
          {
            apifyToken,
            actorId: propertyActorId,
            maxItems: 100,
            deadlineMs: stepDeadline(60_000),
            onCall: (units, ok, err) =>
              budget.record("apify_property", "property_owner_lookup", units, ok, err),
          },
        );

        for (const o of owners) {
          const b = byKey.get(o.key);
          if (!b) continue;
          b.contact_name = o.ownerName;
          b.contact_title = b.contact_title || "Owner";
          if (o.mailingAddress) {
            b.raw = { ...(b.raw || {}), owner_mailing_address: o.mailingAddress };
          }
          b.sources = Array.from(new Set([...(b.sources || []), "property_records"]));
          ownersFromRecords++;
          dmCount++;
        }

        if (error) {
          console.error("property records lookup failed", error);
        }
        await logActivity(
          searchId, teamId, "decisionmakers", ownersFromRecords > 0 ? "success" : "info", "🏠",
          ownersFromRecords > 0
            ? `Found ${ownersFromRecords} owner(s) of record from ${attempted} propert${attempted === 1 ? "y" : "ies"}`
            : "No owners of record matched — continuing with web research",
          { count: ownersFromRecords, percent: 35 },
        );
      }
    }

    {
      const missing = merged.filter(b => !b.contact_name);
      // Whole-step budget. The step must finish well inside the edge function's
      // wall clock; running out of time is expected on large result sets and is
      // reported rather than left to stall.
      // The most valuable step gets the largest share of the run. Still clamped
      // to the ceiling, so it can lengthen without the run becoming unbounded.
      const DM_STEP_DEADLINE_MS = stepDeadline(150_000);

      // Concurrency has to match what the search provider will actually accept.
      // Firecrawl's lower plans allow only 2-5 simultaneous requests, so firing
      // eight businesses at once — each opening its own wave of queries — was
      // manufacturing the 429s that made this step look frozen. Serper has no
      // such ceiling, so when it's available we widen right out and the same
      // work finishes in a fraction of the wall clock.
      const BATCH_DM = serperKeyForDm ? 12 : 3;

      // No search provider at all means this step cannot possibly find anyone.
      // Say so once, plainly, instead of grinding through every business and
      // reporting "0 decision-makers" as though the data simply wasn't there.
      if (!serperKeyForDm && !firecrawlKeyForDm) {
        await logActivity(searchId, teamId, "decisionmakers", "error", "⚠️",
          "Decision-maker lookup needs a search provider. Add a Serper key to enable it.",
          { percent: 40 });
      }

      for (let i = 0; i < missing.length; i += BATCH_DM) {
        if (Date.now() > DM_STEP_DEADLINE_MS) { dmSkipped = missing.length - i; break; }
        // Nothing left to spend means every remaining lookup would no-op.
        if (!budget.canSpend("firecrawl_search")) { dmSkipped = missing.length - i; break; }
        // Every provider is throttled: the rest of the sweep would be 429s
        // burning the deadline. Stop and report honestly.
        if (searchProviderThrottled()) {
          dmSkipped = missing.length - i;
          await logActivity(searchId, teamId, "decisionmakers", "error", "⏳",
            `Search provider rate-limited — ${dmSkipped} business(es) not researched. A Serper key removes this limit.`,
            { percent: 45 });
          break;
        }

        const slice = missing.slice(i, i + BATCH_DM);
        await Promise.allSettled(slice.map(async (b) => {
          const dm = await serperFreeDmHunt(
            b.name, location || null, serperKeyForDm, firecrawlKeyForDm, budget, DM_STEP_DEADLINE_MS,
          );
          if (dm) {
            b.contact_name = dm.name;
            b.contact_title = dm.title;
            if (dm.linkedin_url) b.linkedin_url ||= dm.linkedin_url;
            b.sources = Array.from(new Set([...(b.sources || []), `free_dm_${dm.source}`]));
            freeDmFound++;
            dmCount++;
            return;
          }

          // Escalation. The fast hunt found nobody, so try the agent's wider
          // strategy set — registries, team pages, socials. It is strictly a
          // second attempt: it only runs on businesses the cheap path already
          // failed, and only while both the step deadline and the spend
          // ceiling still have room, so it cannot turn a working step into a
          // timeout.
          if (Date.now() > DM_STEP_DEADLINE_MS - 15_000) return;
          // The agent's ladder can issue a dozen-plus queries before it either
          // ties a person back or gives up. Reserve for that rather than for a
          // best case, so we never start a hunt the budget can't see through.
          if (!budget.canSpend("serper_search", 12)) return;
          // Hard cap on escalations. Without it, a seventy-business result set
          // queues eight hundred-plus queries and the run never lands.
          if (agentEscalations >= MAX_AGENT_ESCALATIONS) return;
          agentEscalations++;

          const agent = await runDmAgent(
            {
              company: b.name,
              city: b.city ?? null,
              state: b.state ?? null,
              website: b.website ?? null,
              domain: b.domain ?? null,
            },
            {
              search: (q, o) => webSearch(q, {
                serperKey: serperKeyForDm,
                firecrawlKey: firecrawlKeyForDm,
                num: o?.num,
                timeoutMs: o?.timeoutMs,
                budget,
              }).then(({ organic }) => ({ organic })),
              hasMx: (host) => checkMx(host),
              deadlineMs: DM_STEP_DEADLINE_MS,
            },
          );
          if (agent) {
            b.contact_name = agent.name;
            b.contact_title = agent.title || b.contact_title;
            if (agent.email) {
              b.emails_found = [...(b.emails_found || []), { email: agent.email, source: "dm_agent" }];
            }
            if (agent.phone) {
              b.phone ||= agent.phone;
              b.phones_found = [...(b.phones_found || []), { phone: agent.phone, source: "dm_agent" }];
            }
            if (agent.linkedin_url) b.linkedin_url ||= agent.linkedin_url;
            if (agent.facebook_url) b.facebook_url ||= agent.facebook_url;
            if (agent.instagram_url) b.instagram_url ||= agent.instagram_url;
            b.sources = Array.from(new Set([...(b.sources || []), "dm_agent"]));
            freeDmFound++;
            dmCount++;
          }
        }));

        // Keep the live progress bar moving through a long sweep, so the step
        // doesn't look hung while it is genuinely working.
        const done = Math.min(i + BATCH_DM, missing.length);
        await setStepRunning(
          searchId, teamId, "decisionmakers",
          `Researching owners — ${done} of ${missing.length}`,
        );
      }
    }
    await SUPABASE.from("searches").update({ decision_makers_found: dmCount }).eq("id", searchId);
    await setStepDone(searchId, teamId, "decisionmakers", { count: dmCount, free_dm_found: freeDmFound, skipped: dmSkipped }, ["filter"], []);
    await logActivity(searchId, teamId, "decisionmakers", "success", "👤",
      `Identified ${dmCount} decision-makers${ownersFromRecords > 0 ? ` · ${ownersFromRecords} from property records` : ""}${dmSkipped > 0 ? ` · ${dmSkipped} not researched (time or budget limit)` : ""}`,
      { count: dmCount, percent: 40 });

    // ── STEP 3: social profile discovery (best-effort) ───────────────────
    if (await checkCancelled()) return;
    await setStepRunning(searchId, teamId, "social", "Finding social profiles");
    let socialCount = 0;
    // BUG FIX: Apollo LinkedIn URL is stored at raw.apollo.top.linkedin_url
    for (const b of merged) {
      const lnk = b.raw?.apollo?.top?.linkedin_url;
      if (lnk) b.linkedin_url ||= lnk;
    }
    // Socials via web search (Serper if key present, else Firecrawl search)
    const serperKey = (settings?.serper_api_key as string | undefined) || Deno.env.get("SERPER_API_KEY") || null;
    const firecrawlKeySocial = (settings?.firecrawl_api_key as string | undefined) || Deno.env.get("FIRECRAWL_API_KEY") || null;
    {
      const BATCH = 5;
      for (let i = 0; i < merged.length; i += BATCH) {
        const slice = merged.slice(i, i + BATCH);
        await Promise.allSettled(slice.map(async (b) => {
          const socials = await enrichSocials(b.contact_name, b.name, serperKey, b.city, firecrawlKeySocial);
          if (socials.facebook_url) b.facebook_url ||= socials.facebook_url;
          if (socials.instagram_url) b.instagram_url ||= socials.instagram_url;
          if (socials.twitter_url) b.twitter_url ||= socials.twitter_url;
          if (socials.youtube_url) b.youtube_url ||= socials.youtube_url;
        }));

      }
    }
    for (const b of merged) {
      if (b.linkedin_url || b.facebook_url || b.instagram_url || b.twitter_url || b.youtube_url) socialCount++;
    }
    const socialOk = ["linkedin", "web_search"];
    const socialFail: string[] = [];
    if (serperKey) socialOk.push("serper");
    await setStepDone(searchId, teamId, "social", { count: socialCount }, socialOk, socialFail);
    await logActivity(searchId, teamId, "social", "success", "🌐", `Found social profiles for ${socialCount} contacts`, { count: socialCount, percent: 55 });

    // ── STEP 4: FREE skip-trace (Serper web search + Firecrawl scraping + Hunter) ──
    if (await checkCancelled()) return;
    await setStepRunning(searchId, teamId, "skiptrace", "Finding phone numbers and emails");
    await logActivity(searchId, teamId, "skiptrace", "running", "🔎",
      "Searching the open web for direct contact details…", { percent: 60 });
    const stOk: string[] = [];
    const stFail: string[] = [];

    const hunterKey = (settings?.hunter_api_key as string | undefined) || Deno.env.get("HUNTER_API_KEY");
    const serperKeySkip = (settings?.serper_api_key as string | undefined) || Deno.env.get("SERPER_API_KEY") || null;
    const firecrawlKeyEnrich = (settings?.firecrawl_api_key as string | undefined) || Deno.env.get("FIRECRAWL_API_KEY");

    // Safe-spend guard: probe Hunter balance
    const credits: Record<string, number> = {};
    if (hunterKey) { credits.hunter = await probeHunterCredits(hunterKey); await recordCreditSnapshot(teamId, "hunter", credits.hunter); }

    // Global skiptrace time budget — caps the entire step so 100-row searches
    // can't hang the pipeline. Per-business budget is derived from this.
    const SKIPTRACE_TOTAL_MS = 90_000;  // 90s, and only if the run has it spare
    const PER_BUSINESS_MS = 8_000;      // 8s max per business
    const skiptraceStartedAt = Date.now();
    // Clamped to the run ceiling. On its own this step used to allow four
    // minutes — longer than the whole run is now permitted to take — so a large
    // result set spent most of its life here while the user watched a bar.
    const skiptraceDeadline = stepDeadline(SKIPTRACE_TOTAL_MS);
    let skiptraceSkipped = 0;
    let skiptraceErrors = 0;

    const SKIP_BATCH = 3;
    outer: for (let i = 0; i < merged.length; i += SKIP_BATCH) {
      if (Date.now() > skiptraceDeadline) {
        skiptraceSkipped += merged.length - i;
        break outer;
      }
      const batch = merged.slice(i, i + SKIP_BATCH);
      await Promise.allSettled(batch.map(async (b) => {
        try {
          // Skip if BOTH email AND phone are already found
          if ((b.emails_found && b.emails_found.length > 0) && (b.phones_found && b.phones_found.length > 0)) return;
          if (Date.now() > skiptraceDeadline) { skiptraceSkipped++; return; }

          const nameParts = (b.contact_name || "").split(" ");
          const firstName = nameParts[0] || "";
          const lastName = nameParts.slice(1).join(" ") || "";
          const domain = b.domain || (b.website
            ? (() => { try { return new URL(b.website!.startsWith("http") ? b.website! : `https://${b.website}`).hostname.replace(/^www\./, ""); } catch { return null; } })()
            : null);

          const perBizDeadline = Math.min(skiptraceDeadline, Date.now() + PER_BUSINESS_MS);

          // ⓪ FREE: Open-web search (Serper if available, else DuckDuckGo / Google SERP)
          if (Date.now() < perBizDeadline) {
            try {
              const webResult = await freeSkiptraceViaWeb(
                { name: b.contact_name || b.name, company: b.name, city: b.city, state: b.state, website: b.website },
                serperKeySkip,
                firecrawlKeyEnrich || null,
                perBizDeadline,
              );
              if (webResult.phones.length > 0) {
                b.phones_found = [...(b.phones_found || []), ...webResult.phones.map(p => ({ phone: p, source: "web_search", type: "direct" as const }))];
              }
              if (webResult.emails.length > 0) {
                b.emails_found = [...(b.emails_found || []), ...webResult.emails.map(e => ({ email: e, source: "web_search" }))];
              }
              for (const src of webResult.sources) {
                if (!stOk.includes(src)) stOk.push(src);
              }
            } catch (e) {
              skiptraceErrors++;
              console.error("skiptrace web error", b.name, String(e).slice(0, 200));
            }
          }

          // ① Free: Hunter domain search (only if we still need emails)
          if (!(b.emails_found && b.emails_found.length > 0) && hunterKey && domain && Date.now() < perBizDeadline) {
            try {
              const hunterEmails = await hunterDomainSearch(domain, hunterKey);
              if (hunterEmails.length > 0) {
                const dm = hunterEmails.find(e => e.position && /owner|ceo|founder|president|director|chief/i.test(e.position))
                  || hunterEmails[0];
                b.emails_found = [...(b.emails_found || []), { email: dm.email, source: "hunter" }];
                if (dm.first_name && dm.last_name && !b.contact_name) {
                  b.contact_name = `${dm.first_name} ${dm.last_name}`.trim();
                  b.contact_title = dm.position || b.contact_title;
                }
                if (!stOk.includes("hunter")) stOk.push("hunter");
              } else if (firstName && lastName) {
                const found = await hunterEmailFinder(firstName, lastName, domain, hunterKey);
                if (found) {
                  b.emails_found = [...(b.emails_found || []), { email: found, source: "hunter" }];
                  if (!stOk.includes("hunter")) stOk.push("hunter");
                }
              }
            } catch (e) {
              skiptraceErrors++;
              console.error("skiptrace hunter error", b.name, String(e).slice(0, 200));
            }
          }

          // ② Free: Hunter combined/find — enrich a known email → person + title + LinkedIn
          if (!b.contact_name && hunterKey && (b.emails_found?.length ?? 0) > 0 && Date.now() < perBizDeadline) {
            try {
              const enriched = await hunterCombinedFind(b.emails_found![0].email, hunterKey);
              if (enriched?.first_name && enriched?.last_name) {
                b.contact_name = `${enriched.first_name} ${enriched.last_name}`.trim();
                b.contact_title = enriched.position || b.contact_title;
                if (enriched.linkedin && !b.linkedin_url) b.linkedin_url = enriched.linkedin;
                if (!stOk.includes("hunter")) stOk.push("hunter");
              }
            } catch (e) {
              console.error("hunter combined/find error", b.name, String(e).slice(0, 200));
            }
          }

        } catch (e) {
          // Catch-all so one bad business never breaks the whole skiptrace step
          skiptraceErrors++;
          console.error("skiptrace per-business error", b.name, String(e).slice(0, 200));
        }
      }));
    }

    if (!hunterKey) stFail.push("hunter");
    if (!serperKeySkip) stFail.push("serper");
    if (skiptraceSkipped > 0) {
      await logActivity(searchId, teamId, "skiptrace", "info", "⏱️",
        `Skip-trace time budget reached — ${skiptraceSkipped} business(es) saved without extra enrichment.`,
        { count: skiptraceSkipped });
    }
    if (skiptraceErrors > 0) {
      await logActivity(searchId, teamId, "skiptrace", "info", "⚠️",
        `${skiptraceErrors} skip-trace lookups failed and were skipped (search continues).`,
        { count: skiptraceErrors });
    }

    let phonesFound = 0;
    let emailsFound = 0;
    for (const b of merged) {
      phonesFound += (b.phones_found || []).length;
      emailsFound += (b.emails_found || []).length;
    }
    await setStepDone(searchId, teamId, "skiptrace", { phones: phonesFound, emails: emailsFound }, stOk, stFail);
    await logActivity(searchId, teamId, "skiptrace", stOk.length ? "success" : "info", "☎️",
      `Enrichment found ${emailsFound} emails and ${phonesFound} phones`, { percent: 65 });

    // ── STEP 5: verification (MX + pattern — no bounced emails) ──────────
    if (await checkCancelled()) return;
    await setStepRunning(searchId, teamId, "verify", "Verifying emails + phones");
    await logActivity(searchId, teamId, "verify", "running", "📧", "Verifying emails via MX check — bounced addresses removed…", { percent: 75 });
    let verifiedEmails = 0;
    let patternVerified = 0;
    let verifiedPhones = 0;
    const mvKey = (settings?.millionverifier_api_key as string | undefined)
      || Deno.env.get("MILLIONVERIFIER_API_KEY") || null;
    let mvChecked = 0;
    let mvDropped = 0;

    for (const b of merged) {
      const domain = b.domain || (b.website ? (() => { try { return new URL(b.website!.startsWith("http") ? b.website! : `https://${b.website}`).hostname.replace(/^www\./, ""); } catch { return null; } })() : null);

      // MX-verify each known email; remove those that fail (no bounces)
      const verifiedList: typeof b.emails_found = [];
      for (const e of b.emails_found || []) {
        if (!EMAIL_RX.test(e.email)) continue;
        const mxOk = await checkMx(e.email.split("@")[1]);
        if (mxOk) {
          verifiedEmails++;
          (e as any).verified = true;
          (e as any).mx_valid = true;
          verifiedList.push(e);
        }
        // Emails that fail MX are silently dropped — no bounced emails
      }
      b.emails_found = verifiedList;

      // Pattern-generate when we have name + domain but still no verified email
      if (b.contact_name && domain && b.emails_found.length === 0) {
        const [first, ...rest] = b.contact_name.split(" ");
        const last = rest.pop() || "";
        if (first && last) {
          const mxOk = await checkMx(domain);
          if (mxOk) {
            const patterns = generatePatterns(first, last, domain);
            // Pattern addresses are guesses — MX only proves the domain takes
            // mail, not that these mailboxes exist. When a MillionVerifier key
            // is configured, check them for real and keep only what's
            // deliverable, so guessed addresses don't reach a sending campaign.
            if (mvKey) {
              const kept: typeof b.emails_found = [];
              for (const p of patterns) {
                if (!budget.canSpend("millionverifier_verify")) break;
                const mv = await verifyEmailMillionVerifier(p, mvKey);
                await budget.record("millionverifier", "millionverifier_verify", 1, mv !== null);
                mvChecked++;
                if (mv?.deliverable) {
                  kept.push({ email: p, source: "pattern_verified" });
                  break; // one confirmed mailbox is enough
                }
                if (mv && !mv.deliverable) mvDropped++;
              }
              b.emails_found = kept;
              patternVerified += kept.length;
            } else {
              b.emails_found = patterns.map(p => ({ email: p, source: "pattern" }));
              patternVerified += patterns.length;
            }
          }
        }
      }

      // Phone verification: ≥2 sources = verified
      for (const p of b.phones_found || []) {
        if (((p as any).sources?.length || 1) >= 2) verifiedPhones++;
      }
    }
    await SUPABASE.from("searches").update({
      verified_emails: verifiedEmails,
      pattern_verified_emails: patternVerified,
      verified_phones: verifiedPhones,
    }).eq("id", searchId);
    await setStepDone(searchId, teamId, "verify", { verifiedEmails, patternVerified, verifiedPhones, mvChecked, mvDropped }, ["smtp"], []);
    await logActivity(searchId, teamId, "verify", "success", "✅",
      `Verified ${verifiedEmails} emails, ${verifiedPhones} phones${mvChecked > 0 ? ` (${mvChecked} mailbox-checked, ${mvDropped} undeliverable removed)` : ""}`,
      { percent: 85 });

    // ── STEP 6: score + auto-pipeline + persist ──────────────────────────
    if (await checkCancelled()) return;
    await setStepRunning(searchId, teamId, "score", "Scoring + auto-adding to pipeline");
    await logActivity(searchId, teamId, "score", "running", "🎯", "Scoring leads and persisting contacts…", { percent: 92 });
    const threshold = (settings?.auto_pipeline_threshold as number) ?? 70;
    const { data: newLeadStage } = await SUPABASE
      .from("pipeline_stages").select("id").eq("team_id", teamId).eq("position", 0).maybeSingle();
    const { data: needsDmStage } = await SUPABASE
      .from("pipeline_stages").select("id").eq("team_id", teamId).eq("name", "Needs DM Research").maybeSingle();

    let autoAdded = 0;
    let totalScore = 0;
    let scoredCount = 0;
    const duplicatesFound: Array<{ name: string; reason: string; existing_contact_id: string }> = [];

    for (const b of merged) {
     try {
      const primaryEmail = b.emails_found?.[0]?.email || null;
      const primaryPhone = b.phones_found?.[0]?.phone || b.phone || null;
      const phoneDigits = normalizePhone(primaryPhone);

      // Duplicate detection: skip (don't save) if the team already has this
      // business by company name, primary email, or primary phone (normalized).
      // The auto-purge cron clears discovery contacts after 90 days, so the
      // same business becomes scrapeable again then.
      const orFilters: string[] = [];
      const safeName = b.name.replace(/[,()]/g, "");
      orFilters.push(`company.ilike.${safeName}`);
      if (primaryEmail) orFilters.push(`email.eq.${primaryEmail}`);
      if (phoneDigits) orFilters.push(`phone.ilike.%${phoneDigits}%`);

      const { data: dupRows } = await SUPABASE
        .from("contacts")
        .select("id, company, email, phone")
        .eq("team_id", teamId)
        .or(orFilters.join(","))
        .limit(1);
      const existingContact = dupRows?.[0] || null;

      if (existingContact) {
        const reason = existingContact.email && primaryEmail && existingContact.email === primaryEmail
          ? "same email"
          : existingContact.phone && phoneDigits && normalizePhone(existingContact.phone) === phoneDigits
          ? "same phone"
          : "same company name";
        duplicatesFound.push({ name: b.name, reason, existing_contact_id: existingContact.id });
        // Record on search_results so the UI can still show what was scraped,
        // but tagged as a duplicate (no new contact created/updated).
        await SUPABASE.from("search_results").insert({
          search_id: searchId, team_id: teamId, contact_id: existingContact.id,
          is_new: false, auto_added_to_pipeline: false,
          raw_sources_data: { ...b.raw, _duplicate_reason: reason },
        });
        continue;
      }

      let contactId: string | undefined;
      let isNew = false;

      const verifiedEmail = !!(b.emails_found?.[0] as any)?.verified;
      const patternEmail = b.emails_found?.[0]?.source === "pattern";
      const verifiedPhoneAny = ((b.phones_found || []).length >= 2);
      const score = scoreContact(b, verifiedEmail, patternEmail, verifiedPhoneAny);
      totalScore += score;
      scoredCount++;

      const isBusinessOnly = !b.contact_name;
      const verifiedSources: string[] = [];
      if ((b.emails_found || []).length >= 2) verifiedSources.push("email_cross_verified");
      if ((b.phones_found || []).length >= 2) verifiedSources.push("phone_cross_verified");
      if ((b.sources || []).length >= 2) verifiedSources.push(...(b.sources || []).slice(0, 4));

      const contactRow: Record<string, unknown> = {
        team_id: teamId,
        name: b.contact_name || b.name,
        title: b.contact_title || null,
        company: b.name,
        website: b.website || null,
        email: primaryEmail,
        phone: primaryPhone,
        linkedin_url: b.linkedin_url || null,
        instagram_url: b.instagram_url || null,
        facebook_url: b.facebook_url || null,
        twitter_url: b.twitter_url || null,
        youtube_url: b.youtube_url || null,
        industry: b.industry || null,
        address: b.address || null,
        city: b.city || null,
        state: b.state || null,
        country: b.country || "US",
        email_verified: verifiedEmail,
        phone_verified: verifiedPhoneAny,
        verification_sources: b.sources,
        lead_score: isBusinessOnly ? Math.min(score, 40) : score,
        source: "discovery",
        discovery_keyword: keyword,
        notes: b.description || null,
        auto_added_by_discovery: true,
        business_only: isBusinessOnly,
        dm_search_attempts: 1,
        dm_last_retry_at: new Date().toISOString(),
        business_verified_sources: Array.from(new Set(verifiedSources)),
        last_activity_at: new Date().toISOString(),
        // 90-day retention for discovery leads — cron purges untouched rows
        auto_purge_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      };

      if (typeof b.lat === "number" && typeof b.lng === "number") {
        contactRow.lat = b.lat;
        contactRow.lng = b.lng;
        contactRow.geocoded_at = new Date().toISOString();
      }

      // A skeleton row was written straight after discovery so a killed run
      // still leaves leads behind. Enrich that row rather than inserting a
      // second one.
      if (b.contact_id) {
        const { error: updErr } = await SUPABASE.from("contacts").update(contactRow).eq("id", b.contact_id);
        if (updErr) { console.error("contact update error", updErr); continue; }
        contactId = b.contact_id;
        isNew = true;
      } else {
        const { data: ins, error } = await SUPABASE.from("contacts").insert(contactRow).select("id").single();
        if (error) { console.error("contact insert error", error); continue; }
        contactId = ins.id;
        isNew = true;
      }

      // persist business intel
      if (b.description || b.employee_count || b.founded_year || b.rating) {
        await SUPABASE.from("business_intel").upsert({
          team_id: teamId, contact_id: contactId,
          description: b.description, employee_count: b.employee_count,
          founded_year: b.founded_year,
          years_in_business: b.founded_year ? new Date().getFullYear() - b.founded_year : null,
          services: b.services || [],
          google_rating: b.rating || null,
          google_review_count: b.review_count || null,
          industry_tags: b.industry ? [b.industry] : [],
        }, { onConflict: "contact_id" } as any);
      }

      // persist phones
      const phoneRows = (b.phones_found || []).map((p, i) => ({
        team_id: teamId, contact_id: contactId!,
        phone_number: p.phone, phone_type: (p.type as any) || "unknown",
        confidence_score: 50 + (((p as any).sources?.length || 1) * 10),
        sources: [(p as any).source].filter(Boolean),
        is_primary: i === 0, verified: ((p as any).sources?.length || 1) >= 2,
      }));
      if (phoneRows.length) await SUPABASE.from("contact_phones").insert(phoneRows);

      // persist emails
      const emailRows = (b.emails_found || []).map((e, i) => ({
        team_id: teamId, contact_id: contactId!,
        email: e.email,
        source_type: e.source === "pattern" ? "pattern_generated" : "direct",
        verified_status: (e as any).verified ? "verified" : (e.source === "pattern" ? "unverified" : "unverified"),
        mx_valid: !!(e as any).mx_valid,
        sources_confirmed: 1,
        sources: [e.source],
        is_primary: i === 0,
      }));
      if (emailRows.length) await SUPABASE.from("contact_emails").insert(emailRows);

      // auto-pipeline — business-only → "Needs DM Research", full DM → "New Lead"
      let autoPipelined = false;
      const targetStageId = isBusinessOnly ? (needsDmStage?.id || newLeadStage?.id) : newLeadStage?.id;
      if (targetStageId) {
        const { data: existingLead } = await SUPABASE.from("pipeline_leads")
          .select("id").eq("team_id", teamId).eq("contact_id", contactId).maybeSingle();
        if (!existingLead) {
          await SUPABASE.from("pipeline_leads").insert({
            team_id: teamId, contact_id: contactId, stage_id: targetStageId,
            notes: isBusinessOnly
              ? `Auto-added from Discovery (B2B, no DM found): ${keyword}`
              : `Auto-added from Discovery: ${keyword}`,
          });
          autoAdded++;
          autoPipelined = true;
        }
      }

      await SUPABASE.from("search_results").insert({
        search_id: searchId, team_id: teamId, contact_id: contactId,
        is_new: isNew, auto_added_to_pipeline: autoPipelined,
        raw_sources_data: b.raw,
      });
     } catch (perRowErr) {
       console.error("persist row failed", b.name, String(perRowErr).slice(0, 200));
     }
    }

    await setStepDone(searchId, teamId, "score", { autoAdded, avg: scoredCount ? totalScore / scoredCount : 0 }, ["scorer"], []);

    // ── FINALIZE ─────────────────────────────────────────────────────────
    if (await checkCancelled()) return;
    await setStepRunning(searchId, teamId, "finalize", "Notifying");
    const avg = scoredCount ? totalScore / scoredCount : 0;
    const successCount = Object.keys(sources_success).length;
    const failCount = Object.keys(sources_failed).length;
    const finalStatus = successCount === 0 ? "failed" : failCount > 0 ? "partial" : "complete";
    await SUPABASE.from("searches").update({
      status: finalStatus,
      auto_added_to_pipeline: autoAdded,
      avg_lead_score: avg,
      completed_at: new Date().toISOString(),
      duration_seconds: Math.round((Date.now() - t0) / 1000),
      duplicates: duplicatesFound,
      duplicates_count: duplicatesFound.length,
    }).eq("id", searchId);

    const dupNote = duplicatesFound.length ? `, ${duplicatesFound.length} skipped as duplicates` : "";
    await SUPABASE.from("notifications").insert({
      team_id: teamId,
      user_id: search.user_id,
      title: `Discovery complete: ${keyword}`,
      body: `${merged.length} businesses, ${dmCount} decision makers, ${autoAdded} auto-added to pipeline${dupNote}`,
      type: "discovery_complete",
      link: `/discovery?search=${searchId}`,
    });

    if (settings?.slack_webhook) {
      try {
        await fetch(settings.slack_webhook, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `R4D: "${keyword}" complete — ${autoAdded} leads added to pipeline (${merged.length} found)` }),
        });
      } catch (_) { /* ignore */ }
    }
    await setStepDone(searchId, teamId, "finalize", { autoAdded }, ["notifier"], []);
    await logActivity(searchId, teamId, "finalize", "success", "🎉",
      `Complete! ${merged.length} leads found, ${verifiedEmails + verifiedPhones} verified, ${autoAdded} auto-added to pipeline${outOfTime() ? " · enrichment stopped at the time limit — re-run to deepen the thin ones" : ""}`,
      { count: merged.length, percent: 100 });
    // Internal cost telemetry — not surfaced to end users, who see credits only.
    console.log(`run ${searchId} vendor cost: $${budget.spentUsd.toFixed(4)} of $${budget.ceilingUsd.toFixed(2)} ceiling`);
  } catch (err) {
    console.error("pipeline failed", err);
    const msg = String(err).slice(0, 300);
    await SUPABASE.from("searches").update({ status: "failed", error_text: msg, completed_at: new Date().toISOString() }).eq("id", searchId);
    await logActivity(searchId, teamId, "error", "error", "❌", `Pipeline crashed: ${msg}`, { percent: 100 });
  }
}
