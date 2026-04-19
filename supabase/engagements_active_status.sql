drop index if exists public.engagements_one_active_per_mission;

create unique index if not exists engagements_one_active_per_mission
  on public.engagements(mission_id)
  where status in ('draft', 'pending_signature', 'confirmed', 'active');

alter table public.engagements
  drop constraint if exists engagements_status_check;

alter table public.engagements
  add constraint engagements_status_check
  check (status in ('draft', 'pending_signature', 'confirmed', 'active', 'completed', 'cancelled'));
