import { supabase } from './supabase'

export type PatronSubscriptionState = {
  abonnement: string | null
  missions_incluses: number | null
  missions_utilisees_ce_mois: number | null
  missions_hors_forfait_ce_mois: number | null
  date_debut_periode: string | null
}

export function isActiveSubscription(abonnement: string | null | undefined) {
  return abonnement === 'pro' || abonnement === 'pro_plus'
}

export function getIncludedMissionsForPlan(abonnement: string | null | undefined) {
  switch (abonnement) {
    case 'pro':
      return 10
    case 'pro_plus':
      return 25
    default:
      return 0
  }
}

export function getRemainingMissions(patron: PatronSubscriptionState | null | undefined) {
  const incluses = patron?.missions_incluses ?? 0
  const utilisees = patron?.missions_utilisees_ce_mois ?? 0
  return Math.max(0, incluses - utilisees)
}

export function getOverageCount(patron: PatronSubscriptionState | null | undefined) {
  return Math.max(0, patron?.missions_hors_forfait_ce_mois ?? 0)
}

export function getOverageUnitPrice(abonnement: string | null | undefined) {
  switch (abonnement) {
    case 'pro':
      return 5
    case 'pro_plus':
      return 4
    default:
      return 0
  }
}

export function getEstimatedOverageAmount(patron: PatronSubscriptionState | null | undefined) {
  return getOverageCount(patron) * getOverageUnitPrice(patron?.abonnement)
}

export function shouldResetMonthlyPeriod(dateDebutPeriode: string | null | undefined) {
  if (!dateDebutPeriode) return true

  const startedAt = new Date(dateDebutPeriode)
  if (Number.isNaN(startedAt.getTime())) return true

  const nextReset = new Date(startedAt)
  nextReset.setMonth(nextReset.getMonth() + 1)

  return new Date() >= nextReset
}

export async function syncPatronSubscriptionCycle(patronId: string) {
  const { data, error } = await supabase
    .from('patrons')
    .select('abonnement, missions_incluses, missions_utilisees_ce_mois, missions_hors_forfait_ce_mois, date_debut_periode')
    .eq('id', patronId)
    .single()

  if (error || !data) {
    return { data: null, error }
  }

  const expectedIncluded = getIncludedMissionsForPlan(data.abonnement)
  const updates: Partial<PatronSubscriptionState> = {}

  if (isActiveSubscription(data.abonnement)) {
    if ((data.missions_incluses ?? 0) !== expectedIncluded) {
      updates.missions_incluses = expectedIncluded
    }

    if (shouldResetMonthlyPeriod(data.date_debut_periode)) {
      updates.missions_utilisees_ce_mois = 0
      updates.missions_hors_forfait_ce_mois = 0
      updates.date_debut_periode = new Date().toISOString()
    } else if (data.missions_utilisees_ce_mois == null) {
      updates.missions_utilisees_ce_mois = 0
      if (data.missions_hors_forfait_ce_mois == null) {
        updates.missions_hors_forfait_ce_mois = 0
      }
    }
  }

  if (!isActiveSubscription(data.abonnement)) {
    if ((data.missions_incluses ?? 0) !== 0) updates.missions_incluses = 0
    if ((data.missions_utilisees_ce_mois ?? 0) !== 0) updates.missions_utilisees_ce_mois = 0
    if ((data.missions_hors_forfait_ce_mois ?? 0) !== 0) updates.missions_hors_forfait_ce_mois = 0
  }

  if (Object.keys(updates).length === 0) {
    return { data, error: null }
  }

  const { data: updatedData, error: updateError } = await supabase
    .from('patrons')
    .update(updates)
    .eq('id', patronId)
    .select('abonnement, missions_incluses, missions_utilisees_ce_mois, missions_hors_forfait_ce_mois, date_debut_periode')
    .single()

  return { data: updatedData ?? { ...data, ...updates }, error: updateError }
}
