import {
  ANNONCE_COMPAT_SELECT,
  ANNONCE_COMPAT_WITH_WORKFLOW_SELECT,
  normalizeAnnonceRecord,
  normalizeAnnonceRecords,
} from './annonce-read'
import {
  buildContractPayloadFromEngagement,
  createDraftContractForEngagement,
  getContractForEngagement,
  signContractAsPatron,
  signContractAsWorker,
} from './contracts'
import { fetchAcceptedMissionNegotiationForServer } from './mission-rate-negotiations'
import { supabase } from './supabase'
import { cancelEngagement, canCheckInWithEngagement, createEngagementForMissionSelection, fetchActiveEngagementForMission, updateEngagementLifecycle } from './engagements'
import {
  CONFIRMED_MISSION_READ_STATUSES,
  OPEN_MISSION_READ_STATUSES,
  doMissionRangesOverlap,
  isActiveMissionStatus,
  isOpenMissionStatus,
  shouldMissionBeInProgress,
} from './missions'
import {
  canMarkMissionNoShow,
  canCheckInMission,
  canCheckOutMission,
  canGenerateContract,
  canRequestPresenceConfirmation,
  canSignContractByPatron,
  canSignContractByServeur,
  getCheckInBlockMessage,
  getCheckOutBlockMessage,
  getUrgentReplacementBlockMessage,
  getMissionValidationSummary,
} from './mission-validation'

type AssignAnnonceResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'already_assigned' | 'worker_unavailable' | 'invalid_status' | 'update_failed'; message?: string }

type CancelAnnonceResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'invalid_status' | 'update_failed' }

type UpdateAnnonceStatusResult =
  | { ok: true; changed: boolean; previousStatus: string | null }
  | { ok: false; reason: 'not_found' | 'invalid_status' | 'update_failed' }

type MissionWorkflowResult =
  | { ok: true; changed: boolean; stage?: 'pending_confirmation' | 'confirmed' }
  | { ok: false; reason: 'not_found' | 'invalid_status' | 'update_failed' | 'blocked'; message?: string }

function logMissionWorkflowSchemaDependency(step: string, detail: string, extra?: Record<string, unknown>) {
  console.warn(`mission-workflow:${step}`, { detail, ...(extra ?? {}) })
}

function logDpaeDebug(stage: string, payload: Record<string, unknown>) {
  console.log(`mission-dpae:${stage}`, payload)
}

function logDpaeReturningError(payload: Record<string, unknown>) {
  console.error('mission-dpae:returning-error', payload)
}

async function captureMissionPaymentIfNeeded(annonceId: string): Promise<void> {
  try {
    const { data: mission, error: missionError } = await supabase
      .from('annonces')
      .select('id, payment_intent_id, payment_status')
      .eq('id', annonceId)
      .maybeSingle()

    if (missionError) {
      console.log('mission payment capture read failed', {
        missionId: annonceId,
        error: missionError.message,
      })
      return
    }

    if (!mission?.id || !mission.payment_intent_id || mission.payment_status === 'captured') {
      return
    }

    const { data, error } = await supabase.functions.invoke('stripe-capture-mission-payment-intent', {
      body: { missionId: annonceId },
    })

    if (error || data?.error) {
      console.log('mission payment capture failed', {
        missionId: annonceId,
        error: error?.message ?? data?.error ?? null,
        stripeStatus: data?.stripeStatus ?? null,
      })
      return
    }

    console.log('mission payment capture succeeded', {
      missionId: annonceId,
      paymentIntentId: data?.paymentIntentId ?? null,
      stripeStatus: data?.stripeStatus ?? null,
      missionPaymentStatus: data?.missionPaymentStatus ?? null,
    })
  } catch (error: any) {
    console.log('mission payment capture unexpected error', {
      missionId: annonceId,
      error: error?.message ?? String(error),
    })
  }
}

function isMissingDpaeSchemaError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? '').toLowerCase()
  return message.includes("dpae_done") && message.includes('does not exist')
}

function isMissingDpaeAuditSchemaError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? '').toLowerCase()
  return (
    (message.includes('dpae_done_at') && message.includes('does not exist')) ||
    (message.includes('dpae_done_by') && message.includes('does not exist')) ||
    (message.includes('dpae_status') && message.includes('does not exist')) ||
    (message.includes('dpae_payload_snapshot') && message.includes('does not exist'))
  )
}

function isMissingEngagementsSchemaError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? '').toLowerCase()
  return (
    message.includes("could not find the table 'engagements'") ||
    message.includes('relation "public.engagements" does not exist') ||
    message.includes('relation "engagements" does not exist') ||
    message.includes("schema cache")
  )
}

function getSupabaseErrorDebug(error: unknown) {
  return {
    message: String((error as { message?: string } | null)?.message ?? ''),
    code: (error as { code?: string } | null)?.code ?? null,
    details: (error as { details?: string } | null)?.details ?? null,
    hint: (error as { hint?: string } | null)?.hint ?? null,
  }
}

function getReadableDpaeErrorMessage(error: unknown, fallback = 'Impossible de confirmer la DPAE.') {
  const debug = getSupabaseErrorDebug(error)
  let raw = ''
  try {
    raw = JSON.stringify(error, Object.getOwnPropertyNames(error as object))
  } catch {
    raw = String(error ?? '')
  }
  const parts = [debug.message, debug.code, debug.details, debug.hint]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)

  if (parts.length === 0 && raw.trim()) return raw.trim()
  if (parts.length === 0) return fallback
  return parts.join(' | ')
}

type DpaePayloadSnapshot = {
  employer: {
    patron_id: string
    employer_label: string | null
    etablissement_id: string | null
    etablissement_nom: string | null
    etablissement_adresse: string | null
    etablissement_ville: string | null
  }
  worker: {
    serveur_id: string
    prenom: string | null
    nom: string | null
    email: string | null
    telephone: string | null
    ville: string | null
  }
  mission: {
    mission_id: string
    poste: string | null
    date: string | null
    heure_debut: string | null
    heure_fin: string | null
    mission_slot: string | null
    lieu_travail: string | null
    remuneration_brute_horaire: number | null
  }
  source: {
    contract_template_version: string | null
    prepared_at: string
  }
}

type DpaeRecord = {
  mission_id: string
  status: string | null
  confirmed_at: string | null
  confirmed_by: string | null
}

function isMissingDpaeRecordsSchemaError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? '').toLowerCase()
  return (
    message.includes("could not find the table 'dpae_records'") ||
    message.includes('relation "public.dpae_records" does not exist') ||
    message.includes('relation "dpae_records" does not exist')
  )
}

function isDpaeRecordsPermissionError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? '').toLowerCase()
  return (
    message.includes('row-level security') ||
    message.includes('permission denied') ||
    message.includes('violates row-level security policy')
  )
}

async function fetchDpaeRecordForMission(annonceId: string): Promise<DpaeRecord | null | undefined> {
  const { data, error } = await supabase
    .from('dpae_records')
    .select('mission_id, status, confirmed_at, confirmed_by')
    .eq('mission_id', annonceId)
    .maybeSingle()

  if (error) {
    if (isMissingDpaeRecordsSchemaError(error)) return undefined
    return null
  }
  if (!data) return null

  return {
    mission_id: String(data.mission_id),
    status: data.status ?? null,
    confirmed_at: data.confirmed_at ?? null,
    confirmed_by: data.confirmed_by ?? null,
  }
}

