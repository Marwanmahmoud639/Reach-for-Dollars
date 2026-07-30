// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Individual = {
  full_name: string;
  first_name: string;
  last_name: string;
  role: string;
  company?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  facebook_url?: string;
  instagram_url?: string;
  twitter_url?: string;
  youtube_url?: string;
  reddit_username?: string;
  twitter_handle?: string;
  instagram_handle?: string;
  confidence: number;
  sources: string[];
  raw: Record<string, any>;
};

// ─── GLOBAL phone extraction (mirrors discovery-run) ─────────────────────────
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

// ─── FREE skip-trace for an individual (Serper if present, DDG fallback) ────
async function freeSkiptraceIndividual(
  args: { name: string; company?: string; city?: string; state?: string; country?: string },
  serperKey: string,
  firecrawlKey: string | null,
): Promise<{ phones: Map<string, Set<string>>; emails: Map<string, Set<string>> }> {

  const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const JUNK_EMAIL_RX = /example\.com|sentry|wixpress|cloudflare|domain\.com|googleapis|schema\.org|w3\.org|placeholder|noreply|no-reply|mailer-daemon/i;
  const JUNK_DOMAIN_RX = /facebook\.com|linkedin\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|google\.com|bing\.com|yahoo\.com|reddit\.com|wikipedia\.org|github\.com|pinterest\.com|tiktok\.com|apple\.com|microsoft\.com|amazon\.com/i;
  const PEOPLE_SEARCH_RX = /truepeoplesearch|thatsthem|cyberbackgroundchecks|spokeo|whitepages|beenverified|intelius|peoplefinder|fastpeoplesearch|zabasearch/i;

  const phones = new Map<string, Set<string>>();
  const emails = new Map<string, Set<string>>();
  const addPhone = (p: string, src: string) => { if (!phones.has(p)) phones.set(p, new Set()); phones.get(p)!.add(src); };
  const addEmail = (e: string, src: string) => {
    const email = e.toLowerCase();
    if (JUNK_EMAIL_RX.test(email)) return;
    const dom = email.split("@")[1];
    if (!dom || JUNK_DOMAIN_RX.test(dom)) return;
    if (!emails.has(email)) emails.set(email, new Set());
    emails.get(email)!.add(src);
  };

  const loc = [args.city, args.state, args.country].filter(Boolean).join(", ");
  const queries = [
    `"${args.name}" "${args.company || ""}" phone email contact`,
    `"${args.name}" ${args.company || ""} ${loc} phone OR email OR contact`,
    `"${args.name}" ${loc} phone number email address`,
  ].filter((q) => q.trim().length > 10);

  for (const q of queries) {
    try {
      const organic = await unifiedSearch(q, serperKey || null, 10, firecrawlKey);
      const providerLabel = serperKey ? "serper_web" : firecrawlKey ? "firecrawl_web" : "ddg_web";
      for (const r of organic) {
        const blob = `${r.title || ""} ${r.snippet || ""}`;
        // Strict identity gate: only accept phones/emails from pages whose
        // title/snippet mentions this person + (company OR city).
        if (!strictIdentityMatch(`${blob} ${r.link || ""}`, args.name, args.company, args.city)) continue;
        for (const ph of extractPhones(blob)) addPhone(ph, providerLabel);
        for (const m of blob.matchAll(EMAIL_RX)) addEmail(m[0], providerLabel);
      }

      if (firecrawlKey) {
        const urls: string[] = [];
        for (const r of organic) {
          if (!r.link) continue;
          try {
            const host = new URL(r.link).hostname.toLowerCase();
            if (JUNK_DOMAIN_RX.test(host) || PEOPLE_SEARCH_RX.test(host)) continue;
            // Only crawl pages whose SERP snippet already passes strict match.
            if (!strictIdentityMatch(`${r.title || ""} ${r.snippet || ""} ${r.link}`, args.name, args.company, args.city)) continue;
            urls.push(r.link);
          } catch { /* skip */ }
        }
        for (const pageUrl of urls.slice(0, 3)) {
          try {
            const sr = await fetch("https://api.firecrawl.dev/v1/scrape", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${firecrawlKey}` },
              body: JSON.stringify({ url: pageUrl, formats: ["markdown"], onlyMainContent: true, waitFor: 2000 }),
            });
            if (!sr.ok) continue;
            const sd = await sr.json();
            const md: string = sd?.data?.markdown || "";
            if (!md || md.length < 50) continue;
            // Verify person's name still appears in the crawled body.
            if (!strictIdentityMatch(md, args.name, args.company, args.city)) continue;
            for (const ph of extractPhones(md)) addPhone(ph, "firecrawl_web");
            for (const m of md.matchAll(EMAIL_RX)) addEmail(m[0], "firecrawl_web");
          } catch { /* skip page */ }
        }
      }
      if (phones.size >= 2 || emails.size >= 2) break;
    } catch { /* next query */ }
  }
  return { phones, emails };

}

// ─── Social profile lookup (Serper + DDG fallback, strict identity) ─────────
const SOCIAL_PLATFORMS = [
  { key: "facebook_url" as const, site: "facebook.com", hostRx: /(^|\.)facebook\.com$/i },
  { key: "instagram_url" as const, site: "instagram.com", hostRx: /(^|\.)instagram\.com$/i },
  { key: "twitter_url" as const, site: "twitter.com OR site:x.com", hostRx: /(^|\.)(twitter|x)\.com$/i },
  { key: "youtube_url" as const, site: "youtube.com", hostRx: /(^|\.)youtube\.com$/i },
];

// Strict identity match: require first + last name AND (company OR city)
// in the title/snippet/path. Prevents wrong profiles with common names.
function strictIdentityMatch(
  hay: string,
  fullName: string,
  company: string | undefined,
  city: string | undefined,
): boolean {
  const h = hay.toLowerCase();
  const parts = fullName.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (parts.length < 2) return false;
  if (!h.includes(parts[0]) || !h.includes(parts[parts.length - 1])) return false;
  const comp = (company || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const cty = (city || "").toLowerCase().trim();
  const compTokens = comp.split(/\s+/).filter(w => w.length >= 3 && !["llc","inc","the","and","group","company","co"].includes(w));
  const compHit = compTokens.length > 0 && compTokens.some(t => h.includes(t));
  const cityHit = cty.length >= 3 && h.includes(cty);
  return compHit || cityHit;
}

// DuckDuckGo HTML fallback so free path runs with zero API keys.
async function duckSearchOrganic(query: string, num = 10): Promise<{ title: string; snippet: string; link: string }[]> {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 7000);
    const res = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "en-US,en",
      },
      signal: ctl.signal,
    });
    clearTimeout(to);
    if (!res.ok) return [];
    const html = await res.text();
    const out: { title: string; snippet: string; link: string }[] = [];
    const rx = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    while ((m = rx.exec(html)) !== null) {
      let href = m[1];
      try {
        const u = new URL(href, "https://duckduckgo.com");
        const t = u.searchParams.get("uddg");
        if (t) href = decodeURIComponent(t);
      } catch { /* keep href */ }
      out.push({ link: href, title: strip(m[2]), snippet: strip(m[3]) });
      if (out.length >= num) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function unifiedSearch(
  query: string,
  serperKey: string | null,
  num = 10,
  firecrawlKey: string | null = null,
): Promise<{ title: string; snippet: string; link: string }[]> {
  if (serperKey) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num }),
        signal: ctl.signal,
      });
      clearTimeout(to);
      if (res.ok) {
        const j = await res.json();
        const org = (j.organic || []).map((o: any) => ({ title: o.title || "", snippet: o.snippet || "", link: o.link || "" }));
        if (org.length) return org;
      }
    } catch { /* fall through */ }
  }

  // Firecrawl search — the working fallback. duckSearchOrganic() below now
  // hits an anti-bot challenge page and returns nothing, so without this
  // (or a Serper key) the whole people-lookup pipeline finds zero results.
  if (firecrawlKey) {
    try {
      const res = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${firecrawlKey}` },
        body: JSON.stringify({ query, limit: num }),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.success) {
          const org = ((j.data || []) as any[]).map((o) => ({
            title: (o.title || o.metadata?.title || "") as string,
            snippet: (o.description || o.metadata?.description || o.markdown || "") as string,
            link: (o.url || o.metadata?.sourceURL || "") as string,
          })).filter((o) => o.link);
          if (org.length) return org;
        }
      }
    } catch { /* fall through */ }
  }

  return duckSearchOrganic(query, num);
}

async function serperTopUrl(query: string, apiKey: string, hostRx: RegExp, firecrawlKey: string | null = null): Promise<string | null> {
  const results = await unifiedSearch(query, apiKey || null, 5, firecrawlKey);
  for (const o of results) {
    if (!o.link) continue;
    try { if (hostRx.test(new URL(o.link).hostname)) return o.link; } catch { /* ignore */ }
  }
  return null;
}

async function enrichSocials(
  fullName: string | undefined,
  company: string | undefined,
  serperKey: string | undefined,
  city?: string | undefined,
  firecrawlKey: string | null = null,
): Promise<Partial<Record<"facebook_url" | "instagram_url" | "twitter_url" | "youtube_url", string>>> {
  if (!fullName) return {};
  const q = `"${fullName}"${company ? ` "${company}"` : ""}${city ? ` "${city}"` : ""}`;
  const results = await Promise.allSettled(
    SOCIAL_PLATFORMS.map(async (p) => {
      const items = await unifiedSearch(`site:${p.site} ${q}`, serperKey || null, 8, firecrawlKey);
      for (const it of items) {
        if (!it.link) continue;
        try {
          const url = new URL(it.link);
          if (!p.hostRx.test(url.hostname)) continue;
          const hay = `${it.title} ${it.snippet} ${url.pathname}`;
          if (!strictIdentityMatch(hay, fullName, company, city)) continue;
          return { key: p.key, url: it.link as string | null };
        } catch { /* ignore */ }
      }
      return { key: p.key, url: null as string | null };
    }),
  );
  const out: Record<string, string> = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.url) out[r.value.key] = r.value.url;
  }
  return out;
}


