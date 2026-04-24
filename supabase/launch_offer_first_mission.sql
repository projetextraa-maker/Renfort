alter table public.patrons
  add column if not exists launch_offer_used_at timestamptz;

alter table public.annonces
  add column if not exists launch_offer_applied boolean not null default false;
