alter table public.patron_billing_profiles
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id text,
  add column if not exists stripe_status text,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists current_period_end timestamptz;

alter table public.patrons
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists current_period_end timestamptz;
