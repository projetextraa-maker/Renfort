create table if not exists public.etablissements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.patrons(id) on delete cascade,
  nom text not null,
  adresse text,
  ville text not null,
  lat double precision,
  lng double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.etablissements
  add column if not exists user_id uuid references public.patrons(id) on delete cascade,
  add column if not exists nom text,
  add column if not exists adresse text,
  add column if not exists ville text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists is_default boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_used_at timestamptz;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'etablissements'
      and column_name = 'patron_id'
  ) then
    execute '
      update public.etablissements
      set user_id = coalesce(user_id, patron_id)
      where user_id is null
    ';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'etablissements'
      and column_name = 'name'
  ) then
    execute '
      update public.etablissements
      set nom = coalesce(nullif(nom, ''''''), name)
      where nom is null or nom = ''''
    ';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'etablissements'
      and column_name = 'address'
  ) then
    execute '
      update public.etablissements
      set adresse = coalesce(adresse, address)
      where adresse is null
    ';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'etablissements'
      and column_name = 'city'
  ) then
    execute '
      update public.etablissements
      set ville = coalesce(nullif(ville, ''''''), city)
      where ville is null or ville = ''''
    ';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'etablissements'
      and column_name = 'is_primary'
  ) then
    execute '
      update public.etablissements
      set is_default = coalesce(is_default, is_primary, false)
      where is_default is distinct from coalesce(is_primary, false)
    ';
  end if;
end $$;

update public.etablissements
set
  nom = coalesce(nullif(nom, ''), 'Mon etablissement'),
  ville = coalesce(nullif(ville, ''), 'Ville a renseigner'),
  is_default = coalesce(is_default, false),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.etablissements
  alter column user_id set not null,
  alter column nom set not null,
  alter column ville set not null,
  alter column is_default set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

create index if not exists etablissements_user_id_idx
  on public.etablissements(user_id);

create unique index if not exists etablissements_one_default_per_user
  on public.etablissements(user_id)
  where is_default = true;

alter table public.annonces
  add column if not exists etablissement_id uuid references public.etablissements(id) on delete set null;

create index if not exists annonces_etablissement_id_idx
  on public.annonces(etablissement_id);

insert into public.etablissements (
  user_id,
  nom,
  adresse,
  ville,
  lat,
  lng,
  is_default,
  last_used_at
)
select
  p.id,
  coalesce(nullif(p.nom_restaurant, ''), 'Mon etablissement'),
  null,
  coalesce(nullif(p.ville, ''), 'Ville a renseigner'),
  p.lat,
  p.lng,
  true,
  now()
from public.patrons p
where not exists (
  select 1
  from public.etablissements e
  where e.user_id = p.id
);

create or replace function public.set_etablissements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_etablissements_updated_at on public.etablissements;
create trigger trg_set_etablissements_updated_at
before update on public.etablissements
for each row
execute function public.set_etablissements_updated_at();

alter table public.etablissements enable row level security;

drop policy if exists "etablissements_select_own" on public.etablissements;
create policy "etablissements_select_own"
on public.etablissements
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "etablissements_insert_own" on public.etablissements;
create policy "etablissements_insert_own"
on public.etablissements
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "etablissements_update_own" on public.etablissements;
create policy "etablissements_update_own"
on public.etablissements
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "etablissements_delete_own" on public.etablissements;
create policy "etablissements_delete_own"
on public.etablissements
for delete
to authenticated
using (auth.uid() = user_id);

-- Compatibility note:
-- keep legacy columns (patron_id / name / address / city / is_primary)
-- during the transition so old rows remain readable until every environment
-- has been backfilled and verified. Drop them only in a dedicated cleanup step.
