import { supabase } from './supabase'

const COMPLETED_STATUSES = new Set(['completed', 'terminee'])
const NO_SHOW_STATUSES = new Set(['no_show'])

function normalizeStatus(value: unknown): string {
  return String(value ?? '').toLowerCase()
}

export type ServeurExperienceBadgeKey = 'nouveau' | 'confirme' | 'experimente' | 'expert'

export function getServeurExperienceBadgeKey(completedMissions: number): ServeurExperienceBadgeKey {
  if (completedMissions > 50) return 'expert'
  if (completedMissions >= 20) return 'experimente'
  if (completedMissions >= 3) return 'confirme'
  return 'nouveau'
}

export function getServeurExperienceBadgeLabel(completedMissions: number): string {
  const key = getServeurExperienceBadgeKey(completedMissions)
  if (key === 'expert') return 'Expert'
  if (key === 'experimente') return 'Pro'
  if (key === 'confirme') return 'Confirmé'
  return 'Nouveau'
}

export type ServeurMissionStats = {
  completedMissions: number
  noShowMissions: number
}

function hasValidatedCheckOut(row: {
  check_in_status?: string | null
  checked_out_at?: string | null
}): boolean {
  const checkInStatus = String(row.check_in_status ?? '').toLowerCase()
  return Boolean(row.checked_out_at) || checkInStatus === 'checked_out'
}

function isLegacyCompletedMission(row: {
  statut?: string | null
  check_in_status?: string | null
  checked_out_at?: string | null
}): boolean {
  const status = normalizeStatus(row.statut)
  const checkInStatus = String(row.check_in_status ?? '').toLowerCase()

  if (!COMPLETED_STATUSES.has(status)) return false
  if (hasValidatedCheckOut(row)) return false

  return checkInStatus === '' || checkInStatus === 'null' || checkInStatus === 'undefined'
}

export async function computeServeurMissionStatsFromAnnonces(
  serveurId: string
): Promise<ServeurMissionStats> {
  const { data, error } = await supabase
    .from('annonces')
    .select('statut, check_in_status, checked_out_at')
    .eq('serveur_id', serveurId)
    .in('statut', ['completed', 'terminee', 'no_show'])

  if (error || !data) {
    console.log('computeServeurMissionStatsFromAnnonces error', error)
    return { completedMissions: 0, noShowMissions: 0 }
  }

  let completedMissions = 0
  let noShowMissions = 0

  for (const row of data as { statut?: string | null; check_in_status?: string | null; checked_out_at?: string | null }[]) {
    const status = normalizeStatus(row.statut)
    if (COMPLETED_STATUSES.has(status) && (hasValidatedCheckOut(row) || isLegacyCompletedMission(row))) {
      completedMissions += 1
      continue
    }

    if (NO_SHOW_STATUSES.has(status)) {
      noShowMissions += 1
    }
  }

  return { completedMissions, noShowMissions }
}

export async function syncServeurMissionStats(
  serveurId: string
): Promise<ServeurMissionStats> {
  const stats = await computeServeurMissionStatsFromAnnonces(serveurId)
  const badge = getServeurExperienceBadgeKey(stats.completedMissions)

  const updatePayload: Record<string, unknown> = {
    missions_realisees: stats.completedMissions,
    missions_annulees: stats.noShowMissions,
    badge,
  }

  const { error } = await supabase
    .from('serveurs')
    .update(updatePayload)
    .eq('id', serveurId)

  if (error) {
    console.log('syncServeurMissionStats update error', error)
  }

  return stats
}

export async function computeServeurMissionStatsMap(
  serveurIds: string[]
): Promise<Record<string, ServeurMissionStats>> {
  const uniqueIds = Array.from(new Set(serveurIds.filter(Boolean)))
  if (uniqueIds.length === 0) return {}

  const { data, error } = await supabase
    .from('annonces')
    .select('serveur_id, statut, check_in_status, checked_out_at')
    .in('serveur_id', uniqueIds)
    .in('statut', ['completed', 'terminee', 'no_show'])

  if (error || !data) {
    console.log('computeServeurMissionStatsMap error', error)
    return Object.fromEntries(uniqueIds.map((id) => [id, { completedMissions: 0, noShowMissions: 0 }]))
  }

  const statsMap: Record<string, ServeurMissionStats> = Object.fromEntries(
    uniqueIds.map((id) => [id, { completedMissions: 0, noShowMissions: 0 }])
  )

  for (const row of data as { serveur_id?: string | null; statut?: string | null; check_in_status?: string | null; checked_out_at?: string | null }[]) {
    const serveurId = String(row.serveur_id ?? '')
    if (!serveurId || !statsMap[serveurId]) continue

    const status = normalizeStatus(row.statut)
    if (COMPLETED_STATUSES.has(status) && (hasValidatedCheckOut(row) || isLegacyCompletedMission(row))) {
      statsMap[serveurId].completedMissions += 1
      continue
    }

    if (NO_SHOW_STATUSES.has(status)) {
      statsMap[serveurId].noShowMissions += 1
    }
  }

  return statsMap
}
