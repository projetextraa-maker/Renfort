import { normalizeAnnonceRecord } from './annonce-read'
import {
  normalizeEngagementRecord,
  normalizeEngagementStatus,
  type EngagementRecord,
} from './engagements'
import { supabase } from './supabase'

export const CONTRACT_STATUSES = [
  'draft',
  'pending_patron_signature',
  'pending_worker_signature',
  'signed',
  'cancelled',
] as const

export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

export type ContractPayloadSnapshot = {
  contract_type: string
  template_version: string
  mission: {
    id: string
    poste: string
    date: string | null
    mission_slot: string | null
    heure_debut: string | null
    heure_fin: string | null
    heure_debut_midi?: string | null
    heure_fin_midi?: string | null
    heure_debut_soir?: string | null
    heure_fin_soir?: string | null
    salaire_brut_horaire: number | null
    ville: string | null
    description: string | null
  }
  patron: {
    id: string
    prenom: string | null
    nom_restaurant: string | null
    email: string | null
    telephone: string | null
    ville: string | null
  }
  worker: {
    id: string
    prenom: string | null
    nom: string | null
    email: string | null
    telephone: string | null
    ville: string | null
  }
  etablissement: {
    id: string | null
    nom: string | null
    adresse: string | null
    ville: string | null
    lat: number | null
    lng: number | null
  }
  legal: {
    employer_label: string
    platform_role: string
    convention_collective: string | null
  }
} | null

export type ContractRecord = {
  id: string
  engagement_id: string
  mission_id: string
  patron_id: string
  serveur_id: string
  etablissement_id: string | null
  status: ContractStatus
  contract_type: string
  generated_at: string | null
  patron_signed_at: string | null
  patron_signed_by_user_id?: string | null
  patron_sign_role?: string | null
  patron_signature_ip?: string | null
  patron_signature_user_agent?: string | null
  worker_signed_at: string | null
  worker_signed_by_user_id?: string | null
  worker_sign_role?: string | null
  worker_signature_ip?: string | null
  worker_signature_user_agent?: string | null
  cancelled_at: string | null
  template_version: string | null
  payload_snapshot: ContractPayloadSnapshot
  created_at: string | null
  updated_at: string | null
}

type RawContractRecord = {
  id: string
  engagement_id: string | null
  mission_id: string | null
  patron_id: string | null
  serveur_id: string | null
  etablissement_id?: string | null
  status: string | null
  contract_type?: string | null
  generated_at?: string | null
  patron_signed_at?: string | null
  patron_signed_by_user_id?: string | null
  patron_sign_role?: string | null
  patron_signature_ip?: string | null
  patron_signature_user_agent?: string | null
  worker_signed_at?: string | null
  worker_signed_by_user_id?: string | null
  worker_sign_role?: string | null
  worker_signature_ip?: string | null
  worker_signature_user_agent?: string | null
  cancelled_at?: string | null
  template_version?: string | null
  payload_snapshot?: ContractPayloadSnapshot
  created_at?: string | null
  updated_at?: string | null
}

export const CONTRACT_COMPAT_SELECT = `
  id,
  engagement_id,
  mission_id,
  patron_id,
  serveur_id,
  etablissement_id,
  status,
  contract_type,
  generated_at,
  patron_signed_at,
  patron_signed_by_user_id,
  patron_sign_role,
  patron_signature_ip,
  patron_signature_user_agent,
  worker_signed_at,
  worker_signed_by_user_id,
  worker_sign_role,
  worker_signature_ip,
  worker_signature_user_agent,
  cancelled_at,
  template_version,
  payload_snapshot,
  created_at,
  updated_at
`

const CONTRACT_BASE_SELECT = `
  id,
  engagement_id,
  mission_id,
  patron_id,
  serveur_id,
  etablissement_id,
  status,
  contract_type,
  generated_at,
  patron_signed_at,
  worker_signed_at,
  cancelled_at,
  template_version,
  payload_snapshot,
  created_at,
  updated_at
`

