export type AnnonceMissionSlot = 'midday' | 'evening' | 'full'

export type RawAnnonceRecord = {
  id: string
  poste?: string | null
  date?: string | null
  heure_debut?: string | null
  heure_fin?: string | null
  heure_debut_midi?: string | null
  heure_fin_midi?: string | null
  heure_debut_soir?: string | null
  heure_fin_soir?: string | null
  mission_slot?: string | null
  salaire?: number | string | null
  ville?: string | null
  statut?: string | null
  serveur_id?: string | null
  patron_id?: string | null
  etablissement_id?: string | null
  description?: string | null
  lat?: number | null
  lng?: number | null
  note?: number | null
  presence_confirmation_status?: string | null
  contract_status?: string | null
  payment_status?: string | null
  check_in_status?: string | null
  dpae_done?: boolean | null
  dpae_status?: string | null
  dpae_done_at?: string | null
  dpae_done_by?: string | null
  dpae_payload_snapshot?: Record<string, unknown> | null
  checked_in_at?: string | null
  checked_out_at?: string | null
  created_at?: string | null
}

export type NormalizedAnnonceRecord = {
  id: string
  poste: string
  date: string
  heure_debut: string
  heure_fin: string
  heure_debut_midi: string | null
  heure_fin_midi: string | null
  heure_debut_soir: string | null
  heure_fin_soir: string | null
  mission_slot: AnnonceMissionSlot
  salaire: number
  ville: string
  statut: string
  serveur_id: string | null
  patron_id: string | null
  etablissement_id: string | null
  description: string | null
  lat: number | null
  lng: number | null
  note: number | null
  presence_confirmation_status: string | null
  contract_status: string | null
  payment_status: string | null
  check_in_status: string | null
  dpae_done: boolean | null
  dpae_status: string | null
  dpae_done_at: string | null
  dpae_done_by: string | null
  dpae_payload_snapshot: Record<string, unknown> | null
  checked_in_at: string | null
  checked_out_at: string | null
  created_at: string | null
}

export const ANNONCE_COMPAT_SELECT = `
  id,
  poste,
  date,
  heure_debut,
  heure_fin,
  heure_debut_midi,
  heure_fin_midi,
  heure_debut_soir,
  heure_fin_soir,
  mission_slot,
  salaire,
  ville,
  statut,
  serveur_id,
  patron_id,
  etablissement_id,
  description,
  lat,
  lng,
  note,
  created_at
`

export const ANNONCE_WORKFLOW_SELECT = `
  presence_confirmation_status,
  contract_status,
  payment_status,
  check_in_status,
  dpae_done,
  dpae_status,
  dpae_done_at,
  dpae_done_by,
  dpae_payload_snapshot,
  checked_in_at,
  checked_out_at
`

export const ANNONCE_COMPAT_WITH_WORKFLOW_SELECT = `
  id,
  poste,
  date,
  heure_debut,
  heure_fin,
  heure_debut_midi,
  heure_fin_midi,
  heure_debut_soir,
  heure_fin_soir,
  mission_slot,
  salaire,
  ville,
  statut,
  serveur_id,
  patron_id,
  etablissement_id,
  description,
  lat,
  lng,
  note,
  created_at,
  presence_confirmation_status,
  contract_status,
  payment_status,
  check_in_status,
  dpae_done,
  dpae_status,
  dpae_done_at,
  dpae_done_by,
  dpae_payload_snapshot,
  checked_in_at,
  checked_out_at
`

function normalizeMissionSlot(raw: RawAnnonceRecord): AnnonceMissionSlot {
  const slot = String(raw.mission_slot ?? '').toLowerCase()
  if (slot === 'midday' || slot === 'evening' || slot === 'full') return slot

  const hasMidi = Boolean(raw.heure_debut_midi || raw.heure_fin_midi)
  const hasSoir = Boolean(raw.heure_debut_soir || raw.heure_fin_soir)
  if (hasMidi && hasSoir) return 'full'
  if (hasMidi) return 'midday'
  return 'evening'
}

function normalizeHeureDebut(raw: RawAnnonceRecord, slot: AnnonceMissionSlot): string {
  if (raw.heure_debut) return String(raw.heure_debut)
  if (slot === 'midday') return String(raw.heure_debut_midi ?? raw.heure_debut_soir ?? '')
  if (slot === 'evening') return String(raw.heure_debut_soir ?? raw.heure_debut_midi ?? '')
  return String(raw.heure_debut_midi ?? raw.heure_debut_soir ?? '')
}

function normalizeHeureFin(raw: RawAnnonceRecord, slot: AnnonceMissionSlot): string {
  if (raw.heure_fin) return String(raw.heure_fin)
  if (slot === 'midday') return String(raw.heure_fin_midi ?? raw.heure_fin_soir ?? '')
  if (slot === 'evening') return String(raw.heure_fin_soir ?? raw.heure_fin_midi ?? '')
  return String(raw.heure_fin_soir ?? raw.heure_fin_midi ?? '')
}

function normalizeSalaire(raw: RawAnnonceRecord): number {
  const parsed = Number(raw.salaire ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeAnnonceRecord(raw: RawAnnonceRecord): NormalizedAnnonceRecord {
  const missionSlot = normalizeMissionSlot(raw)

  return {
    id: String(raw.id),
    poste: String(raw.poste ?? ''),
    date: String(raw.date ?? ''),
    heure_debut: normalizeHeureDebut(raw, missionSlot),
    heure_fin: normalizeHeureFin(raw, missionSlot),
    heure_debut_midi: raw.heure_debut_midi ? String(raw.heure_debut_midi) : null,
    heure_fin_midi: raw.heure_fin_midi ? String(raw.heure_fin_midi) : null,
    heure_debut_soir: raw.heure_debut_soir ? String(raw.heure_debut_soir) : null,
    heure_fin_soir: raw.heure_fin_soir ? String(raw.heure_fin_soir) : null,
    mission_slot: missionSlot,
    salaire: normalizeSalaire(raw),
    ville: String(raw.ville ?? ''),
    statut: String(raw.statut ?? ''),
    serveur_id: raw.serveur_id ? String(raw.serveur_id) : null,
    patron_id: raw.patron_id ? String(raw.patron_id) : null,
    etablissement_id: raw.etablissement_id ? String(raw.etablissement_id) : null,
    description: raw.description ?? null,
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    note: raw.note ?? null,
    presence_confirmation_status: raw.presence_confirmation_status ?? null,
    contract_status: raw.contract_status ?? null,
    payment_status: raw.payment_status ?? null,
    check_in_status: raw.check_in_status ?? null,
    dpae_done: typeof raw.dpae_done === 'boolean' ? raw.dpae_done : null,
    dpae_status: raw.dpae_status ?? null,
    dpae_done_at: raw.dpae_done_at ?? null,
    dpae_done_by: raw.dpae_done_by ?? null,
    dpae_payload_snapshot:
      raw.dpae_payload_snapshot && typeof raw.dpae_payload_snapshot === 'object'
        ? raw.dpae_payload_snapshot
        : null,
    checked_in_at: raw.checked_in_at ?? null,
    checked_out_at: raw.checked_out_at ?? null,
    created_at: raw.created_at ?? null,
  }
}

export function normalizeAnnonceRecords(rows: RawAnnonceRecord[] | null | undefined): NormalizedAnnonceRecord[] {
  return (rows ?? []).map((row) => normalizeAnnonceRecord(row))
}