async function ensureDpaeRecordForMission(annonceId: string): Promise<DpaeRecord | null> {
  const existing = await fetchDpaeRecordForMission(annonceId)
  if (typeof existing === 'undefined') return null
  if (existing) return existing

  const { data, error } = await supabase
    .from('dpae_records')
    .insert({
      mission_id: annonceId,
      status: 'not_started',
    })
    .select('mission_id, status, confirmed_at, confirmed_by')
    .maybeSingle()

  if (!error && data) {
    return {
      mission_id: String(data.mission_id),
      status: data.status ?? null,
      confirmed_at: data.confirmed_at ?? null,
      confirmed_by: data.confirmed_by ?? null,
    }
  }

  if (isMissingDpaeRecordsSchemaError(error)) return null
  const fallback = await fetchDpaeRecordForMission(annonceId)
  return typeof fallback === 'undefined' ? null : fallback
}

async function resetMissionDpaeRecord(annonceId: string): Promise<void> {
  const record = await ensureDpaeRecordForMission(annonceId)
  if (!record) return

  await supabase
    .from('dpae_records')
    .update({
      status: 'not_started',
      confirmed_at: null,
      confirmed_by: null,
    })
    .eq('mission_id', annonceId)
}

async function buildMissionDpaePayload(annonceId: string): Promise<DpaePayloadSnapshot | null> {
  const engagement = await fetchActiveEngagementForMission(annonceId)
  if (!engagement) return null

  const payload = await buildContractPayloadFromEngagement(engagement.id)
  if (!payload) return null

  const lieuTravail = [payload.etablissement.nom, payload.etablissement.adresse, payload.etablissement.ville]
    .filter(Boolean)
    .join(', ')

  return {
    employer: {
      patron_id: payload.patron.id,
      employer_label: payload.legal.employer_label ?? payload.patron.nom_restaurant ?? payload.etablissement.nom ?? null,
      etablissement_id: payload.etablissement.id,
      etablissement_nom: payload.etablissement.nom,
      etablissement_adresse: payload.etablissement.adresse,
      etablissement_ville: payload.etablissement.ville,
    },
    worker: {
      serveur_id: payload.worker.id,
      prenom: payload.worker.prenom,
      nom: payload.worker.nom,
      email: payload.worker.email,
      telephone: payload.worker.telephone,
      ville: payload.worker.ville,
    },
    mission: {
      mission_id: payload.mission.id,
      poste: payload.mission.poste,
      date: payload.mission.date,
      heure_debut: payload.mission.heure_debut,
      heure_fin: payload.mission.heure_fin,
      mission_slot: payload.mission.mission_slot,
      lieu_travail: lieuTravail || payload.mission.ville || null,
      remuneration_brute_horaire: payload.mission.salaire_brut_horaire,
    },
    source: {
      contract_template_version: payload.template_version,
      prepared_at: new Date().toISOString(),
    },
  }
}

type MissionWorkflowSnapshot = {
  id: string
  statut: string | null
  etablissement_id?: string | null
  date?: string | null
  heure_debut?: string | null
  heure_fin?: string | null
  presence_confirmation_status?: string | null
  contract_status?: string | null
  payment_status?: string | null
  check_in_status?: string | null
  engagement_status?: string | null
  dpae_done?: boolean | null
  dpae_status?: string | null
  dpae_done_at?: string | null
  dpae_done_by?: string | null
  dpae_payload_snapshot?: Record<string, unknown> | null
  engagement_checked_in_at?: string | null
  engagement_checked_out_at?: string | null
  check_out_requested_by?: string | null
  check_out_requested_at?: string | null
  check_out_confirmed_at?: string | null
}

export async function fetchMissionWorkflowSnapshot(annonceId: string): Promise<MissionWorkflowSnapshot | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  logDpaeDebug('fetch_snapshot:prequery', {
    mission_id: annonceId,
    patron_id: user?.id ?? null,
    etablissement_id: null,
    table: 'annonces',
    where: { id: annonceId },
  })

  const engagement = await fetchActiveEngagementForMission(annonceId)
  const contract = engagement ? await getContractForEngagement(engagement.id) : null
  const { data, error } = await supabase
    .from('annonces')
    .select(ANNONCE_COMPAT_WITH_WORKFLOW_SELECT)
    .eq('id', annonceId)
    .maybeSingle()

  let annonceRow: any = null

  if (error && /check_in_status|checked_in_at|checked_out_at|check_out_requested_|check_out_confirmed_at|dpae_|contract_status|payment_status/i.test(String(error.message ?? ''))) {
    logDpaeDebug('fetch_snapshot:workflow_query_error', {
      mission_id: annonceId,
      patron_id: user?.id ?? null,
      table: 'annonces',
      where: { id: annonceId },
      error: getSupabaseErrorDebug(error),
    })

    const compatQuery = await supabase
      .from('annonces')
      .select(ANNONCE_COMPAT_SELECT)
      .eq('id', annonceId)
      .maybeSingle()

    if (compatQuery.error || !compatQuery.data) {
      logDpaeDebug('fetch_snapshot:compat_query_error', {
        mission_id: annonceId,
        patron_id: user?.id ?? null,
        table: 'annonces',
        where: { id: annonceId },
        error: getSupabaseErrorDebug(compatQuery.error),
        found: Boolean(compatQuery.data),
      })
      return null
    }

    annonceRow = {
      ...compatQuery.data,
      checked_out_at: null,
    }
  } else {
    if (error || !data) {
      logDpaeDebug('fetch_snapshot:not_found', {
        mission_id: annonceId,
        patron_id: user?.id ?? null,
        table: 'annonces',
        where: { id: annonceId },
        error: getSupabaseErrorDebug(error),
        found: Boolean(data),
      })
      return null
    }
    annonceRow = data
  }

  const normalized = normalizeAnnonceRecord(annonceRow as any)

  logDpaeDebug('fetch_snapshot:found', {
    mission_id: annonceId,
    patron_id: user?.id ?? null,
    table: 'annonces',
    where: { id: annonceId },
    found_mission_id: normalized.id,
    found_patron_id: normalized.patron_id,
    found_etablissement_id: normalized.etablissement_id,
  })
  let dpaeRecord: DpaeRecord | null | undefined = null
  try {
    dpaeRecord = await fetchDpaeRecordForMission(annonceId)
  } catch (error) {
    if (!isMissingDpaeRecordsSchemaError(error)) {
      console.warn('fetchMissionWorkflowSnapshot dpae_records warning', error)
    }
  }
  let dpaeData: any = null
  let dpaeError: any = null

  const dpaeAuditQuery = await supabase
    .from('annonces')
    .select('id, dpae_done, dpae_status, dpae_done_at, dpae_done_by, dpae_payload_snapshot')
    .eq('id', annonceId)
    .maybeSingle()

  if (dpaeAuditQuery.error && isMissingDpaeAuditSchemaError(dpaeAuditQuery.error)) {
    const fallback = await supabase
      .from('annonces')
      .select('id, dpae_done, dpae_done_at, dpae_done_by')
      .eq('id', annonceId)
      .maybeSingle()
    dpaeData = fallback.data
    dpaeError = fallback.error
  } else {
    dpaeData = dpaeAuditQuery.data
    dpaeError = dpaeAuditQuery.error
  }

  const auditDpaeDone =
    !dpaeError && dpaeData && typeof dpaeData.dpae_done === 'boolean'
      ? Boolean(dpaeData.dpae_done)
      : null
  const auditDpaeStatus = !dpaeError && dpaeData ? (dpaeData.dpae_status ?? null) : null
  const auditDpaeDoneAt = !dpaeError && dpaeData ? (dpaeData.dpae_done_at ?? null) : null
  const auditDpaeDoneBy = !dpaeError && dpaeData ? (dpaeData.dpae_done_by ?? null) : null

  const dpaeDone =
    dpaeRecord?.status === 'confirmed'
      ? true
      : auditDpaeDone
  const dpaeStatus = dpaeRecord?.status ?? auditDpaeStatus ?? 'not_started'
  const dpaeDoneAt = dpaeRecord?.confirmed_at ?? auditDpaeDoneAt
  const dpaeDoneBy = dpaeRecord?.confirmed_by ?? auditDpaeDoneBy
  const dpaePayloadSnapshot =
    !dpaeError && dpaeData && dpaeData.dpae_payload_snapshot && typeof dpaeData.dpae_payload_snapshot === 'object'
      ? dpaeData.dpae_payload_snapshot
      : null

  return {
    id: normalized.id,
    statut: normalized.statut,
    etablissement_id: normalized.etablissement_id,
    date: normalized.date,
    heure_debut: normalized.heure_debut,
    heure_fin: normalized.heure_fin,
    presence_confirmation_status: normalized.presence_confirmation_status,
    contract_status: contract?.status ?? null,
    payment_status: normalized.payment_status,
    check_in_status: normalized.check_in_status,
    engagement_status: engagement?.status ?? null,
    dpae_done: dpaeDone,
    dpae_status: dpaeStatus,
    dpae_done_at: dpaeDoneAt,
    dpae_done_by: dpaeDoneBy,
    dpae_payload_snapshot: dpaePayloadSnapshot,
    engagement_checked_in_at: engagement?.checked_in_at ?? null,
    engagement_checked_out_at: engagement?.checked_out_at ?? null,
    check_out_requested_by: normalized.check_out_requested_by ?? null,
    check_out_requested_at: normalized.check_out_requested_at ?? null,
    check_out_confirmed_at: normalized.check_out_confirmed_at ?? null,
  }
}

