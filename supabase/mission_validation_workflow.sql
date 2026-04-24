alter table public.annonces
  add column if not exists presence_confirmation_status text not null default 'not_requested',
  add column if not exists presence_confirmation_sent_at timestamptz,
  add column if not exists presence_confirmation_due_at timestamptz,
  add column if not exists presence_confirmation_responded_at timestamptz,
  add column if not exists contract_status text not null default 'not_generated',
  add column if not exists contract_generated_at timestamptz,
  add column if not exists contract_signed_by_patron_at timestamptz,
  add column if not exists contract_signed_by_server_at timestamptz,
  add column if not exists payment_status text not null default 'not_authorized',
  add column if not exists payment_authorized_at timestamptz,
  add column if not exists payment_released_at timestamptz,
  add column if not exists payment_blocked_at timestamptz,
  add column if not exists check_in_status text not null default 'not_checked_in',
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_out_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists dispute_reason text,
  add column if not exists dispute_created_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'annonces_presence_confirmation_status_check'
  ) then
    alter table public.annonces
      add constraint annonces_presence_confirmation_status_check
      check (
        presence_confirmation_status in (
          'not_requested',
          'pending',
          'confirmed',
          'declined',
          'no_response'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'annonces_contract_status_check'
  ) then
    alter table public.annonces
      add constraint annonces_contract_status_check
      check (
        contract_status in (
          'not_generated',
          'generated',
          'signed_by_patron',
          'signed_by_server',
          'fully_signed'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'annonces_payment_status_check'
  ) then
    alter table public.annonces
      add constraint annonces_payment_status_check
      check (
        payment_status in (
          'not_authorized',
          'authorized_hold',
          'captured',
          'capture_failed',
          'released',
          'blocked',
          'refunded'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'annonces_check_in_status_check'
  ) then
    alter table public.annonces
      add constraint annonces_check_in_status_check
      check (
        check_in_status in (
          'not_checked_in',
          'checked_in',
          'checked_out'
        )
      );
  end if;
end $$;
