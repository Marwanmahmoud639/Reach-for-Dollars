// deno-lint-ignore-file no-explicit-any
// ─── Decision-maker agent: escalating passes until the record is complete ────
//
// The existing DM hunt runs one fixed set of queries and returns whatever the
// first strict match yields — often a name with no way to reach the person.
// This agent treats a decision maker as a record to *fill*: identity, then
// contact details, then social profiles, then verification. Each pass only runs
// when the field it targets is still empty, and each pass has several
// strategies tried in cost order.
//
// Every outside call is injected. This module owns the strategy and the
// escalation logic; the caller owns the transport, the spend ceiling, and the
// cost ledger, so nothing here can bypass a budget or introduce a new vendor.
//
// Scope note: identity and contact details are gathered from public search
// results, public business registries, and the company's own website. It does
// not fetch linkedin.com directly — LinkedIn bans automated access and blocks
// datacenter IPs, so searching *for* profile URLs is both the compliant path
// and the only one that keeps working.

export interface DmInput {
  company: string;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  domain?: string | null;
  /** Anything already known, so the agent skips passes it doesn't need. */
  known?: Partial<DmRecord>;
}

export interface DmRecord {
  name: string;
  title: string;
  email: string;
  phone: string;
  linkedin_url: string;
  facebook_url: string;
  instagram_url: string;
  /** Which strategies contributed, for debugging a thin result. */
  trail: string[];
  /** 0-100. Reflects how much was found and how well it was verified. */
  confidence: number;
}

export type WebResult = { title: string; snippet: string; link: string };

export interface DmDeps {
  /** Search the web. Must already be budget-aware. */
  search: (q: string, opts?: { num?: number; timeoutMs?: number }) => Promise<{ organic: WebResult[] }>;
  /** Fetch a page as text/markdown. Return "" when unavailable. */
  scrape?: (url: string) => Promise<string>;
  /** True when the mailbox is real. Return null when unknown/unconfigured. */
  verifyEmail?: (email: string) => Promise<boolean | null>;
  /** True when the domain has MX records. */
  hasMx?: (domain: string) => Promise<boolean>;
  /** Stop starting new work past this timestamp. */
  deadlineMs?: number;
}

const ROLE_RX =
  /\b(CEO|Chief Executive|Owner|Co-?Founder|Founder|President|Principal|Managing Partner|Managing Director|Proprietor)\b/i;

const NAME_RX = /^[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,3}$/;

const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Emails that belong to infrastructure rather than a person.
const JUNK_EMAIL_RX =
  /example\.|sentry|wixpress|cloudflare|godaddy|squarespace|shopify|schema\.org|w3\.org|placeholder|no-?reply|mailer-daemon|@(?:facebook|linkedin|instagram|twitter|google|apple)\./i;

const PHONE_RX = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/g;

function normPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return null;
  if (/^[01]/.test(ten) || /^[01]/.test(ten.slice(3))) return null;
  return ten;
}

/** Tokens of the company name that are distinctive enough to match on. */
function companyTokens(company: string): string[] {
  return company
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !/^(the|and|llc|inc|co|corp|ltd|company|group|services|service)$/.test(t));
}

/**
 * A candidate only counts when the text ties the person to *this* company.
 *
 * Both name parts must appear, plus either a company token or the city. Without
 * this an "owner" result for a common name attaches a stranger to the lead,
 * which is worse than returning nothing — a bad contact gets called.
 */
function tiesToCompany(blob: string, name: string, company: string, city?: string | null): boolean {
  const hay = blob.toLowerCase();
  const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  if (!parts.every((p) => hay.includes(p))) return false;
  const tokens = companyTokens(company);
  const companyHit = tokens.length > 0 && tokens.some((t) => hay.includes(t));
  const cityHit = !!city && hay.includes(city.toLowerCase());
  return companyHit || cityHit;
}

/** Pull a plausible person name out of a result title. */
function nameFromTitle(title: string): string {
  for (const part of title.split(/[-–—|·,]/).map((s) => s.trim())) {
    if (NAME_RX.test(part) && part.length >= 5 && part.length <= 60) return part;
  }
  return "";
}