async function hasServeurOverlappingActiveMission(
  annonceId: string,
  serveurId: string
): Promise<boolean> {
  const { data: targetMission, error: targetError } = await supabase
    .from('annonces')
    .select(ANNONCE_COMPAT_SELECT)
    .eq('id', annonceId)
    .maybeSingle()

  if (targetError || !targetMission) return false
  const normalizedTargetMission = normalizeAnnonceRecord(targetMission as any)

  const { data: activeMissions, error: activeError } = await supabase
    .from('annonces')
    .select(ANNONCE_COMPAT_SELECT)
    .eq('serveur_id', serveurId)
    .neq('id', annonceId)
    .in('statut', [...CONFIRMED_MISSION_READ_STATUSES, 'in_progress'])

  if (activeError || !activeMissions) return false

  return normalizeAnnonceRecords(activeMissions as any[]).some((mission) =>
    doMissionRangesOverlap(
      {
        date: normalizedTargetMission.date,
        heureDebut: normalizedTargetMission.heure_debut,
        heureFin: normalizedTargetMission.heure_fin,
      },
      {
        date: mission.date,
        heureDebut: mission.heure_debut,
        heureFin: mission.heure_fin,
      }
    )
  )
}

async function finalizeMissionSelectionWorkflow(input: {
  annonceId: string
  patronId: string
  serveurId: string
  replacedEngagementId?: string | null
}): Promise<AssignAnnonceResult> {
  console.log('mission-selection: finalize:start', input)
  const acceptedNegotiation = await fetchAcceptedMissionNegotiationForServer(
    input.serveurId,
    input.annonceId
  )
  const activeEngagement = await fetchActiveEngagementForMission(input.annonceId)
  if (activeEngagement && activeEngagement.serveur_id !== input.serveurId) {
    return { ok: false, reason: 'already_assigned' }
  }

  const negotiatedRate = acceptedNegotiation?.counter_rate ?? null

  const engagement = activeEngagement ?? await createEngagementForMissionSelection({
    missionId: input.annonceId,
    patronId: input.patronId,
    serveurId: input.serveurId,
    agreedHourlyRate: negotiatedRate,
    replacedEngagementId: input.replacedEngagementId ?? null,
  })

  if (!engagement) {
    const { error: engagementSchemaError } = await supabase
      .from('engagements')
      .select('id')
      .limit(1)

    if (isMissingEngagementsSchemaError(engagementSchemaError)) {
      console.warn('finalizeMissionSelectionWorkflow blocked: engagements schema unavailable')
    }

    return { ok: false, reason: 'update_failed', message: "Impossible de créer l'engagement de mission." }
  }

  const engagementPatch: Record<string, unknown> = {
    selected_at: new Date().toISOString(),
  }
  if (negotiatedRate != null) {
    engagementPatch.agreed_hourly_rate = negotiatedRate
  }

  await supabase
    .from('engagements')
    .update(engagementPatch)
    .eq('id', engagement.id)

  if (acceptedNegotiation && acceptedNegotiation.engagement_id !== engagement.id) {
    await supabase
      .from('mission_rate_negotiations')
      .update({ engagement_id: engagement.id })
      .eq('id', acceptedNegotiation.id)
  }

  const draftContractResult = await createDraftContractForEngagement(engagement.id)
  if (!draftContractResult.ok) {
    if (draftContractResult.reason === 'schema_unavailable') {
      logMissionWorkflowSchemaDependency('contract_bootstrap', draftContractResult.message, {
        annonceId: input.annonceId,
        engagementId: engagement.id,
      })
    } else {
      console.warn('finalizeMissionSelectionWorkflow contract bootstrap warning', draftContractResult.message)
    }
  }

  await supabase
    .from('annonces')
    .update({ dpae_done: false })
    .eq('id', input.annonceId)

  await resetMissionDpaeRecord(input.annonceId)

  const { data: relatedDemandes, error: demandesError } = await supabase
    .from('demandes')
    .select('id, serveur_id, statut')
    .eq('annonce_id', input.annonceId)

  if (demandesError || !relatedDemandes) {
    console.warn('mission-selection: finalize:demandes_fetch_failed', {
      annonceId: input.annonceId,
      error: getSupabaseErrorDebug(demandesError),
    })
    return { ok: true }
  }

  const selectedDemandIds = relatedDemandes
    .filter((demande) => demande.serveur_id === input.serveurId && demande.statut !== 'acceptee')
    .map((demande) => demande.id)

  const otherDemandIds = relatedDemandes
    .filter((demande) => demande.serveur_id !== input.serveurId && ['en_attente', 'acceptee'].includes(demande.statut))
    .map((demande) => demande.id)

  if (selectedDemandIds.length > 0) {
    await supabase
      .from('demandes')
      .update({ statut: 'acceptee' })
      .in('id', selectedDemandIds)
  }

  if (otherDemandIds.length > 0) {
    await supabase
      .from('demandes')
      .update({ statut: 'expiree' })
      .in('id', otherDemandIds)
  }

  return { ok: true }
}

