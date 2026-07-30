# Full codebase snapshot

Complete source at commit HEAD, tracked files only. No `.git`, no
`node_modules`, no build output.

## What to tell the Lovable agent

> Replace the project source with the contents of this archive, preserving
> every path exactly. Then redeploy the `discovery-run` edge function and apply
> any pending migrations in supabase/migrations.

## Not included, on purpose

`.env` is excluded. It holds live credentials and the Lovable project already
has its own copy, so shipping it inside an archive adds risk without adding
anything. `.env.example` is included and documents every variable the app reads.

## The change that matters

The `discovery-run` edge function in the Lovable project has been running an
older build than the repo. Confirmed by comparing live activity messages against
source: the running function logs

    Found 71 businesses from 7 source(s), 1 failed

which appears nowhere in this codebase. The current source logs

    Found 71 businesses
    71 leads saved — enriching them now

Everything below is therefore in the repo but has never executed in production.

### discovery-run

- Leads are written to `contacts` immediately after business discovery and
  enriched in place. Previously nothing persisted until the final step, so any
  run that was killed part-way left no data at all.
- A run is capped at 150 seconds total; every step clamps to what remains.
  Skip-trace alone previously allowed 240s.
- A provider answering 429, or timing out three times, is skipped for two
  minutes rather than retried for the rest of the run.
- An empty result from a working search provider is treated as an answer, not a
  failure, so the pipeline stops asking a second provider the same question.
- Seamless was calling the wrong path with the wrong auth header and the wrong
  body shape — every call 404'd. Now matches the published API.
- New: directory harvesting from search results instead of paid page scrapes;
  owner-of-record lookup from county property data; a 14-day search cache; a
  multi-pass decision-maker agent.

### Frontend

- Lead rows open the full profile page instead of a drawer, and that route has
  its own error boundary.
- Loading and not-found are distinguished on the lead page — a contact that
  didn't resolve previously showed "Loading…" forever.
- Discovery progress shows a live countdown that switches to counting up once a
  run passes its budget, plus running totals per step.
- Knowledge-base uploads extract real text from PDF and DOCX instead of storing
  raw binary into the call prompt.
- Single-field location picker with real city/state suggestions.
- Vendor names and source badges removed from the discovery UI.

## Verifying the deploy

Run a discovery search. If the live progress shows
**"leads saved — enriching them now"**, the new function is live. If it still
reads "from 7 source(s), 1 failed", it is not.