function past(deps: DmDeps): boolean {
  return typeof deps.deadlineMs === "number" && Date.now() > deps.deadlineMs;
}

async function safeSearch(deps: DmDeps, q: string, num = 8): Promise<WebResult[]> {
  if (past(deps)) return [];
  try {
    const { organic } = await deps.search(q, { num, timeoutMs: 5500 });
    return organic || [];
  } catch {
    return [];
  }
}

// ─── Pass 1: identity ────────────────────────────────────────────────────────
// Ordered by how reliably each source names an actual officer. Registries first
// because a filing names the owner of record; open-web results last because
// they name whoever the page happens to mention.

/**
 * Query ladder, ordered by precision.
 *
 * Tier 1 asks sources that name an officer as a matter of record. Tier 2 asks
 * where a company states its own leadership. Tier 3 rephrases the question the
 * way a person would type it, which catches interviews, press and directory
 * bios that the structured queries miss.
 *
 * Every tier is tried in order and the first tied-back candidate wins, so a
 * high-precision answer is never passed over for a louder low-precision one.
 * Bare-domain queries are included because a company's own site is often
 * indexed under the domain rather than the trading name.
 */
function identityLadder(input: DmInput): { via: string; q: string }[] {
  const loc = [input.city, input.state].filter(Boolean).join(", ");
  const stateToken = input.state || "";
  const co = input.company;
  const domain = (input.domain || "").replace(/^www\./, "");
  const roles = "(CEO OR Owner OR Founder OR President OR Principal OR \"Managing Member\")";

  const tiers: { via: string; q: string }[] = [
    // ── Tier 1: registries. A filing names the officer of record. ──────────
    { via: "registry_sos", q: `"${co}" "Secretary of State" ${stateToken} (registered agent OR officer OR president)` },
    { via: "registry_opencorporates", q: `"${co}" site:opencorporates.com ${stateToken}` },
    { via: "registry_bizapedia", q: `"${co}" site:bizapedia.com ${stateToken}` },
    { via: "registry_manager", q: `"${co}" ("managing member" OR "registered agent" OR "authorized person") ${stateToken}` },

    // ── Tier 2: the company stating its own leadership. ────────────────────
    { via: "linkedin_profile", q: `site:linkedin.com/in "${co}" ${roles} ${loc}` },
    { via: "linkedin_loose", q: `site:linkedin.com/in ${co} ${roles}` },
    { via: "company_team_page", q: `"${co}" (about OR team OR leadership OR "our story") (owner OR founder OR CEO) ${loc}` },
  ];

  // Domain-seeded. Only meaningful when we actually resolved a website, but
  // when we did it is among the strongest signals available — the about page
  // of the company's own site.
  if (domain) {
    tiers.push(
      { via: "domain_about", q: `site:${domain} (about OR team OR leadership OR founder OR owner)` },
      { via: "domain_owner", q: `"${domain}" ${roles}` },
    );
  }

  tiers.push(
    // ── Tier 3: natural phrasing. Catches interviews, press, bios. ─────────
    { via: "phrase_owner_of", q: `"owner of ${co}"` },
    { via: "phrase_founder_of", q: `("founder of ${co}" OR "co-founder of ${co}" OR "president of ${co}")` },
    { via: "phrase_ceo_of", q: `("CEO of ${co}" OR "principal at ${co}" OR "runs ${co}")` },
    { via: "facebook_page", q: `site:facebook.com "${co}" (owner OR founder) ${loc}` },
    { via: "press_interview", q: `"${co}" (interview OR "spoke with" OR "told us") ${roles}` },
    { via: "open_web", q: `"${co}" ${loc} owner founder CEO president` },
  );

  return tiers;
}