export async function assignAnnonceToServeur(
  annonceId: string,
  serveurId: string,
  options?: { replacedEngagementId?: string | null }
): Promise<AssignAnnonceResult> {
  console.log('mission-selection: assign:start', {
    annonceId,
    serveurId,
    replacedEngagementId: options?.replacedEngagementId ?? null,
  })

  const { data: annonce, error: annonceError } = await supabase
    .from('annonces')
    .select('id, statut, serveur_id, patron_id')
    .eq('id', annonceId)
    .maybeSingle()

  if (annonceError || !annonce) {
    console.error('mission-selection: assign:annonce_fetch_error', {
      annonceId,
      serveurId,
      error: getSupabaseErrorDebug(annonceError),
    })
    return { ok: false, reason: 'not_found', message: 'Mission introuvable.' }
  }

  console.log('mission-selection: assign:annonce_state', {
    annonceId,
    statut: annonce.statut,
    currentServeurId: annonce.serveur_id ?? null,
    patronId: annonce.patron_id ?? null,
  })

  const isDraftMission = String(annonce.statut ?? '').toLowerCase() === 'draft'

  if (!isOpenMissionStatus(annonce.statut) && !isDraftMission) {
    if (annonce.serveur_id === serveurId && isActiveMissionStatus(annonce.statut)) {
      return finalizeMissionSelectionWorkflow({
        annonceId,
        patronId: String(annonce.patron_id),
        serveurId,
        replacedEngagementId: options?.replacedEngagementId ?? null,
      })
    }

    if (annonce.serveur_id && annonce.serveur_id !== serveurId) {
      return { ok: false, reason: 'already_assigned', message: 'Cette mission est déjà attribuée à un autre profil.' }
    }

    return { ok: false, reason: 'invalid_status', message: `Cette mission ne peut plus être confirmée dans son statut actuel : ${String(annonce.statut ?? 'inconnu')}.` }
  }

  const hasOverlap = await hasServeurOverlappingActiveMission(annonceId, serveurId)
  if (hasOverlap) {
    return { ok: false, reason: 'worker_unavailable', message: 'Vous êtes déjà engagé sur ce créneau.' }
  }

  const activeEngagement = await fetchActiveEngagementForMission(annonceId)
  if (activeEngagement && activeEngagement.serveur_id !== serveurId) {
    return { ok: false, reason: 'already_assigned', message: 'Un engagement actif existe déjà pour un autre profil sur cette mission.' }
  }

  const { data: updatedAnnonce, error: annonceUpdateError } = await supabase
    .from('annonces')
    .update({
      statut: 'confirmed',
      serveur_id: serveurId,
      presence_confirmation_status: 'not_requested',
      presence_confirmation_sent_at: null,
      presence_confirmation_due_at: null,
      presence_confirmation_responded_at: null,
      contract_status: 'not_generated',
      contract_generated_at: null,
      contract_signed_by_patron_at: null,
      contract_signed_by_server_at: null,
      payment_status: 'not_authorized',
      payment_authorized_at: null,
      payment_released_at: null,
      payment_blocked_at: null,
      check_in_status: 'not_checked_in',
      checked_in_at: null,
      checked_out_at: null,
      check_out_requested_by: null,
      check_out_requested_at: null,
      check_out_confirmed_at: null,
      dispute_reason: null,
      dispute_created_at: null,
      cancelled_at: null,
    })
    .eq('id', annonceId)
    .in('statut', [...OPEN_MISSION_READ_STATUSES, 'draft'])
    .select('id')
    .maybeSingle()

  if (annonceUpdateError) {
    console.error('mission-selection: assign:annonce_update_error', {
      annonceId,
      serveurId,
      patch: {
        statut: 'confirmed',
        serveur_id: serveurId,
      },
      error: getSupabaseErrorDebug(annonceUpdateError),
    })
    return { ok: false, reason: 'update_failed', message: "La mission n'a pas pu être confirmée en base." }
  }

  if (!updatedAnnonce) {
    const { data: currentAnnonce } = await supabase
      .from('annonces')
      .select('statut, serveur_id')
      .eq('id', annonceId)
      .maybeSingle()

    if (currentAnnonce?.serveur_id && currentAnnonce.serveur_id !== serveurId) {
      return { ok: false, reason: 'already_assigned', message: 'Cette mission a déjà été attribuée pendant votre confirmation.' }
    }

    if (currentAnnonce?.serveur_id === serveurId && isActiveMissionStatus(currentAnnonce.statut)) {
      return finalizeMissionSelectionWorkflow({
        annonceId,
        patronId: String(annonce.patron_id),
        serveurId,
        replacedEngagementId: options?.replacedEngagementId ?? null,
      })
    }

    return { ok: false, reason: 'invalid_status', message: `La mission n'est plus confirmable dans son statut actuel : ${String(currentAnnonce?.statut ?? annonce.statut ?? 'inconnu')}.` }
  }
  const workflowResult = await finalizeMissionSelectionWorkflow({
    annonceId,
    patronId: String(annonce.patron_id),
    serveurId,
    replacedEngagementId: options?.replacedEngagementId ?? null,
  })

  if (!workflowResult.ok) {
    console.warn('mission-selection: assign:workflow_failed', {
      annonceId,
      serveurId,
      result: workflowResult,
    })
    await supabase
      .from('annonces')
      .update({ statut: 'open', serveur_id: null })
      .eq('id', annonceId)
  }

  console.log('mission-selection: assign:result', {
    annonceId,
    serveurId,
    result: workflowResult,
  })
  return workflowResult
}

// Preferred business name:
// the patron selects a worker for a mission, which creates the hiring engagement flow.
// We keep assignAnnonceToServeur for backward compatibility with older screens.
export async function selectServeurForMission(
  annonceId: string,
  serveurId: string,
  options?: { replacedEngagementId?: string | null }
): Promise<AssignAnnonceResult> {
  return assignAnnonceToServeur(annonceId, serveurId, options)
}

export async function closeDemandesForAnnonce(
  annonceId: string,
  statut: 'annulee' | 'expiree'
): Promise<void> {
  await supabase
    .from('demandes')
    .update({ statut })
    .eq('annonce_id', annonceId)
    .in('statut', ['en_attente', 'acceptee'])
}

export async function expireOpenAnnonces(annonceIds: string[]): Promise<void> {
  if (annonceIds.length === 0) return

  await supabase
    .from('annonces')
    .update({ statut: 'expired' })
    .in('id', annonceIds)
    .in('statut', [...OPEN_MISSION_READ_STATUSES])
}

export async function cancelConfirmedAnnonce(
  annonceId: string,
  actor: 'patron' | 'serveur'
): Promise<CancelAnnonceResult> {
  const { data: annonce, error: annonceError } = await supabase
    .from('annonces')
    .select('id, statut, serveur_id')
    .eq('id', annonceId)
    .maybeSingle()

  if (annonceError || !annonce) {
    return { ok: false, reason: 'not_found' }
  }

  if (!isActiveMissionStatus(annonce.statut)) {
    return { ok: false, reason: 'invalid_status' }
  }

  if (actor === 'patron') {
    await closeDemandesForAnnonce(annonceId, 'annulee')
    const engagement = await fetchActiveEngagementForMission(annonceId)
    if (engagement) {
      await cancelEngagement(engagement.id, 'cancelled_by_patron')
    }

    const { error } = await supabase
      .from('annonces')
      .update({ statut: 'cancelled_by_patron', cancelled_at: new Date().toISOString() })
      .eq('id', annonceId)

    if (error) return { ok: false, reason: 'update_failed' }
    return { ok: true }
  }

  await closeDemandesForAnnonce(annonceId, 'annulee')
  const engagement = await fetchActiveEngagementForMission(annonceId)
  if (engagement) {
    await cancelEngagement(engagement.id, 'cancelled_by_server')
  }

  const { error } = await supabase
    .from('annonces')
    .update({ statut: 'cancelled_by_server', cancelled_at: new Date().toISOString() })
    .eq('id', annonceId)

  if (error) return { ok: false, reason: 'update_failed' }
  return { ok: true }
}

