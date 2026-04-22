create or replace function public.renfort_build_referral_code(first_name text, user_id uuid)
returns text
language sql
immutable
as $$
  select
    coalesce(
      nullif(upper(left(regexp_replace(coalesce(first_name, ''), '[^A-Za-z0-9]', '', 'g'), 6)), ''),
      'RENFORT'
    )
    || right(regexp_replace(user_id::text, '[^A-Za-z0-9]', '', 'g'), 4);
$$;

create or replace function public.handle_renfort_auth_signup()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  account_role text := lower(coalesce(meta->>'account_role', ''));
  referral_parent text := nullif(meta->>'referred_by', '');
begin
  if account_role = 'patron' then
    insert into public.patrons (
      id,
      nom_restaurant,
      prenom,
      email,
      telephone,
      code_postal,
      ville,
      lat,
      lng
    )
    values (
      new.id,
      nullif(meta->>'nom_restaurant', ''),
      nullif(meta->>'prenom', ''),
      new.email,
      nullif(meta->>'telephone', ''),
      nullif(meta->>'code_postal', ''),
      nullif(meta->>'ville', ''),
      nullif(meta->>'lat', '')::double precision,
      nullif(meta->>'lng', '')::double precision
    )
    on conflict (id) do update
    set
      nom_restaurant = excluded.nom_restaurant,
      prenom = excluded.prenom,
      email = excluded.email,
      telephone = excluded.telephone,
      code_postal = excluded.code_postal,
      ville = excluded.ville,
      lat = excluded.lat,
      lng = excluded.lng;
  elsif account_role = 'serveur' then
    insert into public.serveurs (
      id,
      prenom,
      nom,
      email,
      telephone,
      code_postal,
      ville,
      lat,
      lng,
      rayon,
      referral_code,
      referred_by
    )
    values (
      new.id,
      nullif(meta->>'prenom', ''),
      nullif(meta->>'nom', ''),
      new.email,
      nullif(meta->>'telephone', ''),
      nullif(meta->>'code_postal', ''),
      nullif(meta->>'ville', ''),
      nullif(meta->>'lat', '')::double precision,
      nullif(meta->>'lng', '')::double precision,
      coalesce(nullif(meta->>'rayon', '')::integer, 50),
      public.renfort_build_referral_code(meta->>'prenom', new.id),
      case
        when referral_parent ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then referral_parent::uuid
        else null
      end
    )
    on conflict (id) do update
    set
      prenom = excluded.prenom,
      nom = excluded.nom,
      email = excluded.email,
      telephone = excluded.telephone,
      code_postal = excluded.code_postal,
      ville = excluded.ville,
      lat = excluded.lat,
      lng = excluded.lng,
      rayon = excluded.rayon,
      referral_code = coalesce(public.serveurs.referral_code, excluded.referral_code),
      referred_by = coalesce(public.serveurs.referred_by, excluded.referred_by);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_handle_renfort_auth_signup on auth.users;
create trigger trg_handle_renfort_auth_signup
after insert on auth.users
for each row
execute function public.handle_renfort_auth_signup();
