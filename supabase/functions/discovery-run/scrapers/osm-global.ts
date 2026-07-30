// deno-lint-ignore-file no-explicit-any
// ─── FREE, KEYLESS global business source: OpenStreetMap ─────────────────────
// Nominatim (geocode the search location → bounding box) + Overpass (query
// businesses inside that box). Returns the standard Business shape INCLUDING
// exact lat/lng and street address, so these leads pin precisely on the Areas
// map with no further geocoding. No API key, no billing, global coverage.

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

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const UA = "ReachForDollars/1.0 (lead-discovery; contact via app)";

const CATEGORY_TAGS: Record<string, string[]> = {
  roofing: ['"craft"="roofer"'],
  roofer: ['"craft"="roofer"'],
  hvac: ['"craft"="hvac"', '"shop"="trade"'],
  "air conditioning": ['"craft"="hvac"'],
  heating: ['"craft"="hvac"', '"craft"="plumber"'],
  plumbing: ['"craft"="plumber"'],
  plumber: ['"craft"="plumber"'],
  electrician: ['"craft"="electrician"'],
  electrical: ['"craft"="electrician"'],
  cleaning: ['"shop"="dry_cleaning"', '"craft"="cleaning"', '"office"="cleaning"'],
  landscaping: ['"craft"="gardener"', '"shop"="garden_centre"'],
  painting: ['"craft"="painter"'],
  carpenter: ['"craft"="carpenter"'],
  contractor: ['"craft"="builder"', '"office"="construction_company"'],
  construction: ['"office"="construction_company"', '"craft"="builder"'],
  "real estate": ['"office"="estate_agent"'],
  realtor: ['"office"="estate_agent"'],
  realestate: ['"office"="estate_agent"'],
  insurance: ['"office"="insurance"'],
  lawyer: ['"office"="lawyer"'],
  legal: ['"office"="lawyer"'],
  accountant: ['"office"="accountant"'],
  accounting: ['"office"="accountant"'],
  dentist: ['"amenity"="dentist"', '"healthcare"="dentist"'],
  dental: ['"amenity"="dentist"'],
  doctor: ['"amenity"="doctors"', '"healthcare"="doctor"'],
  clinic: ['"amenity"="clinic"', '"healthcare"="clinic"'],
  restaurant: ['"amenity"="restaurant"'],
  cafe: ['"amenity"="cafe"'],
  coffee: ['"amenity"="cafe"'],
  bar: ['"amenity"="bar"', '"amenity"="pub"'],
  salon: ['"shop"="hairdresser"', '"shop"="beauty"'],
  barber: ['"shop"="hairdresser"'],
  gym: ['"leisure"="fitness_centre"', '"amenity"="gym"'],
  fitness: ['"leisure"="fitness_centre"'],
  auto: ['"shop"="car_repair"', '"shop"="car"'],
  mechanic: ['"shop"="car_repair"'],
  car: ['"shop"="car"', '"shop"="car_repair"'],
  hotel: ['"tourism"="hotel"'],
  pharmacy: ['"amenity"="pharmacy"'],
  bakery: ['"shop"="bakery"'],
  florist: ['"shop"="florist"'],
  veterinary: ['"amenity"="veterinary"'],
  vet: ['"amenity"="veterinary"'],
};

function pickCategoryTags(keyword: string): string[] {
  const k = keyword.toLowerCase();
  for (const [term, tags] of Object.entries(CATEGORY_TAGS)) {
    if (k.includes(term)) return tags;
  }
  return [];
}

async function geocodeBbox(
  location: string,
): Promise<{ south: number; west: number; north: number; east: number; country?: string } | null> {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const url = `${NOMINATIM}?q=${encodeURIComponent(location)}&format=json&limit=1&addressdetails=1`;
    const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, "Accept-Language": "en" } });
    clearTimeout(to);
    if (!res.ok) return null;
    const arr = (await res.json()) as any[];
    const hit = arr?.[0];
    if (!hit?.boundingbox) return null;
    const [s, n, w, e] = hit.boundingbox.map(Number);
    if ([s, n, w, e].some((v) => Number.isNaN(v))) return null;
    return { south: s, north: n, west: w, east: e, country: hit.address?.country };
  } catch {
    return null;
  }
}

function buildOverpassQuery(
  keyword: string,
  bbox: { south: number; west: number; north: number; east: number },
): string {
  const { south, west, north, east } = bbox;
  const box = `(${south},${west},${north},${east})`;
  const catTags = pickCategoryTags(keyword);
  const parts: string[] = [];

  if (catTags.length) {
    for (const t of catTags) {
      parts.push(`node["name"][${t}]${box};`);
      parts.push(`way["name"][${t}]${box};`);
    }
  }
  const safe = keyword.replace(/[\\"]/g, "").slice(0, 40);
  if (safe) {
    for (const tag of ["shop", "office", "craft", "amenity"]) {
      parts.push(`node["name"~"${safe}",i]["${tag}"]${box};`);
      parts.push(`way["name"~"${safe}",i]["${tag}"]${box};`);
    }
  }
  if (parts.length === 0) {
    parts.push(`node["name"]["shop"]${box};`);
    parts.push(`way["name"]["shop"]${box};`);
  }
  return `[out:json][timeout:25];(${parts.join("")});out center 120;`;
}

function tagAddress(tags: Record<string, string>): string | undefined {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const parts = [street, tags["addr:city"], tags["addr:state"], tags["addr:postcode"]].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function hostnameOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export async function scrapeOpenStreetMap(
  keyword: string,
  location: string,
  countryHint?: string,
): Promise<Business[]> {
  const bbox = await geocodeBbox(location);
  if (!bbox) return [];

  const query = buildOverpassQuery(keyword, bbox);
  let elements: any[] = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 25000);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctl.signal,
      });
      clearTimeout(to);
      if (!res.ok) continue;
      const data = await res.json();
      elements = (data?.elements || []) as any[];
      if (elements.length) break;
    } catch {
      // try next mirror
    }
  }

  const out: Business[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const tags = (el.tags || {}) as Record<string, string>;
    const name = tags.name;
    if (!name) continue;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const key = `${name.toLowerCase()}|${lat ?? ""},${lng ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const website = tags.website || tags["contact:website"] || tags.url;
    const phone = tags.phone || tags["contact:phone"] || tags["contact:mobile"];
    const industry = tags.shop || tags.craft || tags.office || tags.amenity || tags.healthcare;

    out.push({
      name,
      city: tags["addr:city"] || location.split(",")[0]?.trim(),
      state: tags["addr:state"],
      country: countryHint || bbox.country,
      address: tagAddress(tags),
      lat: typeof lat === "number" ? lat : undefined,
      lng: typeof lng === "number" ? lng : undefined,
      website,
      domain: hostnameOf(website),
      industry,
      phone,
      sources: ["openstreetmap"],
      raw: { openstreetmap: { id: el.id, type: el.type, tags } },
    });
    if (out.length >= 60) break;
  }
  return out;
}
