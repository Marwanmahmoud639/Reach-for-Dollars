-- Owner-of-record lookup via county property records.
--
-- Search engines are the wrong layer for wholesaling leads. A SERP query has to
-- infer an owner from whatever a page happens to say, is rate limited, and
-- fails silently. County assessor and recorder offices publish owner of record
-- and mailing address as a matter of public law, so for "who owns this
-- property" the answer is a record lookup, not a guess.
--
-- Two settings, both optional. Without them the step reports itself
-- unconfigured and the pipeline behaves exactly as it does today.

alter table public.team_settings
  -- Apify actor that returns unified county assessor / recorder data. Kept
  -- separate from apify_actor_id, which points at the business-discovery actor
  -- and returns a completely different shape.
  add column if not exists apify_property_actor_id text,

  -- Pay-per-hit skip trace over the owner names the property step resolves.
  add column if not exists tracerfy_api_key text;

comment on column public.team_settings.apify_property_actor_id is
  'Apify actor id for county property records (owner of record + mailing address). Separate from apify_actor_id, which is the business-discovery actor.';

comment on column public.team_settings.tracerfy_api_key is
  'Tracerfy key for pay-per-hit skip tracing of resolved owner names.';
