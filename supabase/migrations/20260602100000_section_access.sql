-- Per-user section access control (checkbox-based, overrides role defaults).
alter table public.user_roles
  add column if not exists section_access jsonb default null;
comment on column public.user_roles.section_access is
  'Array of nav section keys this user may access. NULL = role defaults. Admins always see everything.';

-- Unlimited team members.
update public.teams set seat_limit = 100000 where seat_limit is null or seat_limit < 100000;
alter table public.teams alter column seat_limit set default 100000;
