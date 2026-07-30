-- OAuth connections to LinkedIn / Facebook / Instagram.
--
-- SCOPE NOTE — read before extending this:
-- These connections CANNOT be used to search for or scrape other people's
-- profiles. No consumer OAuth scope on any of these platforms grants that:
--   * LinkedIn issues openid / profile / email / w_member_social. People search
--     lives in Sales Navigator + Talent Solutions, which require a signed
--     partnership agreement, not OAuth.
--   * Meta removed third-party profile access in 2018; user_friends returns
--     only friends who also use the app. Public business Pages are readable
--     via the Pages API but require App Review (Page Public Content Access).
--   * Instagram Basic Display was retired in Dec 2024; the Graph API covers
--     only Business/Creator accounts the user owns.
-- Legitimate uses are therefore: posting/messaging AS the connected user, and
-- reading business Pages the user manages or that App Review has granted.

create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  platform text not null check (platform in ('linkedin', 'facebook', 'instagram')),
  -- AES-256-GCM via connectionKeyCrypto.server.ts. Never store raw tokens.
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  -- Exactly what the user consented to, so we can tell at a glance whether a
  -- connection can do a thing without re-deriving it from platform docs.
  scopes text[] not null default '{}',
  expires_at timestamptz,
  -- Platform's own account id + display name, for showing "Connected as X".
  external_id text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform)
);

create index if not exists social_connections_team_idx
  on public.social_connections (team_id);

alter table public.social_connections enable row level security;

-- Tokens are written server-side only (service role). Clients may see that a
-- connection exists and delete it, but never read token material: the
-- ciphertext columns are excluded from the client-facing view below.
drop policy if exists "users view own social connections" on public.social_connections;
create policy "users view own social connections"
  on public.social_connections for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users delete own social connections" on public.social_connections;
create policy "users delete own social connections"
  on public.social_connections for delete to authenticated
  using (auth.uid() = user_id);

grant select, delete on public.social_connections to authenticated;
grant all on public.social_connections to service_role;

-- Short-lived CSRF state for the OAuth round trip. Rows are consumed on
-- callback and swept after 15 minutes.
create table if not exists public.social_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  redirect_to text,
  created_at timestamptz not null default now()
);

alter table public.social_oauth_states enable row level security;
grant all on public.social_oauth_states to service_role;
-- No policies for `authenticated` on purpose: state rows are service-role only.
