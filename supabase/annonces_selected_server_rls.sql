alter table public.annonces enable row level security;

drop policy if exists "annonces_select_patron_or_assigned_server" on public.annonces;
drop policy if exists "annonces_select_open_or_involved" on public.annonces;
drop policy if exists "annonces_insert_patron_own" on public.annonces;
drop policy if exists "annonces_update_open_or_involved" on public.annonces;

create policy "annonces_select_open_or_involved"
on public.annonces
for select
to authenticated
using (
  statut in ('open', 'ouverte', 'pending', 'draft')
  or auth.uid() = patron_id
  or auth.uid() = serveur_id
);

create policy "annonces_insert_patron_own"
on public.annonces
for insert
to authenticated
with check (
  auth.uid() = patron_id
);

create policy "annonces_update_open_or_involved"
on public.annonces
for update
to authenticated
using (
  statut in ('open', 'ouverte', 'pending', 'draft')
  or auth.uid() = patron_id
  or auth.uid() = serveur_id
)
with check (
  auth.uid() = patron_id
  or auth.uid() = serveur_id
);