async function findIdentity(
  input: DmInput,
  deps: DmDeps,
): Promise<{ name: string; title: string; linkedin_url: string; via: string } | null> {
  for (const s of identityLadder(input)) {
    const organic = await safeSearch(deps, s.q);
    for (const r of organic) {
      const blob = `${r.title || ""} ${r.snippet || ""} ${r.link || ""}`;
      const role = blob.match(ROLE_RX);
      if (!role) continue;

      const name = nameFromTitle(r.title || "") || nameFromTitle(r.snippet || "");
      if (!name) continue;
      if (!tiesToCompany(blob, name, input.company, input.city)) continue;

      return {
        name,
        title: role[0],
        linkedin_url: (r.link || "").includes("linkedin.com/in") ? r.link : "",
        via: s.via,
      };
    }
  }
  return null;
}

// ─── Pass 2: contact details ─────────────────────────────────────────────────

async function findContact(
  input: DmInput,
  name: string,
  deps: DmDeps,
): Promise<{ emails: string[]; phones: string[]; via: string[] }> {
  const loc = [input.city, input.state].filter(Boolean).join(", ");
  const emails = new Set<string>();
  const phones = new Set<string>();
  const via: string[] = [];

  const harvest = (text: string, tag: string) => {
    let hit = false;
    for (const m of text.matchAll(EMAIL_RX)) {
      const e = m[0].toLowerCase();
      if (!JUNK_EMAIL_RX.test(e)) { emails.add(e); hit = true; }
    }
    for (const m of text.matchAll(PHONE_RX)) {
      const p = normPhone(m[0]);
      if (p) { phones.add(p); hit = true; }
    }
    if (hit && !via.includes(tag)) via.push(tag);
  };

  const domain = (input.domain || "").replace(/^www\./, "");

  // Ordered cheapest-signal-first. The domain-scoped queries are the ones that
  // tend to surface a real personal address rather than a switchboard number:
  // an "@domain" query matches pages that print the address as text, which is
  // exactly where a named person's email appears.
  const contactQueries = [
    `"${name}" "${input.company}" (email OR contact OR phone)`,
    domain ? `"${name}" "@${domain}"` : "",
    domain ? `site:${domain} (contact OR email OR "get in touch")` : "",
    `"${name}" ${loc} phone email`,
    `"${name}" "${input.company}" ("direct" OR "cell" OR "mobile")`,
  ].filter(Boolean) as string[];

  for (const q of contactQueries) {
    for (const r of await safeSearch(deps, q, 10)) {
      harvest(`${r.title || ""} ${r.snippet || ""}`, "search_snippets");
    }
    // Stop as soon as both are covered — further queries only add noise and
    // spend budget the rest of the sweep still needs.
    if (emails.size && phones.size) break;
  }

  // The company's own contact page is the highest-quality source available
  // without paying anyone, so it runs even when snippets already produced hits.
  if (deps.scrape && input.website && !past(deps)) {
    const base = input.website.startsWith("http") ? input.website : `https://${input.website}`;
    const root = base.replace(/\/+$/, "");
    for (const url of [root, `${root}/contact`, `${root}/about`, `${root}/team`]) {
      if (past(deps)) break;
      try {
        const text = await deps.scrape(url);
        if (text && text.length > 30) harvest(text, "company_site");
      } catch { /* next page */ }
      if (emails.size) break;
    }
  }

  return { emails: Array.from(emails).slice(0, 5), phones: Array.from(phones).slice(0, 5), via };
}

// ─── Pass 3: socials ─────────────────────────────────────────────────────────