async function queryLinkedIn(keyword: string, location: string, roles: string[], apiKey: string): Promise<Individual[]> {
  const res = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey, "Cache-Control": "no-cache" },
    body: JSON.stringify({
      q_keywords: [keyword],
      person_locations: location ? [location] : undefined,
      person_titles: roles,
      page: 1,
      per_page: 50,
    }),
  });
  if (!res.ok) throw new Error(`linkedin/apollo ${res.status}`);
  const data = await res.json();
  const people = data.people || [];
  return people.slice(0, 50).map((p: any): Individual => ({
    full_name: p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim(),
    first_name: p.first_name || "",
    last_name: p.last_name || "",
    role: p.title || "Unknown",
    company: p.organization?.name,
    city: p.city || location.split(",")[0]?.trim(),
    state: p.state,
    email: p.email,
    linkedin_url: p.linkedin_url,
    confidence: 65,
    sources: ["linkedin"],
    raw: { apollo_person: p },
  }));
}

async function queryFacebook(keyword: string, location: string, _roles: string[], apiKey: string): Promise<Individual[]> {
  const query = encodeURIComponent(`${keyword} ${location}`);
  const url = `https://graph.facebook.com/v18.0/search?type=user&q=${query}&access_token=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`facebook ${res.status}`);
    const data = await res.json();
    const users = data.data || [];
    return users.slice(0, 30).map((u: any): Individual => ({
      full_name: u.name,
      first_name: u.name.split(" ")[0],
      last_name: u.name.split(" ").slice(1).join(" "),
      role: "Unknown",
      facebook_url: `https://facebook.com/${u.id}`,
      confidence: 40,
      sources: ["facebook"],
      raw: { facebook_user: u },
    }));
  } catch {
    return [];
  }
}

