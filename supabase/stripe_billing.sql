create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.billing_plans (
  code text primary key check (code in ('free', 'pro', 'pro_plus')),
  name text not null,
  monthly_price_cents integer not null default 0 check (monthly_price_cents >= 0),
  billing_interval text not null default 'month' check (billing_interval in ('month')),
  is_public boolean not null default true,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.billing_plans (
  code,
  name,
  monthly_price_cents,
  billing_interval,
  is_public,
  is_default,
  sort_order
)
values
  ('free', 'Sans abonnement', 0, 'month', true, true, 0),
  ('pro', 'Pro', 5900, 'month', true, false, 1),
  ('pro_plus', 'Pro+', 11900, 'month', true, false, 2)
on conflict (code) do update
set
  name = excluded.name,
  monthly_price_cents = excluded.monthly_price_cents,
  billing_interval = excluded.billing_interval,
  is_public = excluded.is_public,
  is_default = excluded.is_default,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists public.patron_subscriptions (
  id uuid primary key default gen_random_uuid(),
  patron_id uuid not null references public.patrons(id) on delete cascade,
  plan_code text not null references public.billing_plans(code),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status text not null default 'inactive'
    check (status in (
      'inactive',
      'incomplete',
      'incomplete_expired',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid'
    )),
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patron_id)
);

create index if not exists patron_subscriptions_plan_status_idx
  on public.patron_subscriptions (plan_code, status);

drop trigger if exists trg_billing_plans_updated_at on public.billing_plans;
create trigger trg_billing_plans_updated_at
before update on public.billing_plans
for each row execute function public.touch_updated_at();

drop trigger if exists trg_patron_subscriptions_updated_at on public.patron_subscriptions;
create trigger trg_patron_subscriptions_updated_at
before update on public.patron_subscriptions
for each row execute function public.touch_updated_at();

alter table public.billing_plans enable row level security;
alter table public.patron_subscriptions enable row level security;

drop policy if exists billing_plans_select_public on public.billing_plans;
create policy billing_plans_select_public
on public.billing_plans
for select
to authenticated
using (is_public = true);

drop policy if exists patron_subscriptions_select_own on public.patron_subscriptions;
create policy patron_subscriptions_select_own
on public.patron_subscriptions
for select
to authenticated
using (patron_id = auth.uid());

-- Intentionally deferred to later steps:
-- 1. stripe_webhook_events
-- 2. checkout / portal wiring
-- 3. mission commission and billing records
