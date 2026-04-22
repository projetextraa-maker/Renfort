create table if not exists public.mission_rate_negotiations (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.annonces(id) on delete cascade,
  serveur_id uuid not null references public.serveurs(id) on delete cascade,
  patron_id uuid not null references public.patrons(id) on delete cascade,
  engagement_id uuid null references public.engagements(id) on delete set null,
  original_rate numeric(10,2) not null,
  counter_rate numeric(10,2) not null,
  max_allowed_rate numeric(10,2) not null,
  eligibility_tier text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz null,
  accepted_at timestamptz null,
  rejected_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint mission_rate_negotiations_status_check
    check (status in ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  constraint mission_rate_negotiations_tier_check
    check (eligibility_tier in ('none', 'plus_1', 'plus_2', 'plus_3_or_20pct')),
  constraint mission_rate_negotiations_counter_rate_check
    check (counter_rate >= original_rate),
  constraint mission_rate_negotiations_max_allowed_rate_check
    check (max_allowed_rate >= original_rate),
  constraint mission_rate_negotiations_counter_vs_max_check
    check (counter_rate <= max_allowed_rate)
);

create unique index if not exists mission_rate_negotiations_one_offer_per_server_mission_idx
  on public.mission_rate_negotiations(mission_id, serveur_id);

create index if not exists mission_rate_negotiations_patron_status_idx
  on public.mission_rate_negotiations(patron_id, status, created_at desc);

create index if not exists mission_rate_negotiations_serveur_status_idx
  on public.mission_rate_negotiations(serveur_id, status, created_at desc);

alter table public.engagements
  add column if not exists agreed_hourly_rate numeric(10,2) null;

create or replace function public.set_mission_rate_negotiations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_mission_rate_negotiations_updated_at on public.mission_rate_negotiations;
create trigger trg_set_mission_rate_negotiations_updated_at
before update on public.mission_rate_negotiations
for each row
execute function public.set_mission_rate_negotiations_updated_at();
