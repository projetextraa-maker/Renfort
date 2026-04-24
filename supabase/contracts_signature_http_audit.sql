alter table public.contracts
  add column if not exists patron_signature_ip text,
  add column if not exists patron_signature_user_agent text,
  add column if not exists worker_signature_ip text,
  add column if not exists worker_signature_user_agent text;

comment on column public.contracts.patron_signature_ip is
  'Adresse IP observee lors de la signature cote patron.';

comment on column public.contracts.patron_signature_user_agent is
  'User-Agent observe lors de la signature cote patron.';

comment on column public.contracts.worker_signature_ip is
  'Adresse IP observee lors de la signature cote serveur.';

comment on column public.contracts.worker_signature_user_agent is
  'User-Agent observe lors de la signature cote serveur.';