type ContractActionResult =
  | { ok: true; contract: ContractRecord; changed: boolean }
  | { ok: false; reason: 'not_found' | 'invalid_status' | 'update_failed' | 'blocked' | 'schema_unavailable'; message: string }

function isMissingContractsSchemaError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? '').toLowerCase()
  return (
    message.includes("could not find the table 'contracts'") ||
    message.includes('relation "contracts" does not exist') ||
    message.includes("could not find the 'contracts'")
  )
}

function isMissingContractsAuditColumnError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? '').toLowerCase()
  return (
    (message.includes('patron_signed_by_user_id') ||
      message.includes('patron_sign_role') ||
      message.includes('worker_signed_by_user_id') ||
      message.includes('worker_sign_role')) &&
    (message.includes('schema cache') || message.includes('does not exist'))
  )
}

export function normalizeContractStatus(value: string | null | undefined): ContractStatus {
  const normalized = String(value ?? '').toLowerCase()
  if (
    normalized === 'draft' ||
    normalized === 'pending_patron_signature' ||
    normalized === 'pending_worker_signature' ||
    normalized === 'signed' ||
    normalized === 'cancelled'
  ) {
    return normalized
  }
  return 'draft'
}

export function getContractStatusLabel(status: string | null | undefined): string {
  switch (normalizeContractStatus(status)) {
    case 'draft':
      return 'Brouillon'
    case 'pending_patron_signature':
      return 'Contrat à signer par le patron'
    case 'pending_worker_signature':
      return 'Contrat à signer par le serveur'
    case 'signed':
      return 'Contrat signé'
    case 'cancelled':
      return 'Annulé'
    default:
      return 'Brouillon'
  }
}

function normalizeContractRecord(raw: RawContractRecord | null | undefined): ContractRecord | null {
  if (!raw?.id || !raw.engagement_id || !raw.mission_id || !raw.patron_id || !raw.serveur_id) return null

  return {
    id: String(raw.id),
    engagement_id: String(raw.engagement_id),
    mission_id: String(raw.mission_id),
    patron_id: String(raw.patron_id),
    serveur_id: String(raw.serveur_id),
    etablissement_id: raw.etablissement_id ? String(raw.etablissement_id) : null,
    status: normalizeContractStatus(raw.status),
    contract_type: raw.contract_type ?? 'extra_mission',
    generated_at: raw.generated_at ?? null,
    patron_signed_at: raw.patron_signed_at ?? null,
    patron_signed_by_user_id: raw.patron_signed_by_user_id ?? null,
    patron_sign_role: raw.patron_sign_role ?? null,
    patron_signature_ip: raw.patron_signature_ip ?? null,
    patron_signature_user_agent: raw.patron_signature_user_agent ?? null,
    worker_signed_at: raw.worker_signed_at ?? null,
    worker_signed_by_user_id: raw.worker_signed_by_user_id ?? null,
    worker_sign_role: raw.worker_sign_role ?? null,
    worker_signature_ip: raw.worker_signature_ip ?? null,
    worker_signature_user_agent: raw.worker_signature_user_agent ?? null,
    cancelled_at: raw.cancelled_at ?? null,
    template_version: raw.template_version ?? null,
    payload_snapshot: raw.payload_snapshot ?? null,
    created_at: raw.created_at ?? null,
    updated_at: raw.updated_at ?? null,
  }
}

function normalizeContractRecords(rows: RawContractRecord[] | null | undefined): ContractRecord[] {
  return (rows ?? [])
    .map((row) => normalizeContractRecord(row))
    .filter(Boolean) as ContractRecord[]
}

function pickOperationalContract(items: ContractRecord[]): ContractRecord | null {
  if (items.length === 0) return null
  const score = (status: ContractStatus) => {
    if (status === 'signed') return 40
    if (status === 'pending_worker_signature') return 30
    if (status === 'pending_patron_signature') return 20
    if (status === 'draft') return 10
    return 0
  }
  return [...items].sort((a, b) => {
    const diff = score(b.status) - score(a.status)
    if (diff !== 0) return diff
    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
  })[0] ?? null
}