export async function updateAnnonceLifecycleStatus(
  annonceId: string,
  statut: 'in_progress' | 'completed' | 'no_show'
): Promise<UpdateAnnonceStatusResult> {
  const { data: annonce, error: annonceError } = await supabase
    .from('annonces')
    .select('id, statut')
    .eq('id', annonceId)
    .maybeSingle()

  if (annonceError || !annonce) {
    return { ok: false, reason: 'not_found' }
  }

  if (!isActiveMissionStatus(annonce.statut)) {
    return { ok: false, reason: 'invalid_status' }
  }

  const previousStatus = annonce.statut != null ? String(annonce.statut) : null

  if (statut === 'no_show') {
    const workflowSnapshot = await fetchMissionWorkflowSnapshot(annonceId)
    if (!workflowSnapshot || !canMarkMissionNoShow(workflowSnapshot)) {
      return { ok: false, reason: 'invalid_status' }
    }
    const engagement = await fetchActiveEngagementForMission(annonceId)
    if (engagement) {
      await cancelEngagement(engagement.id, 'worker_no_show')
    }
  }

  if (String(annonce.statut ?? '').toLowerCase() === statut) {
    return { ok: true, changed: false, previousStatus }
  }

  const { error } = await supabase
    .from('annonces')
    .update({ statut })
    .eq('id', annonceId)

  if (error) {
    return { ok: false, reason: 'update_failed' }
  }

  if (statut === 'completed') {
    const engagement = await fetchActiveEngagementForMission(annonceId)
    if (engagement) {
      await updateEngagementLifecycle(engagement.id, 'completed', {
        completed_at: new Date().toISOString(),
      })
    }
  }

  return { ok: true, changed: true, previousStatus }
}

type SyncableAnnonce = {
  id: string
  statut: string | null
  date: string | null
  heure_debut?: string | null
  check_in_status?: string | null
}

export async function syncAnnoncesInProgress<T extends SyncableAnnonce>(
  annonces: T[]
): Promise<string[]> {
  const idsToProgress = annonces
    .filter((annonce) =>
      String(annonce.check_in_status ?? '').toLowerCase() === 'checked_in' &&
      shouldMissionBeInProgress(annonce.statut, annonce.date, annonce.heure_debut)
    )
    .map((annonce) => annonce.id)

  if (idsToProgress.length === 0) return []

  const { data, error } = await supabase
    .from('annonces')
    .update({ statut: 'in_progress' })
    .in('id', idsToProgress)
    .in('statut', [...CONFIRMED_MISSION_READ_STATUSES])
    .select('id')

  if (error) {
    console.log('syncAnnoncesInProgress error', error)
    return []
  }

  return (data ?? []).map((item: any) => String(item.id))
}

export async function requestMissionPresenceConfirmation(
  annonceId: string,
  dueAt?: string
): Promise<MissionWorkflowResult> {
  const snapshot = await fetchMissionWorkflowSnapshot(annonceId)
  if (!snapshot) return { ok: false, reason: 'not_found' }
  if (!canRequestPresenceConfirmation(snapshot)) return { ok: false, reason: 'invalid_status' }

  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from('annonces')
    .update({
      presence_confirmation_status: 'pending',
      presence_confirmation_sent_at: nowIso,
      presence_confirmation_due_at: dueAt ?? null,
    })
    .eq('id', annonceId)

  if (error) return { ok: false, reason: 'update_failed' }
  return { ok: true, changed: true }
}

export async function recordMissionPresenceConfirmation(
  annonceId: string,
  nextStatus: 'confirmed' | 'declined' | 'no_response'
): Promise<MissionWorkflowResult> {
  const snapshot = await fetchMissionWorkflowSnapshot(annonceId)
  if (!snapshot) return { ok: false, reason: 'not_found' }
  if (!['pending', 'not_requested'].includes(String(snapshot.presence_confirmation_status ?? 'not_requested'))) {
    if (String(snapshot.presence_confirmation_status ?? '').toLowerCase() === nextStatus) {
      return { ok: true, changed: false }
    }
    return { ok: false, reason: 'invalid_status' }
  }

  const { error } = await supabase
    .from('annonces')
    .update({
      presence_confirmation_status: nextStatus,
      presence_confirmation_responded_at: new Date().toISOString(),
    })
    .eq('id', annonceId)

  if (error) return { ok: false, reason: 'update_failed' }
  return { ok: true, changed: true }
}

export async function markMissionContractGenerated(
  annonceId: string
): Promise<MissionWorkflowResult> {
  const engagement = await fetchActiveEngagementForMission(annonceId)
  if (!engagement) return { ok: false, reason: 'invalid_status' }

  const snapshot = await fetchMissionWorkflowSnapshot(annonceId)
  if (!snapshot) return { ok: false, reason: 'not_found' }
  if (!canGenerateContract(snapshot)) {
    if (getMissionValidationSummary(snapshot).contractStatus === 'generated') {
      return { ok: true, changed: false }
    }
    return { ok: false, reason: 'invalid_status' }
  }

  const result = await createDraftContractForEngagement(engagement.id)
  if (!result.ok) {
    return { ok: false, reason: result.reason === 'schema_unavailable' ? 'blocked' : result.reason, message: result.message }
  }
  return { ok: true, changed: result.changed }
}

export async function signMissionContractByPatron(
  annonceId: string
): Promise<MissionWorkflowResult> {
  const engagement = await fetchActiveEngagementForMission(annonceId)
  if (!engagement) return { ok: false, reason: 'invalid_status' }

  const snapshot = await fetchMissionWorkflowSnapshot(annonceId)
  if (!snapshot) return { ok: false, reason: 'not_found' }
  if (!canSignContractByPatron(snapshot)) {
    if (
      ['signed_by_patron', 'fully_signed'].includes(
        getMissionValidationSummary(snapshot).contractStatus
      )
    ) {
      return { ok: true, changed: false }
    }
    return { ok: false, reason: 'invalid_status' }
  }

  const result = await signContractAsPatron(engagement.id)
  if (!result.ok) {
    return { ok: false, reason: result.reason === 'schema_unavailable' ? 'blocked' : result.reason, message: result.message }
  }
  return { ok: true, changed: result.changed }
}

export async function signMissionContractByServeur(
  annonceId: string
): Promise<MissionWorkflowResult> {
  const engagement = await fetchActiveEngagementForMission(annonceId)
  if (!engagement) return { ok: false, reason: 'invalid_status' }

  const snapshot = await fetchMissionWorkflowSnapshot(annonceId)
  if (!snapshot) return { ok: false, reason: 'not_found' }
  if (!canSignContractByServeur(snapshot)) {
    if (
      ['signed_by_server', 'fully_signed'].includes(
        getMissionValidationSummary(snapshot).contractStatus
      )
    ) {
      return { ok: true, changed: false }
    }
    return { ok: false, reason: 'invalid_status' }
  }

  const result = await signContractAsWorker(engagement.id)
  if (!result.ok) {
    return { ok: false, reason: result.reason === 'schema_unavailable' ? 'blocked' : result.reason, message: result.message }
  }
  return { ok: true, changed: result.changed }
}

