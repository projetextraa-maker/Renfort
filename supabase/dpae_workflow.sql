alter table public.annonces
  add column if not exists dpae_done boolean not null default false,
  add column if not exists dpae_status text not null default 'not_started',
  add column if not exists dpae_done_at timestamptz,
  add column if not exists dpae_done_by uuid,
  add column if not exists dpae_payload_snapshot jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'annonces_dpae_status_check'
  ) then
    alter table public.annonces
      add constraint annonces_dpae_status_check
      check (dpae_status in ('not_started', 'prepared', 'confirmed'));
  end if;
end $$;

comment on column public.annonces.dpae_done is
  'Indique si la declaration URSSAF / DPAE a ete finalisee avant le debut reel de mission.';

comment on column public.annonces.dpae_status is
  'Etat de preparation de la declaration URSSAF / DPAE: not_started, prepared, confirmed.';

comment on column public.annonces.dpae_done_at is
  'Horodatage de confirmation de la declaration URSSAF / DPAE.';

comment on column public.annonces.dpae_done_by is
  'Utilisateur ayant confirme dans l application que la declaration URSSAF / DPAE a bien ete effectuee.';

comment on column public.annonces.dpae_payload_snapshot is
  'Snapshot pre-rempli des donnees DPAE visibles dans l application.';

update public.annonces
set dpae_status = case when dpae_done = true then 'confirmed' else 'not_started' end
where dpae_status is null
   or dpae_status not in ('not_started', 'prepared', 'confirmed');

select
  count(*) as annonces_dpae_non_faite
from public.annonces
where dpae_done = false;
