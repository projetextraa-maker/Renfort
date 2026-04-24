alter table public.annonces
  drop constraint if exists annonces_payment_status_check;

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