export async function markMissionCheckIn(annonceId: string): Promise<MissionWorkflowResult> {
  const snapshot = await fetchMissionWorkflowSnapshot(annonceId)
  if (!snapshot) return { ok: false, reason: 'not_found' }
  const checkInBlockedMessage = getCheckInBlockMessage(snapshot)
  if (checkInBlockedMessage) {
    if (getMissionValidationSummary(snapshot).checkInStatus === 'checked_in') {
      return { ok: true, changed: false }
    }
    return { ok: false, reason: 'blocked', message: checkInBlockedMessage }
  }
  if (!canCheckInWithEngagement(snapshot.engagement_status)) {
    return { ok: false, reason: 'invalid_status' }
  }
  if (!canCheckInMission(snapshot)) {
    if (getMissionValidationSummary(snapshot).checkInStatus === 'checked_in') {
      return { ok: true, changed: false }
    }
    return { ok: false, reason: 'invalid_status' }
  }

  const nowIso = new Date().toISOString()

  const { error } = await supabase
    .from('annonces')
    .update({
      statut: 'in_progress',
      check_in_status: 'checked_in',
      checked_in_at: nowIso,
    })
    .eq('id', annonceId)

  if (error) return { ok: false, reason: 'update_failed' }
  const engagement = await fetchActiveEngagementForMission(annonceId)
  if (engagement) {
    await updateEngagementLifecycle(engagement.id, 'active', {
      checked_in_at: nowIso,
    })
  }
  return { ok: true, changed: true }
}

