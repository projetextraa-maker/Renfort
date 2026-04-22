import { normalizeMissionStatus, shouldHideMissionFromOpenLists } from './missions'
import { computeServeurMissionStatsFromAnnonces } from './serveur-stats'
import { supabase } from './supabase'

export type MissionRateNegotiationTier = 'none' | 'plus_1' | 'plus_2' | 'plus_3_or_20pct'
export type MissionRateNegotiationStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled'

export type MissionRateNegotiationRecord = {
  id: string
  mission_id: string
  serveur_id: string
  patron_id: string
  engagement_id: string | null
  original_rate: number
  counter_rate: number
  max_allowed_rate: number
  eligibility_tier: MissionRateNegotiationTier
  status: MissionRateNegotiationStatus
  created_at: string | null
  responded_at: string | null
  accepted_at: string | null
  rejected_at: string | null
  updated_at: string | null
}

export type MissionRateNegotiationEligibility = {
  allowed: boolean
  tier: MissionRateNegotiationTier
  baseRate: number
  maxAllowedRate: number
  profileRating: number | null
  presenceRate: number | null
  completedMissions: number
  noShowMissions: number
  recentNoShowCount: number
  cancellationRate: number | null
  reasons: string[]
}

type RawMissionRateNegotiation = {
  id: string
  mission_id: string | null
  serveur_id: string | null
  patron_id: string | null
  engagement_id?: string | null
  original_rate?: number | string | null
  counter_rate?: number | string | null
  max_allowed_rate?: number | string | null
  eligibility_tier?: string | null
  status?: string | null
  created_at?: string | null
  responded_at?: string | null
  accepted_at?: string | null
  rejected_at?: string | null
  updated_at?: string | null
}

const MISSION_RATE_NEGOTIATION_SELECT = `
  id,
  mission_id,
  serveur_id,
  patron_id,
  engagement_id,
  original_rate,
  counter_rate,
  max_allowed_rate,
  eligibility_tier,
  status,
  created_at,
  responded_at,
  accepted_at,
  rejected_at,
  updated_at
`

function toSafeNumber(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function normalizeTier(value: string | null | undefined): MissionRateNegotiationTier {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'plus_1' || normalized === 'plus_2' || normalized === 'plus_3_or_20pct') {
    return normalized
  }
  return 'none'
}

function normalizeStatus(value: string | null | undefined): MissionRateNegotiationStatus {
  const normalized = String(value ?? '').toLowerCase()
  if (
    normalized === 'pending' ||
    normalized === 'accepted' ||
    normalized === 'rejected' ||
    normalized === 'expired' ||
    normalized === 'cancelled'
  ) {
    return normalized
  }
  return 'pending'
}

function normalizeMissionRateNegotiationRecord(
  raw: RawMissionRateNegotiation | null | undefined
): MissionRateNegotiationRecord | null {
  if (!raw?.id || !raw.mission_id || !raw.serveur_id || !raw.patron_id) return null

  return {
    id: String(raw.id),
    mission_id: String(raw.mission_id),
    serveur_id: String(raw.serveur_id),
    patron_id: String(raw.patron_id),
    engagement_id: raw.engagement_id ? String(raw.engagement_id) : null,
    original_rate: roundMoney(toSafeNumber(raw.original_rate)),
    counter_rate: roundMoney(toSafeNumber(raw.counter_rate)),
    max_allowed_rate: roundMoney(toSafeNumber(raw.max_allowed_rate)),
    eligibility_tier: normalizeTier(raw.eligibility_tier),
    status: normalizeStatus(raw.status),
    created_at: raw.created_at ?? null,
    responded_at: raw.responded_at ?? null,
    accepted_at: raw.accepted_at ?? null,
    rejected_at: raw.rejected_at ?? null,
    updated_at: raw.updated_at ?? null,
  }
}

