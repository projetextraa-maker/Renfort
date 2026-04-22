alter table public.contracts
  add column if not exists patron_signed_by_user_id uuid,
  add column if not exists patron_sign_role text,
  add column if not exists worker_signed_by_user_id uuid,
  add column if not exists worker_sign_role text;

comment on column public.contracts.patron_signed_by_user_id is
  'Utilisateur authentifie ayant signe le contrat cote patron.';

comment on column public.contracts.patron_sign_role is
  'Role applicatif enregistre lors de la signature cote patron.';

comment on column public.contracts.worker_signed_by_user_id is
  'Utilisateur authentifie ayant signe le contrat cote serveur.';

comment on column public.contracts.worker_sign_role is
  'Role applicatif enregistre lors de la signature cote serveur.';