function toLegacyMissionContractStatus(status: ContractStatus): 'not_generated' | 'generated' | 'signed_by_patron' | 'signed_by_server' | 'fully_signed' {
  switch (status) {
    case 'draft':
    case 'pending_patron_signature':
      return 'generated'
    case 'pending_worker_signature':
      return 'signed_by_patron'
    case 'signed':
      return 'fully_signed'
    case 'cancelled':
    default:
      return 'not_generated'
  }
}

async function fetchEngagementById(engagementId: string): Promise<EngagementRecord | null> {
  const { data, error } = await supabase
    .from('engagements')
    .select('id, mission_id, patron_id, serveur_id, status, agreed_hourly_rate, replaced_engagement_id, contract_status, checked_in_at, checked_out_at, completed_at, cancelled_at, cancelled_reason, created_at, updated_at')
    .eq('id', engagementId)
    .maybeSingle()

  if (error || !data) return null
  return normalizeEngagementRecord(data as any)
}

async function fetchEtablissementSnapshot(etablissementId: string | null | undefined) {
  if (!etablissementId) {
    return {
      id: null,
      nom: null,
      adresse: null,
      ville: null,
      lat: null,
      lng: null,
    }
  }

  const { data: canonical } = await supabase
    .from('etablissements')
    .select('id, nom, adresse, ville, lat, lng')
    .eq('id', etablissementId)
    .maybeSingle()

  if (canonical) {
    return {
      id: String(canonical.id),
      nom: canonical.nom ?? null,
      adresse: canonical.adresse ?? null,
      ville: canonical.ville ?? null,
      lat: canonical.lat ?? null,
      lng: canonical.lng ?? null,
    }
  }

  const { data: legacy } = await supabase
    .from('etablissements')
    .select('id, name, address, city, lat, lng')
    .eq('id', etablissementId)
    .maybeSingle()

  return {
    id: legacy?.id ? String(legacy.id) : String(etablissementId),
    nom: legacy?.name ?? null,
    adresse: legacy?.address ?? null,
    ville: legacy?.city ?? null,
    lat: legacy?.lat ?? null,
    lng: legacy?.lng ?? null,
  }
}

async function syncLegacyContractState(input: {
  contract: ContractRecord
  engagement: EngagementRecord
}): Promise<void> {
  const nowIso = new Date().toISOString()
  const legacyStatus = toLegacyMissionContractStatus(input.contract.status)

  const annoncePatch: Record<string, unknown> = {
    contract_status: legacyStatus,
  }

  if (input.contract.generated_at) annoncePatch.contract_generated_at = input.contract.generated_at
  if (input.contract.patron_signed_at) {
    annoncePatch.contract_signed_by_patron_at = input.contract.patron_signed_at
  }
  if (input.contract.worker_signed_at) {
    annoncePatch.contract_signed_by_server_at = input.contract.worker_signed_at
  }

  await supabase.from('annonces').update(annoncePatch).eq('id', input.contract.mission_id)

  const engagementPatch: Record<string, unknown> = {
    contract_status: legacyStatus,
  }

  const normalizedEngagementStatus = normalizeEngagementStatus(input.engagement.status)
  if (
    normalizedEngagementStatus === 'draft' &&
    (input.contract.status === 'draft' ||
      input.contract.status === 'pending_patron_signature' ||
      input.contract.status === 'pending_worker_signature')
  ) {
    await supabase
      .from('engagements')
      .update({
        status: 'pending_signature',
        ...engagementPatch,
      })
      .eq('id', input.engagement.id)
  } else if (input.contract.status === 'signed') {
    await supabase
      .from('engagements')
      .update({
        status: 'confirmed',
        confirmed_at: nowIso,
        ...engagementPatch,
      })
      .eq('id', input.engagement.id)

    console.log('mission payment trigger attempt', input.engagement.mission_id)
    void triggerMissionPaymentAuthorizationIfNeeded(input.engagement.mission_id)
  } else {
    await supabase
      .from('engagements')
      .update(engagementPatch)
      .eq('id', input.engagement.id)
  }
}

