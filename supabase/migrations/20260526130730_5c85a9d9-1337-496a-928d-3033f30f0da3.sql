
-- Individual searches table
create table public.individual_searches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  keyword text not null,
  location text,
  platforms text[] not null default '{}',
  status text not null default 'pending',
  individuals_found int not null default 0,
  verified_count int not null default 0,
  avg_score float,
  auto_added_to_pipeline int,
  error_text text,
  sources_success jsonb default '{}'::jsonb,
  sources_failed jsonb default '{}'::jsonb,
  map_center_lat float,
  map_center_lng float,
  locations_geocoded jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_seconds int
);
create index on public.individual_searches(team_id);
create index on public.individual_searches(status);

alter table public.individual_searches enable row level security;

create policy "team views individual_searches" on public.individual_searches
  for select using (team_id = get_user_team(auth.uid()));
create policy "non-agents manage individual_searches" on public.individual_searches
  for all using ((team_id = get_user_team(auth.uid())) and (has_team_role(auth.uid(), team_id, 'admin'::app_role) or has_team_role(auth.uid(), team_id, 'manager'::app_role)))
  with check ((team_id = get_user_team(auth.uid())) and (has_team_role(auth.uid(), team_id, 'admin'::app_role) or has_team_role(auth.uid(), team_id, 'manager'::app_role)));
create policy "super admin full access individual_searches" on public.individual_searches
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

-- Individual search results
create table public.individual_search_results (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  search_id uuid not null references public.individual_searches(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  first_name text,
  last_name text,
  full_name text not null,
  role text,
  company_name text,
  city text,
  state text,
  country text,
  email text,
  phone text,
  linkedin_url text,
  facebook_url text,
  reddit_username text,
  twitter_handle text,
  instagram_handle text,
  sources text[] not null default '{}',
  confidence_score int,
  is_new_contact bool default false,
  auto_added_to_pipeline bool default false,
  raw_data jsonb,
  created_at timestamptz not null default now()
);
create index on public.individual_search_results(team_id);
create index on public.individual_search_results(search_id);

alter table public.individual_search_results enable row level security;

create policy "team views individual_search_results" on public.individual_search_results
  for select using (team_id = get_user_team(auth.uid()));
create policy "team manages individual_search_results" on public.individual_search_results
  for all using (team_id = get_user_team(auth.uid())) with check (team_id = get_user_team(auth.uid()));
create policy "super admin full access individual_search_results" on public.individual_search_results
  for all using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

-- searches: add map fields
alter table public.searches add column if not exists locations_geocoded jsonb default '[]'::jsonb;
alter table public.searches add column if not exists map_center_lat float;
alter table public.searches add column if not exists map_center_lng float;

-- team_settings: add platform creds
alter table public.team_settings add column if not exists facebook_api_key text;
alter table public.team_settings add column if not exists serper_api_key text;
alter table public.team_settings add column if not exists reddit_client_id text;
alter table public.team_settings add column if not exists default_subreddits text[] not null default '{Wholesaling,RealEstate,investing,realestateinvesting,cashbuyers}';

-- realtime
alter publication supabase_realtime add table public.individual_searches;
alter publication supabase_realtime add table public.individual_search_results;
