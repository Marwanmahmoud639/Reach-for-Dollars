-- Mailbox-level email verification key (MillionVerifier).
--
-- The verify step's MX check only proves a domain accepts mail, so
-- pattern-generated addresses (first.last@domain and friends) still bounce.
-- With this key set, those guesses are checked against the real mailbox and
-- undeliverable ones are dropped before they can reach a sending campaign.

alter table public.team_settings
  add column if not exists millionverifier_api_key text;

comment on column public.team_settings.millionverifier_api_key is
  'MillionVerifier API key. When null, pattern-generated emails ship MX-verified only and may bounce.';