async function triggerMissionPaymentAuthorizationIfNeeded(missionId: string): Promise<void> {
  try {
    const { data: mission, error: missionError } = await supabase
      .from('annonces')
      .select('id, payment_intent_id')
      .eq('id', missionId)
      .maybeSingle()

    if (missionError) {
      console.log('mission payment trigger read failed', {
        missionId,
        error: missionError.message,
      })
      return
    }

    if (!mission?.id || mission.payment_intent_id) {
      return
    }

    const { data, error } = await supabase.functions.invoke('stripe-create-mission-payment-intent', {
      body: { missionId },
    })

    if (error || data?.error) {
      console.log('mission payment trigger failed', {
        missionId,
        error: error?.message ?? data?.error ?? null,
      })
    }
  } catch (error: any) {
    console.log('mission payment trigger unexpected error', {
      missionId,
      error: error?.message ?? String(error),
    })
  }
}

export async function buildContractPayloadFromEngagement(
  engagementId: string
): Promise<ContractPayloadSnapshot> {
  const engagement = await fetchEngagementById(engagementId)
  if (!engagement) return null

  const { data: missionData } = await supabase
    .from('annonces')
    .select('id, patron_id, serveur_id, etablissement_id, poste, date, mission_slot, heure_debut, heure_fin, heure_debut_midi, heure_fin_midi, heure_debut_soir, heure_fin_soir, salaire, ville, description')
    .eq('id', engagement.mission_id)
    .maybeSingle()

  if (!missionData) return null
  const mission = normalizeAnnonceRecord(missionData as any)

  const { data: patronData } = await supabase
    .from('patrons')
    .select('id, prenom, nom_restaurant, email, telephone, ville')
    .eq('id', engagement.patron_id)
    .maybeSingle()

  const { data: workerData } = await supabase
    .from('serveurs')
    .select('id, prenom, nom, email, telephone, ville')
    .eq('id', engagement.serveur_id)
    .maybeSingle()

  const etablissement = await fetchEtablissementSnapshot(mission.etablissement_id)

  return {
    contract_type: 'extra_mission',
    template_version: 'v1',
    mission: {
      id: engagement.mission_id,
      poste: mission.poste,
      date: mission.date ?? null,
      mission_slot: mission.mission_slot ?? null,
      heure_debut: mission.heure_debut ?? null,
      heure_fin: mission.heure_fin ?? null,
      heure_debut_midi: mission.heure_debut_midi ?? null,
      heure_fin_midi: mission.heure_fin_midi ?? null,
      heure_debut_soir: mission.heure_debut_soir ?? null,
      heure_fin_soir: mission.heure_fin_soir ?? null,
      salaire_brut_horaire: engagement.agreed_hourly_rate ?? mission.salaire ?? null,
      ville: mission.ville ?? null,
      description: mission.description ?? null,
    },
    patron: {
      id: engagement.patron_id,
      prenom: patronData?.prenom ?? null,
      nom_restaurant: patronData?.nom_restaurant ?? null,
      email: patronData?.email ?? null,
      telephone: patronData?.telephone ?? null,
      ville: patronData?.ville ?? null,
    },
    worker: {
      id: engagement.serveur_id,
      prenom: workerData?.prenom ?? null,
      nom: workerData?.nom ?? null,
      email: workerData?.email ?? null,
      telephone: workerData?.telephone ?? null,
      ville: workerData?.ville ?? null,
    },
    etablissement,
    legal: {
      employer_label: patronData?.nom_restaurant ?? etablissement.nom ?? 'Établissement employeur',
      platform_role: "La plateforme met en relation les parties mais n'est pas l'employeur.",
      convention_collective: null,
    },
  }
}

