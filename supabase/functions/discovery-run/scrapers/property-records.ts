// deno-lint-ignore-file no-explicit-any
// ─── Owner of record from county property data ───────────────────────────────
//
// The search-based decision-maker hunt infers an owner from whatever a web page
// happens to say. That is guesswork, it is rate limited, and when the quota is
// gone it returns nothing at all. County assessor and recorder offices publish
// owner of record and mailing address as public data, so for property-backed
// businesses — cash buyers, wholesalers, landlords, contractors operating from
// an owned address — the owner is a lookup, not an inference.
//
// This runs BEFORE the SERP hunt so search is only spent on the businesses
// records couldn't answer. It has no rate limit of its own, which is the whole
// point: a throttled search provider no longer means zero decision makers.
//
// Data arrives through a hosted Apify actor. We call an API and parse the
// response — no third-party code is downloaded or executed here.

export interface OwnerLookupInput {
  /** Correlates results back to the caller's business list. */
  key: string;
  company: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
}

export interface OwnerRecord {
  key: string;
  ownerName: string;
  /** Mailing address of record — often differs from the property, which is
   *  itself a strong signal for absentee owners. */
  mailingAddress?: string;
  /** Free text from the record: assessed value, deed date, tax status. */
  detail?: Record<string, any>;
}

export interface PropertyDeps {
  apifyToken: string;
  actorId: string;
  /** Called once per actor run so the caller can bill it. */
  onCall?: (units: number, ok: boolean, error?: string) => Promise<void> | void;
  deadlineMs?: number;
  /** Cap on records requested, so one run can't drain an Apify plan. */
  maxItems?: number;
}

/** Titles and suffixes that mean the record names a company, not a person. */
const ENTITY_RX = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co|ltd|limited|trust|estate|partnership|lp|llp|holdings|properties|group|enterprises|bank|association)\b/i;

/**
 * County records write names as "SMITH JOHN A" or "SMITH JOHN & MARY".
 * Normalise to "John Smith" so it matches what the rest of the pipeline
 * expects and so verification and social lookups have something searchable.
 */
export function normaliseOwnerName(raw: string): string {
  let name = (raw || "").trim();
  if (!name) return "";

  // Co-owners: take the first. The second is usually a spouse and duplicating
  // the lead helps nobody.
  name = name.split(/\s*[&]\s*|\s+AND\s+/i)[0].trim();

  // "SMITH JOHN A" → surname first, which is how assessors store it.
  if (name.includes(",")) {
    const [surname, rest] = name.split(",", 2).map((s) => s.trim());
    name = `${rest} ${surname}`.trim();
  }

  const words = name.split(/\s+/).filter(Boolean);
  // Drop a trailing single-letter middle initial; it adds nothing to a search
  // and often breaks exact-match queries.
  const cleaned = words.filter((w, i) => !(i === words.length - 1 && w.replace(/\./g, "").length === 1));

  return cleaned
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .trim();
}

/** True when the name looks like a real person rather than an entity. */
export function looksLikePerson(name: string): boolean {
  if (!name) return false;
  if (ENTITY_RX.test(name)) return false;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-z'’.-]+$/.test(w));
}

/**
 * Pull the owner name out of an actor row.
 *
 * Actors differ in their field names, and a caller may point this at any
 * county-records actor, so accept the common spellings rather than binding to
 * one publisher's schema.
 */
function ownerFrom(row: any): string {
  const candidates = [
    row?.ownerName, row?.owner_name, row?.owner, row?.ownerFullName,
    row?.owner1, row?.primaryOwner, row?.assessedOwner, row?.taxpayerName,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

function mailingFrom(row: any): string | undefined {
  const candidates = [
    row?.mailingAddress, row?.mailing_address, row?.ownerMailingAddress,
    row?.mailAddress, row?.taxpayerAddress,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return undefined;
}

/** Match an actor row back to the input that produced it. */
function matchKey(row: any, inputs: OwnerLookupInput[]): string | null {
  const hay = `${row?.address || row?.propertyAddress || ""} ${row?.city || ""} ${row?.searchQuery || row?.query || ""}`.toLowerCase();
  if (!hay.trim()) return null;
  for (const inp of inputs) {
    const addr = (inp.address || "").toLowerCase();
    // Street number plus the first street word is enough to disambiguate
    // within a city, and survives formatting differences between sources.
    const streetNo = addr.match(/^\s*(\d+)/)?.[1];
    if (streetNo && hay.includes(streetNo) && (!inp.city || hay.includes(inp.city.toLowerCase()))) {
      return inp.key;
    }
    if (inp.company && hay.includes(inp.company.toLowerCase())) return inp.key;
  }
  return null;
}

/**
 * Resolve owners of record for a batch of addresses.
 *
 * Never throws. A property-records outage must leave discovery exactly as it
 * would have been without this step, so every failure path returns what has
 * been gathered so far and lets the SERP hunt take over.
 */
export async function lookupOwners(
  inputs: OwnerLookupInput[],
  deps: PropertyDeps,
): Promise<{ owners: OwnerRecord[]; attempted: number; error?: string }> {
  const withAddress = inputs.filter((i) => (i.address || "").trim().length > 4);
  if (!withAddress.length) return { owners: [], attempted: 0 };
  if (!deps.apifyToken || !deps.actorId) {
    return { owners: [], attempted: 0, error: "property records not configured" };
  }
  if (deps.deadlineMs && Date.now() > deps.deadlineMs) {
    return { owners: [], attempted: 0, error: "deadline reached before lookup" };
  }

  const maxItems = deps.maxItems ?? 100;
  const addresses = withAddress.map((i) =>
    [i.address, i.city, i.state].filter(Boolean).join(", ")
  );

  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(deps.actorId)}/run-sync-get-dataset-items?token=${deps.apifyToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Actors disagree on the input key, so send the batch under the
        // several names in common use. Unknown keys are ignored by Apify.
        body: JSON.stringify({
          addresses,
          address: addresses,
          searchAddresses: addresses,
          queries: addresses,
          maxItems,
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );

    if (!res.ok) {
      const msg = `apify property ${res.status}`;
      await deps.onCall?.(withAddress.length, false, msg);
      return { owners: [], attempted: withAddress.length, error: msg };
    }

    const rows = await res.json();
    if (!Array.isArray(rows)) {
      await deps.onCall?.(withAddress.length, false, "unexpected shape");
      return { owners: [], attempted: withAddress.length, error: "unexpected response shape" };
    }

    const owners: OwnerRecord[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const rawOwner = ownerFrom(row);
      if (!rawOwner) continue;

      const ownerName = normaliseOwnerName(rawOwner);
      // An LLC as owner of record is normal and not a failure — it just isn't
      // a person to call, and the SERP hunt is better placed to find who runs
      // it. Skip rather than writing a company name into a contact's name.
      if (!looksLikePerson(ownerName)) continue;

      const key = matchKey(row, withAddress);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      owners.push({
        key,
        ownerName,
        mailingAddress: mailingFrom(row),
        detail: {
          assessed_value: row?.assessedValue ?? row?.assessed_value,
          last_sale_date: row?.lastSaleDate ?? row?.saleDate,
          tax_status: row?.taxStatus ?? row?.tax_status,
        },
      });
    }

    await deps.onCall?.(withAddress.length, true);
    return { owners, attempted: withAddress.length };
  } catch (e) {
    const msg = String(e);
    await deps.onCall?.(withAddress.length, false, msg);
    return { owners: [], attempted: withAddress.length, error: msg };
  }
}