async function queryReddit(keyword: string, subreddits: string[], limit = 30): Promise<Individual[]> {
  const subs = subreddits.join("+");
  const url = `https://www.reddit.com/r/${subs}/search.json?q=${encodeURIComponent(keyword)}&limit=${limit}&sort=new`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "R4D Discovery Engine v1.0" } });
    if (!res.ok) throw new Error(`reddit ${res.status}`);
    const data = await res.json();
    const posts = data.data?.children || [];
    const individuals: Individual[] = [];
    const seen = new Set<string>();
    for (const post of posts) {
      const author = post.data?.author;
      if (!author || author === "[deleted]" || seen.has(author)) continue;
      seen.add(author);
      individuals.push({
        full_name: author,
        first_name: author.split("_")[0],
        last_name: author.split("_")[1] || "",
        role: keyword,
        reddit_username: author,
        confidence: 35,
        sources: ["reddit"],
        raw: { reddit_author: author, post_title: post.data?.title },
      });
    }
    return individuals.slice(0, 30);
  } catch {
    return [];
  }
}

async function queryGooglePeople(keyword: string, location: string, apiKey: string | null, firecrawlKey: string | null = null): Promise<Individual[]> {
  // "profile" answer box only comes from Serper; when we don't have a key we
  // fall through to organic web results via DDG below.
  if (apiKey) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: `${keyword} ${location}`, type: "profile", num: 30 }),
      });
      if (res.ok) {
        const data = await res.json();
        const profiles = data.profiles || data.peopleResults || [];
        if (profiles.length) {
          return profiles.slice(0, 30).map((p: any): Individual => ({
            full_name: p.name || p.title || "Unknown",
            first_name: (p.name || "").split(" ")[0],
            last_name: (p.name || "").split(" ").slice(1).join(" "),
            role: p.description || p.subtitle || "Unknown",
            city: p.location || location.split(",")[0]?.trim(),
            confidence: 50,
            sources: ["google"],
            raw: { google_profile: p },
          }));
        }
      }
    } catch { /* fall through to DDG */ }
  }
  // Fallback — extract name-shaped titles from organic results. Routed through
  // unifiedSearch so this uses Firecrawl when available; bare DDG returns an
  // anti-bot challenge page and yields nothing.
  const items = await unifiedSearch(`${keyword} ${location} owner OR founder OR broker`, null, 20, firecrawlKey);
  const out: Individual[] = [];
  for (const r of items) {
    const titleParts = (r.title || "").split(/[-–—|·]/).map((s: string) => s.trim()).filter(Boolean);
    const cand = titleParts[0] || "";
    const words = cand.trim().split(/\s+/);
    if (words.length < 2 || words.length > 5 || /^[\d\W]+$/.test(cand)) continue;
    out.push({
      full_name: cand, first_name: words[0], last_name: words.slice(1).join(" "),
      role: "Unknown", city: location.split(",")[0]?.trim(),
      confidence: 40, sources: [firecrawlKey ? "firecrawl_google" : "ddg_google"], raw: { search: r },
    });
  }
  return out.slice(0, 25);
}

