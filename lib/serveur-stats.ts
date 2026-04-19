import { supabase } from './supabase'

const COMPLETED_STATUSES = new Set(['completed', 'terminee'])
const NO_SHOW_STATUSES = new Set(['no_show'])

function normalizeStatus(value: unknown): string {
  return String(value ?? '').toLowerCase()
}

function getBadgeFromCompletedMissions(completedMissions: number): string | null {
  if (completedMissions >= 50) return 'platine'
  if (completedMissions >= 30) return 'or'
  if (completedMissions >= 10) return 'argent'
  return null
}

export type ServeurMissionStats = {
  completedMissions: number
  noShowMissions: number
}

export async function computeServeurMissionStatsFromAnnonces(
  serveurId: string
): Promise<ServeurMissionStats> {
  const { data, error } = await supabase
    .from('annonces')
    .select('statut')
    .eq('serveur_id', serveurId)
    .in('statut', ['completed', 'terminee', 'no_show'])

  if (error || !data) {
    console.log('computeServeurMissionStatsFromAnnonces error', error)
    return { completedMissions: 0, noShowMissions: 0 }
  }

  let completedMissions = 0
  let noShowMissions = 0

  for (const row of data as { statut?: string | null }[]) {
    const status = normalizeStatus(row.statut)
    if (COMPLETED_STATUSES.has(status)) {
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
  const badge = getBadgeFromCompletedMissions(stats.completedMissions)

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
    .select('serveur_id, statut')
    .in('serveur_id', uniqueIds)
    .in('statut', ['completed', 'terminee', 'no_show'])

  if (error || !data) {
    console.log('computeServeurMissionStatsMap error', error)
    return Object.fromEntries(uniqueIds.map((id) => [id, { completedMissions: 0, noShowMissions: 0 }]))
  }

  const statsMap: Record<string, ServeurMissionStats> = Object.fromEntries(
    uniqueIds.map((id) => [id, { completedMissions: 0, noShowMissions: 0 }])
  )

  for (const row of data as { serveur_id?: string | null; statut?: string | null }[]) {
    const serveurId = String(row.serveur_id ?? '')
    if (!serveurId || !statsMap[serveurId]) continue

    const status = normalizeStatus(row.statut)
    if (COMPLETED_STATUSES.has(status)) {
      statsMap[serveurId].completedMissions += 1
      continue
    }

    if (NO_SHOW_STATUSES.has(status)) {
      statsMap[serveurId].noShowMissions += 1
    }
  }

  return statsMap
}
