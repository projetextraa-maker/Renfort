-- Backfill non destructif pour rattacher les anciennes annonces a un etablissement.
-- Objectif :
-- 1. garder visibles les missions legacy
-- 2. restaurer le multi-etablissement sans ecraser de bonnes donnees existantes
-- 3. preparer un cleanup plus tard, seulement apres verification

-- Etape 0 : garde-fous schema
alter table public.annonces
  add column if not exists etablissement_id uuid references public.etablissements(id) on delete set null;

create index if not exists annonces_etablissement_id_idx
  on public.annonces(etablissement_id);

-- Etape 1 : pour chaque patron, identifier l'etablissement "de secours" le plus pertinent.
-- Priorite :
-- - etablissement par defaut
-- - sinon dernier utilise
-- - sinon plus ancien cree
with ranked_etablissements as (
  select
    e.id,
    e.user_id,
    row_number() over (
      partition by e.user_id
      order by
        case when coalesce(e.is_default, false) then 0 else 1 end,
        case when e.last_used_at is null then 1 else 0 end,
        e.last_used_at desc nulls last,
        e.created_at asc nulls last,
        e.id asc
    ) as rn
  from public.etablissements e
  where e.user_id is not null
),
fallback_etablissements as (
  select id, user_id
  from ranked_etablissements
  where rn = 1
)
update public.annonces a
set etablissement_id = fe.id
from fallback_etablissements fe
where a.patron_id = fe.user_id
  and a.etablissement_id is null;

-- Etape 2 : recopier la localisation depuis l'etablissement seulement
-- si l'annonce n'a pas deja ces informations.
update public.annonces a
set
  ville = coalesce(nullif(a.ville, ''), e.ville),
  lat = coalesce(a.lat, e.lat),
  lng = coalesce(a.lng, e.lng)
from public.etablissements e
where a.etablissement_id = e.id
  and (
    a.ville is null or a.ville = ''
    or a.lat is null
    or a.lng is null
  );

-- Etape 3 : pour les annonces encore sans etablissement_id,
-- tenter un rattachement plus fin par matching de ville si plusieurs etablissements existent.
-- Cette passe ne touche que les lignes restantes.
with matching_candidates as (
  select
    a.id as annonce_id,
    e.id as etablissement_id,
    row_number() over (
      partition by a.id
      order by
        case when lower(coalesce(a.ville, '')) = lower(coalesce(e.ville, '')) then 0 else 1 end,
        case when coalesce(e.is_default, false) then 0 else 1 end,
        case when e.last_used_at is null then 1 else 0 end,
        e.last_used_at desc nulls last,
        e.created_at asc nulls last,
        e.id asc
    ) as rn
  from public.annonces a
  join public.etablissements e
    on e.user_id = a.patron_id
  where a.etablissement_id is null
),
best_matches as (
  select annonce_id, etablissement_id
  from matching_candidates
  where rn = 1
)
update public.annonces a
set etablissement_id = bm.etablissement_id
from best_matches bm
where a.id = bm.annonce_id
  and a.etablissement_id is null;

-- Etape 4 : verification
-- 4a. Annonces encore sans etablissement rattache
select
  count(*) as annonces_sans_etablissement_id
from public.annonces
where etablissement_id is null;

-- 4b. Details des lignes restantes a traiter manuellement si besoin
select
  id,
  patron_id,
  poste,
  date,
  ville,
  lat,
  lng,
  created_at
from public.annonces
where etablissement_id is null
order by created_at desc nulls last
limit 100;

-- 4c. Controle rapide de coherence
select
  a.id,
  a.patron_id,
  a.etablissement_id,
  e.user_id as etablissement_user_id,
  a.ville as annonce_ville,
  e.ville as etablissement_ville
from public.annonces a
left join public.etablissements e on e.id = a.etablissement_id
where a.etablissement_id is not null
  and e.id is not null
  and a.patron_id is distinct from e.user_id
limit 100;
