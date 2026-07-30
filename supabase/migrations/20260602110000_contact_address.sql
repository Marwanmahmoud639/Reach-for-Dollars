-- Full street address for precise Areas-map pinning.
alter table public.contacts add column if not exists address text;
comment on column public.contacts.address is
  'Full street address captured at discovery; used for precise map geocoding.';