export async function markMissionDpaeDone(annonceId: string): Promise<MissionWorkflowResult> {
  const snapshot = await fetchMissionWorkflowSnapshot(annonceId)
  if (!snapshot) {
    logDpaeReturningError({
      stage: 'not_found',
      mission_id: annonceId,
      message: 'Mission introuvable pour la confirmation DPAE.',
    })
    return { ok: false, reason: 'not_found', message: 'Mission introuvable pour la confirmation DPAE.' }
  }
  const engagement = await fetchActiveEngagementForMission(annonceId)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const dpaePayload = (await buildMissionDpaePayload(annonceId)) ?? snapshot.dpae_payload_snapshot ?? null

  logDpaeDebug('preflight', {
    mission_id: annonceId,
    patron_id: user?.id ?? null,
    etablissement_id: snapshot.etablissement_id ?? null,
    serveur_id: engagement?.serveur_id ?? null,
    statut_mission: snapshot.statut ?? null,
    statut_dpae: snapshot.dpae_status ?? null,
    pre_requis: {
      has_engagement: Boolean(engagement),
      engagement_status: snapshot.engagement_status ?? null,
      agreement_confirmed: canCheckInWithEngagement(snapshot.engagement_status),
    },
    payload: dpaePayload,
  })

  if (!engagement) {
    logDpaeDebug('blocked:no_engagement', {
      mission_id: annonceId,
      patron_id: user?.id ?? null,
      etablissement_id: snapshot.etablissement_id ?? null,
      statut_dpae: snapshot.dpae_status ?? null,
      payload: dpaePayload,
    })
    logDpaeReturningError({
      stage: 'blocked:no_engagement',
      mission_id: annonceId,
      patron_id: user?.id ?? null,
      etablissement_id: snapshot.etablissement_id ?? null,
      statut_dpae: snapshot.dpae_status ?? null,
      payload: dpaePayload,
      message: 'La mission doit etre confirmee avant de finaliser la DPAE.',
    })
    return { ok: false, reason: 'invalid_status', message: 'La mission doit etre confirmee avant de finaliser la DPAE.' }
  }

  if (!canCheckInWithEngagement(snapshot.engagement_status)) {
    logDpaeDebug('blocked:invalid_status', {
      mission_id: annonceId,
      patron_id: user?.id ?? null,
      etablissement_id: snapshot.etablissement_id ?? null,
      statut_dpae: snapshot.dpae_status ?? null,
      engagement_status: snapshot.engagement_status ?? null,
      payload: dpaePayload,
    })
    logDpaeReturningError({
      stage: 'blocked:invalid_status',
      mission_id: annonceId,
      patron_id: user?.id ?? null,
      etablissement_id: snapshot.etablissement_id ?? null,
      statut_dpae: snapshot.dpae_status ?? null,
      engagement_status: snapshot.engagement_status ?? null,
      payload: dpaePayload,
      message: 'La mission doit etre confirmee avant de finaliser la DPAE.',
    })
    return { ok: false, reason: 'invalid_status', message: 'La mission doit etre confirmee avant de finaliser la DPAE.' }
  }

  try {
    if (!user || user.id !== engagement.patron_id) {
      logDpaeDebug('blocked:wrong_patron', {
        mission_id: annonceId,
        patron_id: user?.id ?? null,
        expected_patron_id: engagement.patron_id ?? null,
        etablissement_id: snapshot.etablissement_id ?? null,
        statut_dpae: snapshot.dpae_status ?? null,
        payload: dpaePayload,
      })
      logDpaeReturningError({
        stage: 'blocked:wrong_patron',
        mission_id: annonceId,
        patron_id: user?.id ?? null,
        expected_patron_id: engagement.patron_id ?? null,
        etablissement_id: snapshot.etablissement_id ?? null,
        statut_dpae: snapshot.dpae_status ?? null,
        payload: dpaePayload,
        message: 'Seul l employeur peut confirmer la DPAE.',
      })
      return { ok: false, reason: 'blocked', message: 'Seul l employeur peut confirmer la DPAE.' }
    }
    const dpaeTimestamp = new Date().toISOString()
    const dpaeRecord = await ensureDpaeRecordForMission(annonceId)

    if (dpaeRecord) {
      const { error: dpaeRecordError } = await supabase
        .from('dpae_records')
        .update({
          status: 'confirmed',
          confirmed_at: dpaeTimestamp,
          confirmed_by: user?.id ?? null,
        })
        .eq('mission_id', annonceId)

      if (dpaeRecordError && !isMissingDpaeRecordsSchemaError(dpaeRecordError)) {
        logDpaeDebug('error:dpae_records_update', {
          mission_id: annonceId,
          patron_id: user?.id ?? null,
          etablissement_id: snapshot.etablissement_id ?? null,
          statut_dpae: snapshot.dpae_status ?? null,
          pre_requis: {
            has_engagement: Boolean(engagement),
            engagement_status: snapshot.engagement_status ?? null,
            agreement_confirmed: canCheckInWithEngagement(snapshot.engagement_status),
          },
          payload: dpaePayload,
          error: getSupabaseErrorDebug(dpaeRecordError),
        })
        if (!isDpaeRecordsPermissionError(dpaeRecordError)) {
          const message = getReadableDpaeErrorMessage(dpaeRecordError, 'Impossible de confirmer la DPAE.')
          logDpaeReturningError({
            stage: 'error:dpae_records_update',
            mission_id: annonceId,
            patron_id: user?.id ?? null,
            etablissement_id: snapshot.etablissement_id ?? null,
            statut_dpae: snapshot.dpae_status ?? null,
            payload: dpaePayload,
            supabase: getSupabaseErrorDebug(dpaeRecordError),
            message,
          })
          return {
            ok: false,
            reason: 'update_failed',
            message,
          }
        }
      }
      if (isMissingDpaeRecordsSchemaError(dpaeRecordError)) {
        logMissionWorkflowSchemaDependency('dpae_records_update', 'La table dpae_records est absente, fallback legacy utilisé.', {
          annonceId,
        })
      }
    }

    logDpaeDebug('update:payload', {
      mission_id: annonceId,
      patron_id: user?.id ?? null,
      etablissement_id: snapshot.etablissement_id ?? null,
      table: 'annonces',
      where: { id: annonceId },
      update: {
        dpae_done: true,
        dpae_status: 'confirmed',
        dpae_done_at: dpaeTimestamp,
        dpae_done_by: user?.id ?? null,
      },
      payload: dpaePayload,
    })

    const { data: annonceUpdateData, error, status } = await supabase
      .from('annonces')
      .update({
        dpae_done: true,
        dpae_status: 'confirmed',
        dpae_done_at: dpaeTimestamp,
        dpae_done_by: user?.id ?? null,
        dpae_payload_snapshot: dpaePayload,
      })
      .eq('id', annonceId)

      .select('id, patron_id, etablissement_id, dpae_done, dpae_status, dpae_done_at, dpae_done_by')

    logDpaeDebug('update:result', {
      mission_id: annonceId,
      patron_id: user?.id ?? null,
      etablissement_id: snapshot.etablissement_id ?? null,
      table: 'annonces',
      where: { id: annonceId },
      status,
      rows_modified: Array.isArray(annonceUpdateData) ? annonceUpdateData.length : 0,
      data: annonceUpdateData ?? null,
      error: error ? getSupabaseErrorDebug(error) : null,
    })

    if (error) {
      if (isMissingDpaeAuditSchemaError(error)) {
        logMissionWorkflowSchemaDependency('dpae_audit_columns', 'Les colonnes d’audit DPAE sont absentes sur annonces, fallback minimal utilisé.', {
          annonceId,
        })
        const { error: fallbackError } = await supabase
          .from('annonces')
          .update({ dpae_done: true })
          .eq('id', annonceId)

        if (fallbackError) {
          logDpaeDebug('error:annonces_fallback_update', {
            mission_id: annonceId,
            patron_id: user?.id ?? null,
            etablissement_id: snapshot.etablissement_id ?? null,
            statut_dpae: snapshot.dpae_status ?? null,
            pre_requis: {
              has_engagement: Boolean(engagement),
              engagement_status: snapshot.engagement_status ?? null,
              agreement_confirmed: canCheckInWithEngagement(snapshot.engagement_status),
            },
            payload: dpaePayload,
            error: getSupabaseErrorDebug(fallbackError),
          })
          if (isMissingDpaeSchemaError(fallbackError)) {
            logDpaeReturningError({
              stage: 'blocked:missing_dpae_schema_fallback',
              mission_id: annonceId,
              patron_id: user?.id ?? null,
              etablissement_id: snapshot.etablissement_id ?? null,
              statut_dpae: snapshot.dpae_status ?? null,
              payload: dpaePayload,
              supabase: getSupabaseErrorDebug(fallbackError),
              message: 'Le champ DPAE doit etre ajoute en base avant de marquer cette etape comme faite.',
            })
            return { ok: false, reason: 'blocked', message: 'Le champ DPAE doit etre ajoute en base avant de marquer cette etape comme faite.' }
          }
          const message = getReadableDpaeErrorMessage(fallbackError, 'Impossible de confirmer la DPAE.')
          logDpaeReturningError({
            stage: 'error:annonces_fallback_update',
            mission_id: annonceId,
            patron_id: user?.id ?? null,
            etablissement_id: snapshot.etablissement_id ?? null,
            statut_dpae: snapshot.dpae_status ?? null,
            payload: dpaePayload,
            supabase: getSupabaseErrorDebug(fallbackError),
            message,
          })
          return {
            ok: false,
            reason: 'update_failed',
            message,
          }
        }

        return { ok: true, changed: true }
      }
      if (isMissingDpaeSchemaError(error)) {
        logDpaeReturningError({
          stage: 'blocked:missing_dpae_schema',
          mission_id: annonceId,
          patron_id: user?.id ?? null,
          etablissement_id: snapshot.etablissement_id ?? null,
          statut_dpae: snapshot.dpae_status ?? null,
          payload: dpaePayload,
          supabase: getSupabaseErrorDebug(error),
          message: 'Le champ DPAE doit etre ajoute en base avant de marquer cette etape comme faite.',
        })
        return { ok: false, reason: 'blocked', message: 'Le champ DPAE doit etre ajoute en base avant de marquer cette etape comme faite.' }
      }
      logDpaeDebug('error:annonces_update', {
        mission_id: annonceId,
        patron_id: user?.id ?? null,
        etablissement_id: snapshot.etablissement_id ?? null,
        statut_dpae: snapshot.dpae_status ?? null,
        pre_requis: {
          has_engagement: Boolean(engagement),
          engagement_status: snapshot.engagement_status ?? null,
          agreement_confirmed: canCheckInWithEngagement(snapshot.engagement_status),
        },
        payload: dpaePayload,
        error: getSupabaseErrorDebug(error),
      })
      const message = getReadableDpaeErrorMessage(error, 'Impossible de confirmer la DPAE.')
      logDpaeReturningError({
        stage: 'error:annonces_update',
        mission_id: annonceId,
        patron_id: user?.id ?? null,
        etablissement_id: snapshot.etablissement_id ?? null,
        statut_dpae: snapshot.dpae_status ?? null,
        payload: dpaePayload,
        supabase: getSupabaseErrorDebug(error),
        message,
      })
      return {
        ok: false,
        reason: 'update_failed',
        message,
      }
    }

    logDpaeDebug('success', {
      mission_id: annonceId,
      patron_id: user?.id ?? null,
      etablissement_id: snapshot.etablissement_id ?? null,
      statut_dpae: 'confirmed',
      pre_requis: {
        has_engagement: Boolean(engagement),
        engagement_status: snapshot.engagement_status ?? null,
        agreement_confirmed: canCheckInWithEngagement(snapshot.engagement_status),
      },
      payload: dpaePayload,
    })
    return { ok: true, changed: true }
  } catch (error) {
    logDpaeDebug('error:unexpected', {
      mission_id: annonceId,
      patron_id: user?.id ?? null,
      etablissement_id: snapshot.etablissement_id ?? null,
      statut_dpae: snapshot.dpae_status ?? null,
      pre_requis: {
        has_engagement: Boolean(engagement),
        engagement_status: snapshot.engagement_status ?? null,
        agreement_confirmed: canCheckInWithEngagement(snapshot.engagement_status),
      },
      payload: dpaePayload,
      error: getSupabaseErrorDebug(error),
    })
    if (isMissingDpaeAuditSchemaError(error)) {
      logDpaeReturningError({
        stage: 'blocked:missing_dpae_audit_schema',
        mission_id: annonceId,
        patron_id: user?.id ?? null,
        etablissement_id: snapshot.etablissement_id ?? null,
        statut_dpae: snapshot.dpae_status ?? null,
        payload: dpaePayload,
        supabase: getSupabaseErrorDebug(error),
        message: 'Les champs de tracabilite DPAE doivent etre ajoutes en base avant de confirmer cette etape.',
      })
      return { ok: false, reason: 'blocked', message: 'Les champs de tracabilite DPAE doivent etre ajoutes en base avant de confirmer cette etape.' }
    }
    if (isMissingDpaeSchemaError(error)) {
      logDpaeReturningError({
        stage: 'blocked:missing_dpae_schema_exception',
        mission_id: annonceId,
        patron_id: user?.id ?? null,
        etablissement_id: snapshot.etablissement_id ?? null,
        statut_dpae: snapshot.dpae_status ?? null,
        payload: dpaePayload,
        supabase: getSupabaseErrorDebug(error),
        message: 'Le champ DPAE doit etre ajoute en base avant de marquer cette etape comme faite.',
      })
      return { ok: false, reason: 'blocked', message: 'Le champ DPAE doit etre ajoute en base avant de marquer cette etape comme faite.' }
    }
    const message = getReadableDpaeErrorMessage(error, 'Impossible de confirmer la DPAE.')
    logDpaeReturningError({
      stage: 'error:unexpected',
      mission_id: annonceId,
      patron_id: user?.id ?? null,
      etablissement_id: snapshot.etablissement_id ?? null,
      statut_dpae: snapshot.dpae_status ?? null,
      payload: dpaePayload,
      supabase: getSupabaseErrorDebug(error),
      message,
    })
    return {
      ok: false,
      reason: 'update_failed',
      message,
    }
  }
}

