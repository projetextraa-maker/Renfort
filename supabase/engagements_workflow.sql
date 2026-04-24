create table if not exists public.engagements (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.annonces(id) on delete cascade,
  patron_id uuid not null references public.patrons(id) on delete cascade,
  serveur_id uuid not null references public.serveurs(id) on delete cascade,
  status text not null default 'draft',
  contract_status text not null default 'not_generated',
  replaced_engagement_id uuid references public.engagements(id) on delete set null,
  selected_at timestamptz not null default now(),
  confirmed_at timestamptz,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.engagements
  add column if not exists agreed_hourly_rate numeric(10,2) null;

alter table public.demandes
  add column if not exists replacement_for_engagement_id uuid references public.engagements(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'engagements_status_check'
  ) then
    alter table public.engagements
      add constraint engagements_status_check
      check (status in ('draft', 'pending_signature', 'confirmed', 'completed', 'cancelled'));
  end if;
end $$;

create index if not exists engagements_mission_id_idx on public.engagements(mission_id);
create index if not exists engagements_serveur_id_idx on public.engagements(serveur_id);
create index if not exists demandes_replacement_for_engagement_id_idx on public.demandes(replacement_for_engagement_id);

create unique index if not exists engagements_one_active_per_mission
  on public.engagements(mission_id)
  where status in ('draft', 'pending_signature', 'confirmed');

create or replace function public.set_engagements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_engagements_updated_at on public.engagements;
create trigger trg_set_engagements_updated_at
before update on public.engagements
for each row
execute function public.set_engagements_updated_at();

alter table public.engagements enable row level security;

drop policy if exists "engagements_select_own" on public.engagements;
create policy "engagements_select_own"
on public.engagements
for select
to authenticated
using (auth.uid() = patron_id or auth.uid() = serveur_id);

drop policy if exists "engagements_insert_own" on public.engagements;
create policy "engagements_insert_own"
on public.engagements
for insert
to authenticated
with check (auth.uid() = patron_id or auth.uid() = serveur_id);

drop policy if exists "engagements_update_own" on public.engagements;
create policy "engagements_update_own"
on public.engagements
for update
to authenticated
using (auth.uid() = patron_id or auth.uid() = serveur_id)
with check (auth.uid() = patron_id or auth.uid() = serveur_id);
