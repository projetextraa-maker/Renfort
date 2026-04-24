alter table public.dpae_records enable row level security;

drop policy if exists "dpae_records_select_involved" on public.dpae_records;
create policy "dpae_records_select_involved"
on public.dpae_records
for select
to authenticated
using (
  exists (
    select 1
    from public.annonces a
    where a.id = dpae_records.mission_id
      and (a.patron_id = auth.uid() or a.serveur_id = auth.uid())
  )
);

drop policy if exists "dpae_records_insert_patron" on public.dpae_records;
create policy "dpae_records_insert_patron"
on public.dpae_records
for insert
to authenticated
with check (
  exists (
    select 1
    from public.annonces a
    where a.id = dpae_records.mission_id
      and a.patron_id = auth.uid()
  )
);

drop policy if exists "dpae_records_update_patron" on public.dpae_records;
create policy "dpae_records_update_patron"
on public.dpae_records
for update
to authenticated
using (
  exists (
    select 1
    from public.annonces a
    where a.id = dpae_records.mission_id
      and a.patron_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.annonces a
    where a.id = dpae_records.mission_id
      and a.patron_id = auth.uid()
  )
);