async function getServeurReliabilitySnapshot(serveurId: string): Promise<{
  completedMissions: number
  noShowMissions: number
  presenceRate: number | null
  recentNoShowCount10: number
  recentNoShowCount20: number
  cancellationRate: number | null
  ratingAverage: number | null
}> {
  const stats = await computeServeurMissionStatsFromAnnonces(serveurId)
  const completedMissions = stats.completedMissions
  const noShowMissions = stats.noShowMissions
  const trackedPresenceCount = completedMissions + noShowMissions
  const presenceRate =
    trackedPresenceCount > 0 ? Math.round((completedMissions / trackedPresenceCount) * 100) : null

  const { data: serveurRow } = await supabase
    .from('serveurs')
    .select('score')
    .eq('id', serveurId)
    .maybeSingle()

  const ratingAverage =
    serveurRow && Number.isFinite(Number((serveurRow as any).score))
      ? Number((serveurRow as any).score)
      : null

  const { data: recentRows } = await supabase
    .from('annonces')
    .select('statut, date, heure_debut, created_at')
    .eq('serveur_id', serveurId)
    .in('statut', ['completed', 'terminee', 'no_show', 'cancelled_by_server'])
    .order('date', { ascending: false })
    .order('heure_debut', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(20)

  const recentStatuses = (recentRows ?? []).map((row: any) => String(row.statut ?? '').toLowerCase())
  const recentNoShowCount10 = recentStatuses.slice(0, 10).filter((status) => status === 'no_show').length
  const recentNoShowCount20 = recentStatuses.slice(0, 20).filter((status) => status === 'no_show').length
  const recentCancelledCount = recentStatuses.filter((status) => status === 'cancelled_by_server').length
  const trackedReliabilityCount = completedMissions + noShowMissions + recentCancelledCount
  const cancellationRate =
    trackedReliabilityCount > 0
      ? Math.round((recentCancelledCount / trackedReliabilityCount) * 1000) / 10
      : null

  return {
    completedMissions,
    noShowMissions,
    presenceRate,
    recentNoShowCount10,
    recentNoShowCount20,
    cancellationRate,
    ratingAverage,
  }
}

function getNegotiationTierFromSnapshot(input: {
  baseRate: number
  completedMissions: number
  presenceRate: number | null
  recentNoShowCount10: number
  recentNoShowCount20: number
  cancellationRate: number | null
  ratingAverage: number | null
}): { tier: MissionRateNegotiationTier; maxAllowedRate: number; reasons: string[] } {
  const reasons: string[] = []

  const isReliable =
    input.completedMissions >= 3 &&
    (input.presenceRate ?? 0) >= 90 &&
    input.recentNoShowCount10 === 0 &&
    (input.ratingAverage ?? 0) >= 4.2 &&
    (input.cancellationRate ?? 0) <= 10

  const isVeryGood =
    input.completedMissions >= 50 &&
    (input.presenceRate ?? 0) >= 96 &&
    input.recentNoShowCount20 === 0 &&
    (input.ratingAverage ?? 0) >= 4.6 &&
    (input.cancellationRate ?? 0) <= 5

  if (isVeryGood) {
    return {
      tier: 'plus_3_or_20pct',
      maxAllowedRate: roundMoney(input.baseRate + Math.min(3, input.baseRate * 0.2)),
      reasons,
    }
  }

  if (isReliable && input.completedMissions >= 20) {
    return {
      tier: 'plus_2',
      maxAllowedRate: roundMoney(input.baseRate + 2),
      reasons,
    }
  }

  if (isReliable) {
    return {
      tier: 'plus_1',
      maxAllowedRate: roundMoney(input.baseRate + 1),
      reasons,
    }
  }

  if (input.completedMissions < 3) reasons.push('Moins de 3 missions terminées.')
  if ((input.presenceRate ?? 0) < 90) reasons.push('Présence insuffisante.')
  if (input.recentNoShowCount10 > 0) reasons.push('No-show récent détecté.')
  if ((input.ratingAverage ?? 0) < 4.2) reasons.push('Note globale insuffisante.')
  if ((input.cancellationRate ?? 0) > 10) reasons.push('Trop d’annulations récentes.')

  return {
    tier: 'none',
    maxAllowedRate: roundMoney(input.baseRate),
    reasons,
  }
}

export async function getMissionRateNegotiationEligibility(
  serveurId: string,
  missionId: string
): Promise<MissionRateNegotiationEligibility> {
  const denied = (reasons: string[], baseRate = 0): MissionRateNegotiationEligibility => ({
    allowed: false,
    tier: 'none',
    baseRate: roundMoney(baseRate),
    maxAllowedRate: roundMoney(baseRate),
    profileRating: null,
    presenceRate: null,
    completedMissions: 0,
    noShowMissions: 0,
    recentNoShowCount: 0,
    cancellationRate: null,
    reasons,
  })

  if (!serveurId || !missionId) {
    return denied(['Mission ou serveur introuvable.'])
  }

  const { data: mission } = await supabase
    .from('annonces')
    .select('id, patron_id, salaire, statut, date, heure_debut, heure_fin')
    .eq('id', missionId)
    .maybeSingle()

  if (!mission) {
    return denied(['Mission introuvable.'])
  }

  const baseRate = roundMoney(toSafeNumber((mission as any).salaire))
  const missionStatus = normalizeMissionStatus((mission as any).statut)
  if (missionStatus !== 'open') {
    return denied(['La mission n’est plus ouverte à la négociation.'], baseRate)
  }

  if (
    shouldHideMissionFromOpenLists(
      (mission as any).statut,
      (mission as any).date,
      (mission as any).heure_debut,
      (mission as any).heure_fin
    )
  ) {
    return denied(['La mission n’est plus disponible.'], baseRate)
  }

  const { data: existingEngagement } = await supabase
    .from('engagements')
    .select('id, status')
    .eq('mission_id', missionId)
    .in('status', ['confirmed', 'active', 'completed', 'cancelled'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingEngagement && ['confirmed', 'active', 'completed'].includes(String((existingEngagement as any).status ?? '').toLowerCase())) {
    return denied(['La mission est déjà engagée ou confirmée.'], baseRate)
  }

  const { data: existingNegotiation } = await supabase
    .from('mission_rate_negotiations')
    .select('id')
    .eq('mission_id', missionId)
    .eq('serveur_id', serveurId)
    .maybeSingle()

  if (existingNegotiation?.id) {
    return denied(['Une contre-offre existe déjà pour cette mission.'], baseRate)
  }

  const snapshot = await getServeurReliabilitySnapshot(serveurId)
  const tierResult = getNegotiationTierFromSnapshot({
    baseRate,
    ...snapshot,
  })

  return {
    allowed: tierResult.tier !== 'none',
    tier: tierResult.tier,
    baseRate,
    maxAllowedRate: tierResult.maxAllowedRate,
    profileRating: snapshot.ratingAverage,
    presenceRate: snapshot.presenceRate,
    completedMissions: snapshot.completedMissions,
    noShowMissions: snapshot.noShowMissions,
    recentNoShowCount:
      tierResult.tier === 'plus_3_or_20pct' ? snapshot.recentNoShowCount20 : snapshot.recentNoShowCount10,
    cancellationRate: snapshot.cancellationRate,
    reasons: tierResult.reasons,
  }
}

export async function fetchMissionNegotiationForServer(
  serveurId: string,
  missionId: string
): Promise<MissionRateNegotiationRecord | null> {
  const { data, error } = await supabase
    .from('mission_rate_negotiations')
    .select(MISSION_RATE_NEGOTIATION_SELECT)
    .eq('serveur_id', serveurId)
    .eq('mission_id', missionId)
    .maybeSingle()

  if (error || !data) return null
  return normalizeMissionRateNegotiationRecord(data as RawMissionRateNegotiation)
}

export async function fetchAcceptedMissionNegotiationForServer(
  serveurId: string,
  missionId: string
): Promise<MissionRateNegotiationRecord | null> {
  const { data, error } = await supabase
    .from('mission_rate_negotiations')
    .select(MISSION_RATE_NEGOTIATION_SELECT)
    .eq('serveur_id', serveurId)
    .eq('mission_id', missionId)
    .eq('status', 'accepted')
    .order('accepted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return normalizeMissionRateNegotiationRecord(data as RawMissionRateNegotiation)
}

export async function fetchPendingMissionNegotiationsForPatron(
  patronId: string
): Promise<MissionRateNegotiationRecord[]> {
  const { data, error } = await supabase
    .from('mission_rate_negotiations')
    .select(MISSION_RATE_NEGOTIATION_SELECT)
    .eq('patron_id', patronId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error || !data) return []

  return (data as RawMissionRateNegotiation[])
    .map((row) => normalizeMissionRateNegotiationRecord(row))
    .filter(Boolean) as MissionRateNegotiationRecord[]
}

export async function createMissionRateCounterOffer(input: {
  missionId: string
  serveurId: string
  counterRate: number
}): Promise<
  | { ok: true; negotiation: MissionRateNegotiationRecord; eligibility: MissionRateNegotiationEligibility }
  | { ok: false; reason: 'not_allowed' | 'invalid_rate' | 'already_exists' | 'write_failed'; message: string }
> {
  const eligibility = await getMissionRateNegotiationEligibility(input.serveurId, input.missionId)
  if (!eligibility.allowed) {
    return {
      ok: false,
      reason: 'not_allowed',
      message: eligibility.reasons[0] ?? 'La négociation n’est pas disponible pour cette mission.',
    }
  }

  const askedRate = roundMoney(toSafeNumber(input.counterRate))
  if (askedRate < eligibility.baseRate || askedRate > eligibility.maxAllowedRate) {
    return {
      ok: false,
      reason: 'invalid_rate',
      message: `Le tarif proposé doit être compris entre ${eligibility.baseRate} et ${eligibility.maxAllowedRate} ${String.fromCharCode(8364)}.`,
    }
  }

  const { data: mission } = await supabase
    .from('annonces')
    .select('patron_id')
    .eq('id', input.missionId)
    .maybeSingle()

  if (!mission?.patron_id) {
    return { ok: false, reason: 'write_failed', message: 'Mission introuvable.' }
  }

  const payload = {
    mission_id: input.missionId,
    serveur_id: input.serveurId,
    patron_id: String((mission as any).patron_id),
    original_rate: eligibility.baseRate,
    counter_rate: askedRate,
    max_allowed_rate: eligibility.maxAllowedRate,
    eligibility_tier: eligibility.tier,
    status: 'pending',
  }

  const { data, error } = await supabase
    .from('mission_rate_negotiations')
    .insert(payload)
    .select(MISSION_RATE_NEGOTIATION_SELECT)
    .maybeSingle()

  if (error) {
    if (String((error as any).message ?? '').toLowerCase().includes('duplicate')) {
      return { ok: false, reason: 'already_exists', message: 'Une contre-offre existe déjà pour cette mission.' }
    }
    return { ok: false, reason: 'write_failed', message: 'Impossible d’enregistrer la contre-offre.' }
  }

  const negotiation = normalizeMissionRateNegotiationRecord(data as RawMissionRateNegotiation)
  if (!negotiation) {
    return { ok: false, reason: 'write_failed', message: 'Impossible d’enregistrer la contre-offre.' }
  }

  return { ok: true, negotiation, eligibility }
}

export async function acceptMissionRateCounterOffer(input: {
  negotiationId: string
  engagementId?: string | null
}): Promise<
  | { ok: true; negotiation: MissionRateNegotiationRecord }
  | { ok: false; reason: 'not_found' | 'invalid_status' | 'write_failed'; message: string }
> {
  const { data: existing, error: existingError } = await supabase
    .from('mission_rate_negotiations')
    .select(MISSION_RATE_NEGOTIATION_SELECT)
    .eq('id', input.negotiationId)
    .maybeSingle()

  const negotiation = normalizeMissionRateNegotiationRecord(existing as RawMissionRateNegotiation)
  if (existingError || !negotiation) {
    return { ok: false, reason: 'not_found', message: 'Contre-offre introuvable.' }
  }

  if (negotiation.status !== 'pending') {
    return { ok: false, reason: 'invalid_status', message: 'Cette contre-offre ne peut plus être acceptée.' }
  }

  const acceptedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('mission_rate_negotiations')
    .update({
      status: 'accepted',
      responded_at: acceptedAt,
      accepted_at: acceptedAt,
      engagement_id: input.engagementId ?? negotiation.engagement_id,
    })
    .eq('id', input.negotiationId)
    .select(MISSION_RATE_NEGOTIATION_SELECT)
    .maybeSingle()

  if (error) {
    return { ok: false, reason: 'write_failed', message: 'Impossible d’accepter la contre-offre.' }
  }

  if (input.engagementId) {
    await supabase
      .from('engagements')
      .update({ agreed_hourly_rate: negotiation.counter_rate })
      .eq('id', input.engagementId)
  }

  const normalized = normalizeMissionRateNegotiationRecord(data as RawMissionRateNegotiation)
  if (!normalized) {
    return { ok: false, reason: 'write_failed', message: 'Impossible d’accepter la contre-offre.' }
  }

  return { ok: true, negotiation: normalized }
}

export async function rejectMissionRateCounterOffer(
  negotiationId: string
): Promise<
  | { ok: true; negotiation: MissionRateNegotiationRecord }
  | { ok: false; reason: 'not_found' | 'invalid_status' | 'write_failed'; message: string }
> {
  const { data: existing, error: existingError } = await supabase
    .from('mission_rate_negotiations')
    .select(MISSION_RATE_NEGOTIATION_SELECT)
    .eq('id', negotiationId)
    .maybeSingle()

  const negotiation = normalizeMissionRateNegotiationRecord(existing as RawMissionRateNegotiation)
  if (existingError || !negotiation) {
    return { ok: false, reason: 'not_found', message: 'Contre-offre introuvable.' }
  }

  if (negotiation.status !== 'pending') {
    return { ok: false, reason: 'invalid_status', message: 'Cette contre-offre ne peut plus être refusée.' }
  }

  const rejectedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('mission_rate_negotiations')
    .update({
      status: 'rejected',
      responded_at: rejectedAt,
      rejected_at: rejectedAt,
    })
    .eq('id', negotiationId)
    .select(MISSION_RATE_NEGOTIATION_SELECT)
    .maybeSingle()

  if (error) {
    return { ok: false, reason: 'write_failed', message: 'Impossible de refuser la contre-offre.' }
  }

  const normalized = normalizeMissionRateNegotiationRecord(data as RawMissionRateNegotiation)
  if (!normalized) {
    return { ok: false, reason: 'write_failed', message: 'Impossible de refuser la contre-offre.' }
  }

  return { ok: true, negotiation: normalized }
}
