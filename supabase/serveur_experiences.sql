create table if not exists public.serveur_experiences (
  id uuid primary key default gen_random_uuid(),
  serveur_id uuid not null references public.serveurs(id) on delete cascade,
  poste text not null,
  duree text not null,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists serveur_experiences_serveur_id_idx
  on public.serveur_experiences(serveur_id, created_at desc);

alter table public.serveur_experiences enable row level security;

drop policy if exists "serveur_experiences_select_own_or_authenticated" on public.serveur_experiences;
create policy "serveur_experiences_select_own_or_authenticated"
on public.serveur_experiences
for select
to authenticated
using (true);

drop policy if exists "serveur_experiences_insert_own" on public.serveur_experiences;
create policy "serveur_experiences_insert_own"
on public.serveur_experiences
for insert
to authenticated
with check (auth.uid() = serveur_id);

drop policy if exists "serveur_experiences_update_own" on public.serveur_experiences;
create policy "serveur_experiences_update_own"
on public.serveur_experiences
for update
to authenticated
using (auth.uid() = serveur_id)
with check (auth.uid() = serveur_id);

drop policy if exists "serveur_experiences_delete_own" on public.serveur_experiences;
create policy "serveur_experiences_delete_own"
on public.serveur_experiences
for delete
to authenticated
using (auth.uid() = serveur_id);
