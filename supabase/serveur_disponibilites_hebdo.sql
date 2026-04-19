create table if not exists public.serveur_disponibilites_hebdo (
  id uuid primary key default gen_random_uuid(),
  serveur_id uuid not null references public.serveurs(id) on delete cascade,
  jour text not null check (jour in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  creneau text not null check (creneau in ('morning', 'midday', 'afternoon', 'evening', 'night')),
  created_at timestamptz not null default now()
);

create unique index if not exists serveur_disponibilites_hebdo_unique_slot
  on public.serveur_disponibilites_hebdo(serveur_id, jour, creneau);

create index if not exists serveur_disponibilites_hebdo_serveur_idx
  on public.serveur_disponibilites_hebdo(serveur_id);

alter table public.serveur_disponibilites_hebdo enable row level security;

drop policy if exists "serveur_disponibilites_select_all_authenticated" on public.serveur_disponibilites_hebdo;
create policy "serveur_disponibilites_select_all_authenticated"
on public.serveur_disponibilites_hebdo
for select
to authenticated
using (true);

drop policy if exists "serveur_disponibilites_insert_own" on public.serveur_disponibilites_hebdo;
create policy "serveur_disponibilites_insert_own"
on public.serveur_disponibilites_hebdo
for insert
to authenticated
with check (auth.uid() = serveur_id);

drop policy if exists "serveur_disponibilites_update_own" on public.serveur_disponibilites_hebdo;
create policy "serveur_disponibilites_update_own"
on public.serveur_disponibilites_hebdo
for update
to authenticated
using (auth.uid() = serveur_id)
with check (auth.uid() = serveur_id);

drop policy if exists "serveur_disponibilites_delete_own" on public.serveur_disponibilites_hebdo;
create policy "serveur_disponibilites_delete_own"
on public.serveur_disponibilites_hebdo
for delete
to authenticated
using (auth.uid() = serveur_id);