export async function getContractForEngagement(engagementId: string): Promise<ContractRecord | null> {
  try {
    const { data, error } = await supabase
      .from('contracts')
      .select(CONTRACT_COMPAT_SELECT)
      .eq('engagement_id', engagementId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (error && isMissingContractsAuditColumnError(error)) {
      const fallback = await supabase
        .from('contracts')
        .select(CONTRACT_BASE_SELECT)
        .eq('engagement_id', engagementId)
        .order('created_at', { ascending: false })
        .limit(10)

      if (fallback.error || !fallback.data) return null
      return pickOperationalContract(normalizeContractRecords(fallback.data as RawContractRecord[]))
    }

    if (error || !data) return null
    return pickOperationalContract(normalizeContractRecords(data as RawContractRecord[]))
  } catch {
    return null
  }
}

export async function fetchContractMapForEngagements(
  engagementIds: string[]
): Promise<Record<string, ContractRecord>> {
  const uniqueIds = [...new Set(engagementIds.filter(Boolean))]
  if (uniqueIds.length === 0) return {}

  try {
    const { data, error } = await supabase
      .from('contracts')
      .select(CONTRACT_COMPAT_SELECT)
      .in('engagement_id', uniqueIds)
      .order('created_at', { ascending: false })

    if (error && isMissingContractsAuditColumnError(error)) {
      const fallback = await supabase
        .from('contracts')
        .select(CONTRACT_BASE_SELECT)
        .in('engagement_id', uniqueIds)
        .order('created_at', { ascending: false })

      if (fallback.error || !fallback.data) return {}

      const grouped = new Map<string, ContractRecord[]>()
      for (const item of normalizeContractRecords(fallback.data as RawContractRecord[])) {
        const current = grouped.get(item.engagement_id) ?? []
        current.push(item)
        grouped.set(item.engagement_id, current)
      }

      const map: Record<string, ContractRecord> = {}
      for (const [engagementId, items] of grouped.entries()) {
        const picked = pickOperationalContract(items)
        if (picked) map[engagementId] = picked
      }
      return map
    }

    if (error || !data) return {}

    const grouped = new Map<string, ContractRecord[]>()
    for (const item of normalizeContractRecords(data as RawContractRecord[])) {
      const current = grouped.get(item.engagement_id) ?? []
      current.push(item)
      grouped.set(item.engagement_id, current)
    }

    const map: Record<string, ContractRecord> = {}
    for (const [engagementId, items] of grouped.entries()) {
      const picked = pickOperationalContract(items)
      if (picked) map[engagementId] = picked
    }
    return map
  } catch {
    return {}
  }
}

export async function createDraftContractForEngagement(
  engagementId: string
): Promise<ContractActionResult> {
  const engagement = await fetchEngagementById(engagementId)
  if (!engagement) {
    return { ok: false, reason: 'not_found', message: 'Aucun engagement actif trouvé pour ce contrat.' }
  }

  const existing = await getContractForEngagement(engagementId)
  if (existing && existing.status !== 'cancelled') {
    return { ok: true, contract: existing, changed: false }
  }

  const payloadSnapshot = await buildContractPayloadFromEngagement(engagementId)
  if (!payloadSnapshot) {
    return { ok: false, reason: 'blocked', message: 'Le contrat ne peut pas être préparé sans les données de mission et d’engagement.' }
  }

  const nowIso = new Date().toISOString()
  try {
    const { error } = await supabase
      .from('contracts')
      .insert({
        engagement_id: engagement.id,
        mission_id: engagement.mission_id,
        patron_id: engagement.patron_id,
        serveur_id: engagement.serveur_id,
        etablissement_id: payloadSnapshot.etablissement.id,
        status: 'pending_patron_signature',
        contract_type: payloadSnapshot.contract_type,
        generated_at: nowIso,
        template_version: payloadSnapshot.template_version,
        payload_snapshot: payloadSnapshot,
      })

    if (error) {
      if (isMissingContractsSchemaError(error)) {
        return { ok: false, reason: 'schema_unavailable', message: 'La table contracts doit être créée avant de générer le contrat.' }
      }
      return { ok: false, reason: 'update_failed', message: "Impossible de créer le contrat pour l'instant." }
    }

    const contract = await getContractForEngagement(engagement.id)
    if (!contract) {
      return { ok: false, reason: 'update_failed', message: 'Le contrat a été créé mais sa lecture a échoué.' }
    }

    await syncLegacyContractState({ contract, engagement })
    return { ok: true, contract, changed: true }
  } catch (error) {
    if (isMissingContractsSchemaError(error)) {
      return { ok: false, reason: 'schema_unavailable', message: 'La table contracts doit être créée avant de générer le contrat.' }
    }
    return { ok: false, reason: 'update_failed', message: "Impossible de créer le contrat pour l'instant." }
  }
}

async function signContractInternal(
  engagementId: string,
  actor: 'patron' | 'worker'
): Promise<ContractActionResult> {
  const engagement = await fetchEngagementById(engagementId)
  if (!engagement) {
    return { ok: false, reason: 'not_found', message: 'Aucun engagement trouvé.' }
  }

  const contractResult = await createDraftContractForEngagement(engagementId)
  if (!contractResult.ok) return contractResult
  const contract = contractResult.contract

  if (contract.status === 'cancelled') {
    return { ok: false, reason: 'invalid_status', message: 'Ce contrat est annulé.' }
  }

  if (contract.status === 'signed') {
    return { ok: true, contract, changed: false }
  }

  if (actor === 'patron' && contract.patron_signed_at) {
    return { ok: true, contract, changed: false }
  }
  if (actor === 'worker' && contract.worker_signed_at) {
    return { ok: true, contract, changed: false }
  }

  const nowIso = new Date().toISOString()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const nextPatronSignedAt = actor === 'patron' ? nowIso : contract.patron_signed_at
  const nextWorkerSignedAt = actor === 'worker' ? nowIso : contract.worker_signed_at
  let nextStatus: ContractStatus = 'draft'

  if (nextPatronSignedAt && nextWorkerSignedAt) nextStatus = 'signed'
  else if (nextPatronSignedAt) nextStatus = 'pending_worker_signature'
  else if (nextWorkerSignedAt) nextStatus = 'pending_patron_signature'

  const patch: Record<string, unknown> = {
    status: nextStatus,
    patron_signed_at: nextPatronSignedAt,
    worker_signed_at: nextWorkerSignedAt,
  }
  if (actor === 'patron') {
    patch.patron_signed_by_user_id = user?.id ?? engagement.patron_id
    patch.patron_sign_role = 'patron'
  }
  if (actor === 'worker') {
    patch.worker_signed_by_user_id = user?.id ?? engagement.serveur_id
    patch.worker_sign_role = 'worker'
  }

  try {
    const { error } = await supabase
      .from('contracts')
      .update(patch)
      .eq('id', contract.id)

    if (error) {
      if (isMissingContractsSchemaError(error)) {
        return { ok: false, reason: 'schema_unavailable', message: 'La table contracts doit être créée avant de signer.' }
      }
      return { ok: false, reason: 'update_failed', message: "Impossible d'enregistrer cette signature." }
    }

    const updatedContract = await getContractForEngagement(engagement.id)
    if (!updatedContract) {
      return { ok: false, reason: 'update_failed', message: 'La signature a été enregistrée mais la lecture du contrat a échoué.' }
    }

    await syncLegacyContractState({ contract: updatedContract, engagement })
    return { ok: true, contract: updatedContract, changed: true }
  } catch (error) {
    if (isMissingContractsSchemaError(error)) {
      return { ok: false, reason: 'schema_unavailable', message: 'La table contracts doit être créée avant de signer.' }
    }
    return { ok: false, reason: 'update_failed', message: "Impossible d'enregistrer cette signature." }
  }
}

export async function signContractAsPatron(engagementId: string): Promise<ContractActionResult> {
  return signContractWithAudit(engagementId, 'patron')
}

export async function signContractAsWorker(engagementId: string): Promise<ContractActionResult> {
  return signContractWithAudit(engagementId, 'worker')
}

async function signContractWithAudit(
  engagementId: string,
  actor: 'patron' | 'worker'
): Promise<ContractActionResult> {
  const engagement = await fetchEngagementById(engagementId)
  if (!engagement) {
    return { ok: false, reason: 'not_found', message: 'Aucun engagement trouvé.' }
  }

  const contractResult = await createDraftContractForEngagement(engagementId)
  if (!contractResult.ok) return contractResult
  const contract = contractResult.contract

  if (!contract.payload_snapshot) {
    return { ok: false, reason: 'blocked', message: 'Le contrat ne peut pas être signé sans snapshot métier.' }
  }

  const { data, error } = await supabase.functions.invoke('contract-sign-with-audit', {
    body: {
      engagementId,
      actor,
    },
  })

  if (error || data?.error) {
    return {
      ok: false,
      reason: 'update_failed',
      message: data?.error ?? error?.message ?? "Impossible d'enregistrer cette signature.",
    }
  }

  const updatedContract = await getContractForEngagement(engagement.id)
  if (!updatedContract) {
    return { ok: false, reason: 'update_failed', message: 'La signature a été enregistrée mais la lecture du contrat a échoué.' }
  }

  await syncLegacyContractState({ contract: updatedContract, engagement })
  return { ok: true, contract: updatedContract, changed: Boolean(data?.changed ?? true) }
}

export async function cancelContract(
  engagementId: string,
  reason = 'contract_cancelled'
): Promise<ContractActionResult> {
  const engagement = await fetchEngagementById(engagementId)
  if (!engagement) {
    return { ok: false, reason: 'not_found', message: 'Aucun engagement trouvé.' }
  }

  const contract = await getContractForEngagement(engagementId)
  if (!contract) {
    return { ok: false, reason: 'not_found', message: 'Aucun contrat trouvé.' }
  }

  if (contract.status === 'cancelled') {
    return { ok: true, contract, changed: false }
  }

  try {
    const { error } = await supabase
      .from('contracts')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', contract.id)

    if (error) {
      if (isMissingContractsSchemaError(error)) {
        return { ok: false, reason: 'schema_unavailable', message: 'La table contracts doit être créée avant toute annulation.' }
      }
      return { ok: false, reason: 'update_failed', message: "Impossible d'annuler ce contrat." }
    }

    const updatedContract = await getContractForEngagement(engagement.id)
    if (!updatedContract) {
      return { ok: false, reason: 'update_failed', message: 'Le contrat a été annulé mais sa lecture a échoué.' }
    }

    await supabase
      .from('engagements')
      .update({
        status: normalizeEngagementStatus(engagement.status) === 'completed' ? 'completed' : 'cancelled',
        contract_status: 'not_generated',
        cancelled_at: normalizeEngagementStatus(engagement.status) === 'completed' ? engagement.cancelled_at ?? null : new Date().toISOString(),
        cancelled_reason: reason,
      })
      .eq('id', engagement.id)

    await supabase
      .from('annonces')
      .update({
        contract_status: 'not_generated',
        contract_generated_at: null,
        contract_signed_by_patron_at: null,
        contract_signed_by_server_at: null,
        payment_status: 'not_authorized',
        payment_authorized_at: null,
      })
      .eq('id', contract.mission_id)

    return { ok: true, contract: updatedContract, changed: true }
  } catch (error) {
    if (isMissingContractsSchemaError(error)) {
        return { ok: false, reason: 'schema_unavailable', message: 'La table contracts doit être créée avant toute annulation.' }
    }
    return { ok: false, reason: 'update_failed', message: "Impossible d'annuler ce contrat." }
  }
}

export function getContractWarnings(
  contract: ContractRecord | null,
  engagement?: EngagementRecord | null
): string[] {
  if (!contract) return []

  const warnings: string[] = []
  const status = normalizeContractStatus(contract.status)

  if (!contract.payload_snapshot) {
    warnings.push('Contrat sans snapshot métier')
  }

  if ((status === 'pending_patron_signature' || status === 'pending_worker_signature' || status === 'signed') && !contract.generated_at) {
    warnings.push('Contrat sans date de génération')
  }

  if (status === 'signed' && (!contract.patron_signed_at || !contract.worker_signed_at)) {
    warnings.push('Contrat signé sans les deux horodatages de signature')
  }

  if (status === 'cancelled' && engagement && normalizeEngagementStatus(engagement.status) !== 'cancelled') {
    warnings.push('Contrat annulé alors que l’engagement reste actif')
  }

  return warnings
}
