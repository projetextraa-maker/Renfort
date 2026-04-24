alter table public.annonces
  add column if not exists payment_intent_id text;

create index if not exists annonces_payment_intent_id_idx
  on public.annonces (payment_intent_id);
