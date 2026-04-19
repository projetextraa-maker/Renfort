alter table public.annonces
  add column if not exists dpae_done boolean not null default false;

comment on column public.annonces.dpae_done is
  'Indique si la declaration URSSAF / DPAE a ete finalisee avant le debut reel de mission.';

select
  count(*) as annonces_dpae_non_faite
from public.annonces
where dpae_done = false;