async function querySerperIndividuals(keyword: string, location: string, platform: "linkedin" | "facebook" | "twitter" | "instagram", apiKey: string | null, firecrawlKey: string | null = null): Promise<Individual[]> {
  const siteMap = {
    linkedin: "site:linkedin.com/in",
    facebook: "site:facebook.com",
    twitter: "site:twitter.com OR site:x.com",
    instagram: "site:instagram.com",
  };
  const q = `${siteMap[platform]} "${keyword}"${location ? ` "${location}"` : ""}`;
  try {
    const organic = await unifiedSearch(q, apiKey || null, 20, firecrawlKey);
    const individuals: Individual[] = [];
    for (const r of organic) {
      const titleParts = (r.title || "").split(/[-–—|·]/).map((s: string) => s.trim()).filter(Boolean);
      const candidateName = titleParts[0] || "";
      const words = candidateName.trim().split(/\s+/);
      if (words.length < 2 || words.length > 5 || /^[\d\W]+$/.test(candidateName)) continue;

      const ind: Individual = {
        full_name: candidateName,
        first_name: words[0],
        last_name: words.slice(1).join(" "),
        role: "Unknown",
        confidence: apiKey ? 45 : 38,
        sources: [`${apiKey ? "serper" : "ddg"}_${platform}`],
        raw: { search: r },
      };

      if (platform === "linkedin") ind.linkedin_url = r.link;
      if (platform === "facebook") ind.facebook_url = r.link;
      if (platform === "twitter") ind.twitter_url = r.link;
      if (platform === "instagram") ind.instagram_url = r.link;

      individuals.push(ind);
    }
    return individuals;
  } catch {
    return [];
  }
}