export async function finalizeMissionActivation(annonceId: string): Promise<MissionWorkflowResult> {
  const snapshot = await fetchMissionWorkflowSnapshot(annonceId)
  if (!snapshot) return { ok: false, reason: 'not_found' }

  const engagement = await fetchActiveEngagementForMission(annonceId)
  if (!engagement) {
    return { ok: false, reason: 'invalid_status', message: 'La mission doit avoir un engagement actif avant finalisation.' }
  }

  if (!canCheckInWithEngagement(snapshot.engagement_status)) {
    return { ok: false, reason: 'invalid_status', message: 'La mission doit etre confirmee avant finalisation.' }
  }

  const contractDraft = await createDraftContractForEngagement(engagement.id)
  if (!contractDraft.ok) {
    return { ok: false, reason: contractDraft.reason === 'schema_unavailable' ? 'blocked' : contractDraft.reason, message: contractDraft.message }
  }

  const dpaePayload = await buildMissionDpaePayload(annonceId)
  const { error: activationError } = await supabase
    .from('engagements')
    .update({
      contract_status: 'generated',
    })
    .eq('id', engagement.id)

  if (activationError) {
    return { ok: false, reason: 'update_failed', message: 'Impossible de finaliser la mission pour le moment.' }
  }

  const { error: dpaePrepareError } = await supabase
    .from('annonces')
    .update({
      dpae_status: 'prepared',
      dpae_payload_snapshot: dpaePayload,
    })
    .eq('id', annonceId)

  if (dpaePrepareError && !isMissingDpaeAuditSchemaError(dpaePrepareError)) {
    return { ok: false, reason: 'update_failed', message: 'Impossible de preparer la DPAE pour le moment.' }
  }

  return { ok: true, changed: true }
}

export async function markMissionCheckOut(annonceId: string): Promise<MissionWorkflowResult> {
  const snapshot = await fetchMissionWorkflowSnapshot(annonceId)
  if (!snapshot) return { ok: false, reason: 'not_found' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return { ok: false, reason: 'invalid_status' }
  const checkOutBlockedMessage = getCheckOutBlockMessage(snapshot)
  if (checkOutBlockedMessage) {
    if (getMissionValidationSummary(snapshot).checkInStatus === 'checked_out') {
      return { ok: true, changed: false, stage: 'confirmed' }
    }
    return { ok: false, reason: 'blocked', message: checkOutBlockedMessage }
  }
  if (!canCheckOutMission(snapshot)) {
    if (getMissionValidationSummary(snapshot).checkInStatus === 'checked_out') {
      return { ok: true, changed: false, stage: 'confirmed' }
    }
    return { ok: false, reason: 'invalid_status' }
  }

  const nowIso = new Date().toISOString()
  const requestedBy = snapshot.check_out_requested_by ?? null

  if (!requestedBy) {
    const { error } = await supabase
      .from('annonces')
      .update({
        check_out_requested_by: user.id,
        check_out_requested_at: nowIso,
        check_out_confirmed_at: null,
      })
      .eq('id', annonceId)

    if (error) return { ok: false, reason: 'update_failed' }
    return { ok: true, changed: true, stage: 'pending_confirmation' }
  }

  if (requestedBy === user.id) {
    return { ok: true, changed: false, stage: 'pending_confirmation' }
  }

  const { error } = await supabase
    .from('annonces')
    .update({
      statut: 'completed',
      check_in_status: 'checked_out',
      check_out_confirmed_at: nowIso,
      checked_out_at: nowIso,
    })
    .eq('id', annonceId)

  if (error) return { ok: false, reason: 'update_failed' }
  const engagement = await fetchActiveEngagementForMission(annonceId)
  if (engagement) {
    await updateEngagementLifecycle(engagement.id, 'completed', {
      checked_out_at: nowIso,
      completed_at: nowIso,
    })
  }
  await captureMissionPaymentIfNeeded(annonceId)
  return { ok: true, changed: true, stage: 'confirmed' }
}

export async function openMissionDispute(
  annonceId: string,
  disputeReason: string
): Promise<MissionWorkflowResult> {
  const snapshot = await fetchMissionWorkflowSnapshot(annonceId)
  if (!snapshot) return { ok: false, reason: 'not_found' }

  const summary = getMissionValidationSummary(snapshot)
  if (summary.workflowStage === 'dispute') {
    return { ok: true, changed: false }
  }

  const { error } = await supabase
    .from('annonces')
    .update({
      statut: 'dispute',
      payment_status: 'blocked',
      payment_blocked_at: new Date().toISOString(),
      dispute_reason: disputeReason,
      dispute_created_at: new Date().toISOString(),
    })
    .eq('id', annonceId)

  if (error) return { ok: false, reason: 'update_failed' }
  const engagement = await fetchActiveEngagementForMission(annonceId)
  if (engagement) {
    await cancelEngagement(engagement.id, 'dispute_opened')
  }
  return { ok: true, changed: true }
}

export async function openUrgentMissionReplacement(
  annonceId: string
): Promise<{ ok: true; replacedEngagementId: string | null } | { ok: false; reason: 'not_found' | 'invalid_status' | 'update_failed' | 'blocked'; message?: string }> {
  const annonce = await fetchMissionWorkflowSnapshot(annonceId)
  if (!annonce) return { ok: false, reason: 'not_found' }

  const replacementBlockedMessage = getUrgentReplacementBlockMessage(annonce)
  if (replacementBlockedMessage) {
    return { ok: false, reason: 'blocked', message: replacementBlockedMessage }
  }

  const engagement = await fetchActiveEngagementForMission(annonceId)
  if (!engagement) return { ok: false, reason: 'invalid_status' }

  const cancelled = await cancelEngagement(engagement.id, 'urgent_replacement')
  if (!cancelled) return { ok: false, reason: 'update_failed' }

  const { error } = await supabase
    .from('annonces')
    .update({
      statut: 'open',
      serveur_id: null,
      presence_confirmation_status: 'not_requested',
      presence_confirmation_sent_at: null,
      presence_confirmation_due_at: null,
      presence_confirmation_responded_at: null,
      contract_status: 'not_generated',
      contract_generated_at: null,
      contract_signed_by_patron_at: null,
      contract_signed_by_server_at: null,
      payment_status: 'not_authorized',
      payment_authorized_at: null,
      payment_released_at: null,
      payment_blocked_at: null,
      check_in_status: 'not_checked_in',
      checked_in_at: null,
      checked_out_at: null,
      check_out_requested_by: null,
      check_out_requested_at: null,
      check_out_confirmed_at: null,
      dispute_reason: null,
      dispute_created_at: null,
      cancelled_at: null,
    })
    .eq('id', annonceId)

  if (error) return { ok: false, reason: 'update_failed' }
  await supabase
    .from('annonces')
    .update({ dpae_done: false })
    .eq('id', annonceId)
  await resetMissionDpaeRecord(annonceId)
  return { ok: true, replacedEngagementId: engagement.id }
}
