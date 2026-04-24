import { supabase } from './supabase'

export const ENGAGEMENT_STATUSES = [
  'draft',
  'pending_signature',
  'confirmed',
  'active',
  'completed',
  'cancelled',
] as const

export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number]

export type EngagementRecord = {
  id: string
  mission_id: string
  patron_id: string
  serveur_id: string
  status: string | null
  agreed_hourly_rate?: number | null
  replaced_engagement_id?: string | null
  contract_status?: string | null
  checked_in_at?: string | null
  checked_out_at?: string | null
  completed_at?: string | null
  cancelled_at?: string | null
  cancelled_reason?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type RawEngagementRecord = {
  id: string
  mission_id: string | null
  patron_id: string | null
  serveur_id: string | null
  status: string | null
  agreed_hourly_rate?: number | string | null
  replaced_engagement_id?: string | null
  contract_status?: string | null
  selected_at?: string | null
  confirmed_at?: string | null
  checked_in_at?: string | null
  checked_out_at?: string | null
  completed_at?: string | null
  cancelled_at?: string | null
  cancelled_reason?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export const ENGAGEMENT_COMPAT_SELECT = `
  id,
  mission_id,
  patron_id,
  serveur_id,
  status,
  agreed_hourly_rate,
  replaced_engagement_id,
  contract_status,
  selected_at,
  confirmed_at,
  checked_in_at,
  checked_out_at,
  completed_at,
  cancelled_at,
  cancelled_reason,
  created_at,
  updated_at
`

export function normalizeEngagementStatus(value: string | null | undefined): EngagementStatus {
  const normalized = String(value ?? '').toLowerCase()
  if (
    normalized === 'draft' ||
    normalized === 'pending_signature' ||
    normalized === 'confirmed' ||
    normalized === 'active' ||
    normalized === 'completed' ||
    normalized === 'cancelled'
  ) {
    return normalized
  }
  return 'draft'
}

export function normalizeEngagementRecord(raw: RawEngagementRecord | null | undefined): EngagementRecord | null {
  if (!raw?.id || !raw.mission_id || !raw.patron_id || !raw.serveur_id) return null

  return {
    id: String(raw.id),
    mission_id: String(raw.mission_id),
    patron_id: String(raw.patron_id),
    serveur_id: String(raw.serveur_id),
    status: normalizeEngagementStatus(raw.status),
    agreed_hourly_rate:
      raw.agreed_hourly_rate != null && Number.isFinite(Number(raw.agreed_hourly_rate))
        ? Number(raw.agreed_hourly_rate)
        : null,
    replaced_engagement_id: raw.replaced_engagement_id ? String(raw.replaced_engagement_id) : null,
    contract_status: raw.contract_status ?? 'not_generated',
    checked_in_at: raw.checked_in_at ?? null,
    checked_out_at: raw.checked_out_at ?? null,
    completed_at: raw.completed_at ?? null,
    cancelled_at: raw.cancelled_at ?? null,
    cancelled_reason: raw.cancelled_reason ?? null,
    created_at: raw.created_at ?? null,
    updated_at: raw.updated_at ?? null,
  }
}

export function normalizeEngagementRecords(rows: RawEngagementRecord[] | null | undefined): EngagementRecord[] {
  return (rows ?? [])
    .map((row) => normalizeEngagementRecord(row))
    .filter(Boolean) as EngagementRecord[]
}

export function isActiveEngagementStatus(status: string | null | undefined): boolean {
  const normalized = normalizeEngagementStatus(status)
  return normalized === 'draft' || normalized === 'pending_signature' || normalized === 'confirmed' || normalized === 'active'
}

export function isTerminalEngagementStatus(status: string | null | undefined): boolean {
  const normalized = normalizeEngagementStatus(status)
  return normalized === 'completed' || normalized === 'cancelled'
}

function getEngagementSortScore(item: EngagementRecord): number {
  const status = normalizeEngagementStatus(item.status)
  if (status === 'active') return 50
  if (status === 'confirmed') return 40
  if (status === 'pending_signature') return 30
  if (status === 'draft') return 20
  if (status === 'completed') return 10
  return 0
}

function compareEngagementPriority(a: EngagementRecord, b: EngagementRecord): number {
  const scoreDiff = getEngagementSortScore(b) - getEngagementSortScore(a)
  if (scoreDiff !== 0) return scoreDiff
  return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
}

function pickOperationalEngagement(items: EngagementRecord[]): EngagementRecord | null {
  if (items.length === 0) return null
  return [...items].sort(compareEngagementPriority)[0] ?? null
}

export function canTransitionEngagement(
  currentStatus: string | null | undefined,
  nextStatus: EngagementStatus
): boolean {
  const current = normalizeEngagementStatus(currentStatus)
  if (current === nextStatus) return true

  switch (current) {
    case 'draft':
      return nextStatus === 'pending_signature' || nextStatus === 'cancelled'
    case 'pending_signature':
      return nextStatus === 'confirmed' || nextStatus === 'cancelled'
    case 'confirmed':
      return nextStatus === 'active' || nextStatus === 'completed' || nextStatus === 'cancelled'
    case 'active':
      return nextStatus === 'completed' || nextStatus === 'cancelled'
    case 'completed':
    case 'cancelled':
      return false
    default:
      return false
  }
}

export function getEngagementStatusLabel(status: string | null | undefined): string {
  switch (normalizeEngagementStatus(status)) {
    case 'draft':
      return 'Engagement créé'
    case 'pending_signature':
      return 'Signatures en attente'
    case 'confirmed':
      return 'Engagement confirmé'
    case 'active':
      return 'Mission en cours'
    case 'completed':
      return 'Engagement terminé'
    case 'cancelled':
      return 'Engagement annulé'
    default:
      return 'Engagement créé'
  }
}

export function canCheckInWithEngagement(status: string | null | undefined): boolean {
  const normalized = normalizeEngagementStatus(status)
  return normalized === 'confirmed' || normalized === 'active'
}

export function canConfirmMissionWithEngagement(status: string | null | undefined): boolean {
  const normalized = normalizeEngagementStatus(status)
  return normalized === 'confirmed' || normalized === 'active'
}

export function getEngagementWarnings(engagement: EngagementRecord | null): string[] {
  if (!engagement) return []

  const warnings: string[] = []
  const status = normalizeEngagementStatus(engagement.status)

  if (status === 'draft' && engagement.contract_status && engagement.contract_status !== 'not_generated') {
    warnings.push('Engagement encore brouillon alors que le contrat a démarré')
  }

  if (status === 'pending_signature' && !engagement.contract_status) {
    warnings.push('Engagement sans contrat rattaché')
  }

  if (status === 'confirmed' && !engagement.contract_status) {
    warnings.push('Engagement confirmé sans contrat')
  }

  if (status === 'active' && engagement.contract_status && engagement.contract_status !== 'fully_signed') {
    warnings.push('Mission en cours alors que le contrat n’est pas signé des deux côtés')
  }

  if (status === 'completed' && !engagement.checked_in_at) {
    warnings.push('Engagement terminé sans check-in enregistré')
  }

  if (status === 'completed' && !engagement.completed_at) {
    warnings.push('Engagement terminé sans horodatage de fin')
  }

  return warnings
}

export async function fetchActiveEngagementForMission(missionId: string): Promise<EngagementRecord | null> {
  const { data, error } = await supabase
    .from('engagements')
    .select(ENGAGEMENT_COMPAT_SELECT)
    .eq('mission_id', missionId)
    .in('status', ['draft', 'pending_signature', 'confirmed', 'active'])
    .order('created_at', { ascending: false })
    .limit(10)

  if (error || !data) return null
  return pickOperationalEngagement(normalizeEngagementRecords(data as RawEngagementRecord[]))
}

export async function fetchLatestEngagementForMission(missionId: string): Promise<EngagementRecord | null> {
  const { data, error } = await supabase
    .from('engagements')
    .select(ENGAGEMENT_COMPAT_SELECT)
    .eq('mission_id', missionId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error || !data) return null
  return pickOperationalEngagement(normalizeEngagementRecords(data as RawEngagementRecord[]))
}

export async function fetchEngagementMapForMissions(
  missionIds: string[]
): Promise<Record<string, EngagementRecord>> {
  if (missionIds.length === 0) return {}

  const { data, error } = await supabase
    .from('engagements')
    .select(ENGAGEMENT_COMPAT_SELECT)
    .in('mission_id', missionIds)
    .order('created_at', { ascending: false })

  if (error || !data) return {}

  const map: Record<string, EngagementRecord> = {}
  const grouped = new Map<string, EngagementRecord[]>()
  for (const item of normalizeEngagementRecords(data as RawEngagementRecord[])) {
    const current = grouped.get(item.mission_id) ?? []
    current.push(item)
    grouped.set(item.mission_id, current)
  }
  for (const [missionId, items] of grouped.entries()) {
    const picked = pickOperationalEngagement(items)
    if (picked) map[missionId] = picked
  }
  return map
}

export async function createEngagementForMissionSelection(input: {
  missionId: string
  patronId: string
  serveurId: string
  agreedHourlyRate?: number | null
  replacedEngagementId?: string | null
}): Promise<EngagementRecord | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  console.log('confirm proposed mission click', {
    authUid: user?.id ?? null,
    missionId: input.missionId,
    patronId: input.patronId,
    serveurId: input.serveurId,
    replacedEngagementId: input.replacedEngagementId ?? null,
  })

  const existing = await fetchActiveEngagementForMission(input.missionId)
  if (existing) {
    console.log('create engagement existing found', {
      authUid: user?.id ?? null,
      missionId: input.missionId,
      existingEngagementId: existing.id,
      existingServeurId: existing.serveur_id,
      existingStatus: existing.status,
    })
    if (existing.serveur_id === input.serveurId) return existing
    return null
  }

  const nowIso = new Date().toISOString()
  const payload = {
    mission_id: input.missionId,
    patron_id: input.patronId,
    serveur_id: input.serveurId,
    status: 'pending_signature',
    selected_at: nowIso,
    confirmed_at: null,
    agreed_hourly_rate: input.agreedHourlyRate ?? null,
    contract_status: 'not_generated',
    replaced_engagement_id: input.replacedEngagementId ?? null,
  }

  console.log('create engagement payload', {
    authUid: user?.id ?? null,
    serveurRowId: input.serveurId,
    missionId: input.missionId,
    payload,
  })

  const { data, error } = await supabase
    .from('engagements')
    .insert(payload)
    .select(ENGAGEMENT_COMPAT_SELECT)
    .single()

  if (error || !data) {
    const supabaseErrorDetails = error
      ? {
          message: error.message,
          code: (error as any)?.code ?? null,
          details: (error as any)?.details ?? null,
          hint: (error as any)?.hint ?? null,
          raw: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        }
      : null

    console.error('create engagement supabase error', supabaseErrorDetails)
    console.error('create engagement error', {
      authUid: user?.id ?? null,
      missionId: input.missionId,
      serveurId: input.serveurId,
      patronId: input.patronId,
      payload,
      result: data ?? null,
      error: supabaseErrorDetails,
    })
    return null
  }

  console.log('create engagement result', {
    authUid: user?.id ?? null,
    missionId: input.missionId,
    engagementId: (data as any)?.id ?? null,
    status: (data as any)?.status ?? null,
  })
  return normalizeEngagementRecord(data as RawEngagementRecord)
}

export async function updateEngagementLifecycle(
  engagementId: string,
  status: EngagementStatus,
  patch?: Record<string, unknown>
): Promise<boolean> {
  const { data: current, error: currentError } = await supabase
    .from('engagements')
    .select('id, status')
    .eq('id', engagementId)
    .maybeSingle()

  if (currentError || !current) return false
  if (!canTransitionEngagement(current.status, status)) return false

  const { error } = await supabase
    .from('engagements')
    .update({
      status,
      ...patch,
    })
    .eq('id', engagementId)

  return !error
}

export async function cancelEngagement(
  engagementId: string,
  reason: string
): Promise<boolean> {
  return updateEngagementLifecycle(engagementId, 'cancelled', {
    cancelled_at: new Date().toISOString(),
    cancelled_reason: reason,
  })
}