const SOCIALS: { key: "linkedin_url" | "facebook_url" | "instagram_url"; site: string; rx: RegExp }[] = [
  { key: "linkedin_url", site: "linkedin.com/in", rx: /linkedin\.com\/in\// },
  { key: "facebook_url", site: "facebook.com", rx: /facebook\.com\// },
  { key: "instagram_url", site: "instagram.com", rx: /instagram\.com\// },
];

async function findSocials(
  input: DmInput,
  name: string,
  have: Partial<DmRecord>,
  deps: DmDeps,
): Promise<Partial<Record<"linkedin_url" | "facebook_url" | "instagram_url", string>>> {
  const out: Record<string, string> = {};
  const loc = input.city || "";

  for (const s of SOCIALS) {
    if (have[s.key]) continue;
    if (past(deps)) break;
    const organic = await safeSearch(
      deps,
      `site:${s.site} "${name}" ${input.company} ${loc}`.trim(),
      5,
    );
    for (const r of organic) {
      if (!r.link || !s.rx.test(r.link)) continue;
      // Same tie-back rule as identity: a profile that never mentions the
      // company or city is probably a different person with the same name.
      if (!tiesToCompany(`${r.title || ""} ${r.snippet || ""} ${r.link}`, name, input.company, input.city)) continue;
      out[s.key] = r.link;
      break;
    }
  }
  return out;
}

// ─── Pass 4: pick and verify an email ────────────────────────────────────────

/** Prefer a personal address on the company domain over a generic inbox. */
function rankEmails(emails: string[], name: string, domain?: string | null): string[] {
  const [first = "", last = ""] = name.toLowerCase().split(/\s+/);
  return [...emails].sort((a, b) => score(b) - score(a));

  function score(e: string): number {
    let s = 0;
    const [local, host] = e.split("@");
    if (domain && host === domain.toLowerCase().replace(/^www\./, "")) s += 10;
    if (first && local.includes(first)) s += 5;
    if (last && local.includes(last)) s += 5;
    if (/^(info|contact|hello|sales|admin|support|office)$/.test(local)) s -= 4;
    return s;
  }
}

/**
 * Run the agent. Never throws: a discovery run must survive one bad lead.
 *
 * Returns null only when no person could be identified at all — a record with
 * a name but no contact details is still worth keeping, because the skip-trace
 * step downstream can work from the name.
 */
export async function runDmAgent(input: DmInput, deps: DmDeps): Promise<DmRecord | null> {
  try {
    const trail: string[] = [];
    const rec: Partial<DmRecord> = { ...(input.known || {}) };

    if (!rec.name) {
      const id = await findIdentity(input, deps);
      if (!id) return null;
      rec.name = id.name;
      rec.title = rec.title || id.title;
      if (id.linkedin_url) rec.linkedin_url = id.linkedin_url;
      trail.push(id.via);
    }

    const name = rec.name!;

    if (!rec.email || !rec.phone) {
      const contact = await findContact(input, name, deps);
      trail.push(...contact.via);
      if (!rec.phone && contact.phones.length) rec.phone = contact.phones[0];
      if (!rec.email && contact.emails.length) {
        const ranked = rankEmails(contact.emails, name, input.domain);
        rec.email = ranked[0];
      }
    }

    const socials = await findSocials(input, name, rec, deps);
    if (Object.keys(socials).length) {
      Object.assign(rec, socials);
      trail.push("socials");
    }

    // Verification. MX first because it's free and rules out dead domains; the
    // mailbox check only runs on an address that survived it.
    let verified = false;
    if (rec.email) {
      const host = rec.email.split("@")[1];
      const mxOk = deps.hasMx ? await deps.hasMx(host).catch(() => true) : true;
      if (!mxOk) {
        delete rec.email;
        trail.push("email_dropped_no_mx");
      } else if (deps.verifyEmail) {
        const ok = await deps.verifyEmail(rec.email).catch(() => null);
        if (ok === false) {
          delete rec.email;
          trail.push("email_dropped_undeliverable");
        } else if (ok === true) {
          verified = true;
          trail.push("email_verified");
        }
      }
    }

    return {
      name,
      title: rec.title || "",
      email: rec.email || "",
      phone: rec.phone || "",
      linkedin_url: rec.linkedin_url || "",
      facebook_url: rec.facebook_url || "",
      instagram_url: rec.instagram_url || "",
      trail,
      confidence: confidenceOf(rec, verified),
    };
  } catch {
    return null;
  }
}

/**
 * Confidence weights reachability over completeness: a verified email is worth
 * more than three social links, because it's the one that lets you make contact.
 */
function confidenceOf(rec: Partial<DmRecord>, verifiedEmail: boolean): number {
  let s = 20; // a tied-back identity is already worth something
  if (rec.title) s += 10;
  if (rec.email) s += verifiedEmail ? 30 : 18;
  if (rec.phone) s += 22;
  if (rec.linkedin_url) s += 10;
  if (rec.facebook_url) s += 4;
  if (rec.instagram_url) s += 4;
  return Math.min(100, s);
}
