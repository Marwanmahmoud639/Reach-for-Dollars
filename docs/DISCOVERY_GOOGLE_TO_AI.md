# Pulling from Google into the AI (Discovery)

This is how the Discovery pipeline pulls people/companies **out of Google
search results** and feeds them into the AI enrichment + decision-maker
extraction steps. Use it as the reference when tuning queries or debugging
"why didn't it find X".

## 1. Search backend cascade

`webSearch()` in `supabase/functions/discovery-run/index.ts` runs one Google
query through the first backend that has a key + budget, in this order:

1. **Serper.dev** — Google SERP API. Best signal, cheapest per successful
   call. Add the key in Settings → Discovery APIs (`serper_api_key`).
2. **Firecrawl `/v1/search`** — server-side Google scrape with anti-bot
   handling. Works from datacenter IPs. Add `firecrawl_api_key`.
3. DuckDuckGo HTML → raw Google HTML (last resort, usually blocked from
   Cloudflare/Supabase egress IPs — kept only because it costs nothing).

If neither Serper nor Firecrawl is configured the DM hunt will run but
almost never find anyone. Configure at least one.

## 2. Query set used for decision-maker hunt

`serperFreeDmHunt()` runs up to 10 queries per business, stopping at the
first strict match. All queries include the company name and the location:

```
site:linkedin.com/in "<company>" (CEO OR Owner OR Founder OR President) <loc>
"<company>" (owner OR founder OR CEO OR president) <loc>
"<company>" (about OR team OR leadership) (owner OR founder OR CEO) <loc>
"<company>" "Secretary of State" <state>
"<company>" site:opencorporates.com <state>
"<company>" site:bizapedia.com <state>
site:facebook.com "<company>" (owner OR founder) <loc>
"<company>" "owner" "response" <loc>
<company> <loc> owner founder CEO president
```

Each result is passed through `strictIdentityMatch()`:

- Title/snippet/URL must contain **both** the candidate's first and last name.
- AND at least one of: company-name token, or the location city.
- Candidate name shape must be `Firstname Lastname` (2–5 title-cased words).
- Role regex must match `CEO|Owner|Founder|President|Principal|Managing
  Partner|Chief|Director`.

Anything short of that is dropped, which is why the extractor doesn't
attach random Facebook profiles that share a common name.

## 3. From SERP result to AI

Once a matching result is found:

1. The business row gets `contact_name`, `contact_title`,
   `linkedin_url` (if the source URL is LinkedIn).
2. Skip-trace (`STEP 4`) uses Serper + Firecrawl again to search the
   open web for the person + company, scrapes the top result pages, and
   pulls phones/emails out with `GLOBAL_PHONE_RX` / email regex.
3. The verified contact is inserted into `contacts` and `pipeline_leads`
   as a **New Lead** (auto-added).
4. If no DM was found after all 10 queries, the business is stored as
   **B2B-only** (company info + email/phone only, 0.5 credit cost). The
   contact row keeps `dm_search_attempts` so it can be retried later.

## 4. Tuning / debugging

- **No DMs at all**: check Settings → Discovery APIs — both `serper_api_key`
  and `firecrawl_api_key` are empty.
- **DMs found but wrong person**: `strictIdentityMatch` is too permissive
  when only the city hit fires; tighten by requiring company-token match
  (drop the `|| cityHit` in `strictIdentityMatch`).
- **Empty Google/DDG fallback**: expected — Google and DuckDuckGo serve
  challenge pages to Supabase Edge Function egress IPs. Add a Serper or
  Firecrawl key.
- **Rate limits**: Serper and Firecrawl each get their own cost-ledger
  entry per call (`serper_search`, `firecrawl_search`). Runs stop paid
  calls once the team's daily spend ceiling is hit.