async function geocodeLocation(location: string, googleMapsKey: string) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${googleMapsKey}`;
    const res = await fetch(url);
    const data = await res.json();
    const result = data.results?.[0];
    if (!result) return null;
    return { lat: result.geometry.location.lat, lng: result.geometry.location.lng };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { search_id, roles } = await req.json();
    if (!search_id) return new Response("missing search_id", { status: 400, headers: corsHeaders });

    const { data: search } = await SUPABASE.from("individual_searches").select("team_id").eq("id", search_id).maybeSingle();
    if (!search) return new Response("not found", { status: 404, headers: corsHeaders });

    const work = runIndividualPipeline(search_id, roles || []);
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
      // @ts-ignore
      (EdgeRuntime as any).waitUntil(work);
    } else {
      work.catch((e) => console.error("pipeline error", e));
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});

async function runIndividualPipeline(searchId: string, roles: string[]) {
  const t0 = Date.now();
  const { data: search } = await SUPABASE.from("individual_searches").select("*").eq("id", searchId).single();
  if (!search) return;
  const teamId = search.team_id as string;
  const { data: settings } = await SUPABASE.from("team_settings").select("*").eq("team_id", teamId).maybeSingle();

  // Find the first pipeline stage (new leads)
  const { data: stages } = await SUPABASE.from("pipeline_stages")
    .select("id").eq("team_id", teamId).order("position", { ascending: true }).limit(1);
  const newLeadStage = stages?.[0] || null;

  await SUPABASE.from("individual_searches").update({ status: "running" }).eq("id", searchId);

  const keyword = search.keyword as string;
  const location = (search.location as string) || "";
  const platforms = (search.platforms as string[]) || ["linkedin"];

  const sources_success: Record<string, boolean> = {};
  const sources_failed: Record<string, string> = {};
  const all: Individual[] = [];

  async function checkCancelled(): Promise<boolean> {
    const { data } = await SUPABASE.from("individual_searches").select("status").eq("id", searchId).single();
    return data?.status === "cancelled";
  }

  try {
    if (await checkCancelled()) return;
    const tasks: Promise<{ name: string; items: Individual[] }>[] = [];

    const serperKeyOpt: string | null = (settings?.serper_api_key as string | undefined) || null;
    const firecrawlKeyOpt: string | null = (settings?.firecrawl_api_key as string | undefined) || null;

    if (platforms.includes("linkedin")) {
      if (settings?.apollo_key) {
        tasks.push(queryLinkedIn(keyword, location, roles, settings.apollo_key)
          .then((items) => ({ name: "linkedin", items }))
          .catch((e) => { console.error("linkedin failed", e); sources_failed["linkedin"] = String(e); return { name: "linkedin", items: [] }; }));
      } else {
        tasks.push(querySerperIndividuals(keyword, location, "linkedin", serperKeyOpt, firecrawlKeyOpt)
          .then((items) => ({ name: "linkedin", items })));
      }
    }
    if (platforms.includes("facebook")) {
      if (settings?.facebook_api_key) {
        tasks.push(queryFacebook(keyword, location, roles, settings.facebook_api_key)
          .then((items) => ({ name: "facebook", items }))
          .catch((e) => { console.error("facebook failed", e); sources_failed["facebook"] = String(e); return { name: "facebook", items: [] }; }));
      } else {
        tasks.push(querySerperIndividuals(keyword, location, "facebook", serperKeyOpt, firecrawlKeyOpt)
          .then((items) => ({ name: "facebook", items })));
      }
    }
    if (platforms.includes("twitter")) {
      tasks.push(querySerperIndividuals(keyword, location, "twitter", serperKeyOpt, firecrawlKeyOpt)
          .then((items) => ({ name: "twitter", items })));
    }
    if (platforms.includes("instagram")) {
      tasks.push(querySerperIndividuals(keyword, location, "instagram", serperKeyOpt, firecrawlKeyOpt)
          .then((items) => ({ name: "instagram", items })));
    }
    if (platforms.includes("reddit")) {
      const subs = (settings?.default_subreddits as string[] | null) || ["Wholesaling", "RealEstate", "investing"];
      tasks.push(queryReddit(keyword, subs)
        .then((items) => ({ name: "reddit", items }))
        .catch((e) => { console.error("reddit failed", e); sources_failed["reddit"] = String(e); return { name: "reddit", items: [] }; }));
    }
    if (platforms.includes("google")) {
      tasks.push(queryGooglePeople(keyword, location, serperKeyOpt, firecrawlKeyOpt)
        .then((items) => ({ name: "google", items }))
        .catch((e) => { console.error("google failed", e); sources_failed["google"] = String(e); return { name: "google", items: [] }; }));
    }


    const settled = await Promise.allSettled(tasks);
    if (await checkCancelled()) return;

    for (const r of settled) {
      if (r.status === "fulfilled") {
        if (r.value.items.length > 0) sources_success[r.value.name] = true;
        all.push(...r.value.items);
      }
    }

    const deduped = new Map<string, Individual>();
    for (const ind of all) {
      const key = `${ind.full_name.toLowerCase()}|${(ind.company || "").toLowerCase()}`;
      const existing = deduped.get(key);
      if (!existing) deduped.set(key, ind);
      else {
        existing.sources = Array.from(new Set([...existing.sources, ...ind.sources]));
        existing.email ||= ind.email;
        existing.phone ||= ind.phone;
        existing.linkedin_url ||= ind.linkedin_url;
        existing.facebook_url ||= ind.facebook_url;
        existing.instagram_url ||= ind.instagram_url;
        existing.twitter_url ||= ind.twitter_url;
        existing.youtube_url ||= ind.youtube_url;
        existing.reddit_username ||= ind.reddit_username;
        existing.confidence = Math.max(existing.confidence, ind.confidence);
      }
    }
    const merged = Array.from(deduped.values());
    if (await checkCancelled()) return;

    // Social enrichment + free skip-trace. Runs even without any API keys
    // by falling back to DuckDuckGo scraping inside unifiedSearch/freeSkiptrace.
    const serperKey = (settings?.serper_api_key as string | undefined) || "";
    const firecrawlKey = (settings?.firecrawl_api_key as string | undefined) || null;
    {
      const BATCH = 5;
      for (let i = 0; i < merged.length; i += BATCH) {
        const slice = merged.slice(i, i + BATCH);
        await Promise.allSettled(slice.map(async (ind) => {
          const socials = await enrichSocials(ind.full_name, ind.company, serperKey, ind.city, firecrawlKey);
          if (socials.facebook_url) ind.facebook_url ||= socials.facebook_url;
          if (socials.instagram_url) ind.instagram_url ||= socials.instagram_url;
          if (socials.twitter_url) ind.twitter_url ||= socials.twitter_url;
          if (socials.youtube_url) ind.youtube_url ||= socials.youtube_url;
        }));
      }

      // FREE skip-trace: fill phone + verified email for each individual.
      const ST_BATCH = 4;
      for (let i = 0; i < merged.length; i += ST_BATCH) {
        if (await checkCancelled()) return;
        const slice = merged.slice(i, i + ST_BATCH);
        await Promise.allSettled(slice.map(async (ind) => {
          const { phones, emails } = await freeSkiptraceIndividual(
            { name: ind.full_name, company: ind.company, city: ind.city, state: ind.state, country: ind.country },
            serperKey, firecrawlKey,
          );
          if (ind.phone) { if (!phones.has(ind.phone)) phones.set(ind.phone, new Set()); phones.get(ind.phone)!.add("discovery"); }
          if (ind.email) { const e = ind.email.toLowerCase(); if (!emails.has(e)) emails.set(e, new Set()); emails.get(e)!.add("discovery"); }
          const phoneList = Array.from(phones.entries())
            .map(([phone, srcs]) => ({ phone, sources: Array.from(srcs), verified: srcs.size >= 2 }))
            .sort((a, b) => b.sources.length - a.sources.length).slice(0, 5);
          const emailList = Array.from(emails.entries())
            .map(([email, srcs]) => ({ email, sources: Array.from(srcs), verified: srcs.size >= 2 }))
            .sort((a, b) => b.sources.length - a.sources.length).slice(0, 5);
          (ind as any)._phones = phoneList;
          (ind as any)._emails = emailList;
          if (!ind.phone && phoneList[0]) ind.phone = phoneList[0].phone;
          if (!ind.email && emailList[0]) ind.email = emailList[0].email;
        }));
      }
    }


    let mapCenterLat: number | null = null;
    let mapCenterLng: number | null = null;
    const locationsGeocoded: any[] = [];
    if (settings?.google_maps_key && location) {
      const center = await geocodeLocation(location, settings.google_maps_key);
      if (center) {
        mapCenterLat = center.lat;
        mapCenterLng = center.lng;
        locationsGeocoded.push({ lat: center.lat, lng: center.lng, name: location, type: "search_center" });
      }
    }
    if (await checkCancelled()) return;

    for (const ind of merged) {
      const { data: existingContact } = await SUPABASE
        .from("contacts").select("id").eq("team_id", teamId).ilike("name", ind.full_name)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      let contactId = existingContact?.id as string | undefined;
      let isNew = false;
      const contactRow = {
        team_id: teamId,
        name: ind.full_name,
        title: ind.role || null,
        company: ind.company || null,
        email: ind.email || null,
        phone: ind.phone || null,
        city: ind.city || null,
        state: ind.state || null,
        country: ind.country || null,
        linkedin_url: ind.linkedin_url || null,
        facebook_url: ind.facebook_url || null,
        instagram_url: ind.instagram_url || null,
        twitter_url: ind.twitter_url || null,
        youtube_url: ind.youtube_url || null,
        lead_score: ind.confidence,
        source: "individual_discovery",
        discovery_keyword: keyword,
        auto_added_by_discovery: true,
        last_activity_at: new Date().toISOString(),
      };
      
      if (!ind.city && !ind.state && mapCenterLat && mapCenterLng) {
        (contactRow as any).lat = mapCenterLat;
        (contactRow as any).lng = mapCenterLng;
      }

      if (contactId) {
        await SUPABASE.from("contacts").update(contactRow).eq("id", contactId);
      } else {
        const { data: ins, error } = await SUPABASE.from("contacts").insert(contactRow).select("id").single();
        if (error) { console.error("contact insert error", error); continue; }
        contactId = ins.id;
        isNew = true;
      }
      await SUPABASE.from("individual_search_results").insert({
        team_id: teamId,
        search_id: searchId,
        contact_id: contactId,
        full_name: ind.full_name,
        first_name: ind.first_name,
        last_name: ind.last_name,
        role: ind.role,
        company_name: ind.company,
        city: ind.city,
        state: ind.state,
        email: ind.email,
        phone: ind.phone,
        linkedin_url: ind.linkedin_url,
        facebook_url: ind.facebook_url,
        reddit_username: ind.reddit_username,
        twitter_handle: ind.twitter_handle,
        instagram_handle: ind.instagram_handle,
        sources: ind.sources,
        confidence_score: ind.confidence,
        is_new_contact: isNew,
        auto_added_to_pipeline: true,
        raw_data: ind.raw,
      });

      // Persist enriched phones (deduped, with verification).
      const phoneList = ((ind as any)._phones || []) as { phone: string; sources: string[]; verified: boolean }[];
      if (contactId && phoneList.length) {
        const { data: existingPhones } = await SUPABASE
          .from("contact_phones").select("phone_number").eq("contact_id", contactId);
        const seen = new Set((existingPhones ?? []).map((r: any) => String(r.phone_number).replace(/\D/g, "").slice(-10)));
        const fresh = phoneList
          .filter((p) => !seen.has(p.phone.replace(/\D/g, "").slice(-10)))
          .map((p, idx) => ({
            team_id: teamId, contact_id: contactId!,
            phone_number: p.phone, phone_type: "unknown" as const,
            confidence_score: Math.min(100, 50 + p.sources.length * 10),
            sources: p.sources, is_primary: idx === 0, verified: p.verified,
          }));
        if (fresh.length) await SUPABASE.from("contact_phones").insert(fresh);
      }

      // auto-pipeline - User requested all leads be added
      if (newLeadStage?.id) {
        const { data: existingLeadRows } = await SUPABASE.from("pipeline_leads")
          .select("id").eq("team_id", teamId).eq("contact_id", contactId).limit(1);
        if (!existingLeadRows?.length) {
          await SUPABASE.from("pipeline_leads").insert({
            team_id: teamId, contact_id: contactId, stage_id: newLeadStage.id,
            notes: `Auto-added from Individual Discovery: ${keyword}`,
          });
        }
      }
    }

    const isVerified = (i: any) =>
      (i._phones || []).some((p: any) => p.verified) || (i._emails || []).some((e: any) => e.verified);
    const verifiedCount = merged.filter(isVerified).length;

    const successCount = Object.keys(sources_success).length;
    const failedCount = Object.keys(sources_failed).length;
    const finalSearch = await SUPABASE.from("individual_searches").select("status").eq("id", searchId).single();
    if (finalSearch.data?.status === "cancelled") return;
    
    const finalStatus = successCount === 0 ? "failed" : failedCount > 0 ? "partial" : "complete";

    await SUPABASE.from("individual_searches").update({
      status: finalStatus,
      individuals_found: merged.length,
      verified_count: verifiedCount,
      sources_success,
      sources_failed,
      completed_at: new Date().toISOString(),
      duration_seconds: Math.round((Date.now() - t0) / 1000),
      map_center_lat: mapCenterLat,
      map_center_lng: mapCenterLng,
      locations_geocoded: locationsGeocoded,
    }).eq("id", searchId);

    await SUPABASE.from("notifications").insert({
      team_id: teamId,
      user_id: search.user_id,
      title: `Individual discovery complete: ${keyword}`,
      body: `Found ${merged.length} individuals (${verifiedCount} verified)`,
      type: "discovery_complete",
      link: `/discovery?tab=individuals&search=${searchId}`,
    });
  } catch (err) {
    console.error("pipeline failed", err);
    await SUPABASE.from("individual_searches").update({
      status: "failed",
      error_text: String(err),
      completed_at: new Date().toISOString(),
    }).eq("id", searchId);
  }
}
