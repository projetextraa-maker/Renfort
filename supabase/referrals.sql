alter table public.serveurs
  add column if not exists referral_code text,
  add column if not exists referred_by uuid references public.serveurs(id);

create unique index if not exists serveurs_referral_code_key
  on public.serveurs(referral_code);

create index if not exists serveurs_referred_by_idx
  on public.serveurs(referred_by);

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references public.serveurs(id) on delete cascade,
  referred_user_id uuid not null references public.serveurs(id) on delete cascade,
  milestone integer not null check (milestone in (1, 3, 5)),
  reward_amount numeric(10,2) not null,
  rewarded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists referral_rewards_unique_milestone
  on public.referral_rewards(referrer_user_id, referred_user_id, milestone);

create index if not exists referral_rewards_referrer_idx
  on public.referral_rewards(referrer_user_id);
