alter table public.annonces
  add column if not exists check_out_requested_by text,
  add column if not exists check_out_requested_at timestamptz,
  add column if not exists check_out_confirmed_at timestamptz;
