create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  mission_id uuid not null references public.annonces(id) on delete cascade,
  patron_id uuid not null references public.patrons(id) on delete cascade,
  serveur_id uuid not null references public.serveurs(id) on delete cascade,
  etablissement_id uuid null references public.etablissements(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'pending_patron_signature', 'pending_worker_signature', 'signed', 'cancelled')),
  contract_type text not null default 'extra_mission',
  generated_at timestamptz null,
  patron_signed_at timestamptz null,
  worker_signed_at timestamptz null,
  cancelled_at timestamptz null,
  template_version text null default 'v1',
  payload_snapshot jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contracts_engagement_id_idx
  on public.contracts(engagement_id);

create index if not exists contracts_mission_id_idx
  on public.contracts(mission_id);

create unique index if not exists contracts_one_active_per_engagement_idx
  on public.contracts(engagement_id)
  where status in ('draft', 'pending_patron_signature', 'pending_worker_signature', 'signed');

create or replace function public.set_contracts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_contracts_updated_at on public.contracts;
create trigger trg_set_contracts_updated_at
before update on public.contracts
for each row
execute function public.set_contracts_updated_at();

alter table public.contracts enable row level security;

drop policy if exists "contracts_select_involved" on public.contracts;
create policy "contracts_select_involved"
on public.contracts
for select
to authenticated
using (auth.uid() = patron_id or auth.uid() = serveur_id);

drop policy if exists "contracts_insert_involved" on public.contracts;
create policy "contracts_insert_involved"
on public.contracts
for insert
to authenticated
with check (auth.uid() = patron_id or auth.uid() = serveur_id);

drop policy if exists "contracts_update_involved" on public.contracts;
create policy "contracts_update_involved"
on public.contracts
for update
to authenticated
using (auth.uid() = patron_id or auth.uid() = serveur_id)
with check (auth.uid() = patron_id or auth.uid() = serveur_id);
