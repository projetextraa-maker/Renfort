import { canConfirmMissionWithEngagement, normalizeEngagementStatus } from './engagements'
import { getMissionTimeRange, normalizeMissionStatus, parseMissionDateTime, type CanonicalMissionStatus } from './missions'

export const PRESENCE_CONFIRMATION_STATUSES = [
  'not_requested',
  'pending',
  'confirmed',
  'declined',
  'no_response',
] as const

export const CONTRACT_STATUSES = [
  'not_generated',
  'generated',
  'signed_by_patron',
  'signed_by_server',
  'fully_signed',
] as const

export const PAYMENT_STATUSES = [
  'not_authorized',
  'authorized_hold',
  'captured',
  'capture_failed',
  'released',
  'blocked',
  'refunded',
] as const

export const CHECK_IN_STATUSES = [
  'not_checked_in',
  'checked_in',
  'checked_out',
] as const

export type PresenceConfirmationStatus = (typeof PRESENCE_CONFIRMATION_STATUSES)[number]
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
export type CheckInStatus = (typeof CHECK_IN_STATUSES)[number]

export type MissionWorkflowStage =
  | 'proposed'
  | 'selected'
  | 'reconfirmation_requested'
  | 'reconfirmed'
  | 'contract_generated'
  | 'contract_signed_by_patron'
  | 'contract_signed_by_worker'
  | 'mission_confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'completed'
  | 'no_show'
  | 'cancelled'
  | 'dispute'
  | 'expired'
  | 'unknown'

export type MissionValidationSnapshot = {
  statut?: string | null
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
  date?: string | null
  heure_debut?: string | null
  heure_fin?: string | null
  engagement_checked_in_at?: string | null
  engagement_checked_out_at?: string | null
}

export type MissionContractualizationState =
  | 'not_selected'
  | 'pending_validation'
  | 'mission_confirmed'

export type MissionOperationalState =
  | 'waiting_validation'
  | 'mission_confirmed'
  | 'administrative_pending'
  | 'ready_for_check_in'
  | 'in_progress'
  | 'completed'

export type MissionStatusValue =
  | 'pending'
  | 'confirmed'
  | 'admin_pending'
  | 'ready'
  | 'active'
  | 'completed'
  | 'cancelled'

export type MissionCheckInBlocker =
  | 'mission_not_confirmed'
  | 'contract_patron_signature_missing'
  | 'contract_worker_signature_missing'
  | 'dpae_not_confirmed'

function formatMissionMoment(dateValue: string | null | undefined, timeValue: string | null | undefined): string {
  const date = parseMissionDateTime(dateValue, timeValue)
  if (!date) return String(timeValue ?? '')
  return date.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function normalizePresenceConfirmationStatus(
  value: string | null | undefined
): PresenceConfirmationStatus {
  const normalized = String(value ?? '').toLowerCase()
  if (
    normalized === 'pending' ||
    normalized === 'confirmed' ||
    normalized === 'declined' ||
    normalized === 'no_response'
  ) {
    return normalized
  }
  return 'not_requested'
}

export function normalizeContractStatus(value: string | null | undefined): ContractStatus {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'draft' || normalized === 'pending_patron_signature') {
    return 'generated'
  }
  if (normalized === 'pending_worker_signature') {
    return 'signed_by_patron'
  }
  if (normalized === 'signed') {
    return 'fully_signed'
  }
  if (
    normalized === 'generated' ||
    normalized === 'signed_by_patron' ||
    normalized === 'signed_by_server' ||
    normalized === 'fully_signed'
  ) {
    return normalized
  }
  return 'not_generated'
}

export function normalizePaymentStatus(value: string | null | undefined): PaymentStatus {
  const normalized = String(value ?? '').toLowerCase()
  if (
    normalized === 'authorized_hold' ||
    normalized === 'captured' ||
    normalized === 'capture_failed' ||
    normalized === 'released' ||
    normalized === 'blocked' ||
    normalized === 'refunded'
  ) {
    return normalized
  }
  return 'not_authorized'
}

export function normalizeCheckInStatus(value: string | null | undefined): CheckInStatus {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'checked_in' || normalized === 'checked_out') {
    return normalized
  }
  return 'not_checked_in'
}

export function isMissionAgreementConfirmed(snapshot: MissionValidationSnapshot): boolean {
  const statut = normalizeMissionStatus(snapshot.statut)
  const engagement = normalizeEngagementStatus(snapshot.engagement_status)

  return (
    (statut === 'confirmed' || statut === 'in_progress' || statut === 'completed') &&
    canConfirmMissionWithEngagement(engagement)
  )
}

export function isMissionContractualized(snapshot: MissionValidationSnapshot): boolean {
  return isMissionAgreementConfirmed(snapshot)
}

export function isMissionContractGenerated(snapshot: MissionValidationSnapshot): boolean {
  return normalizeContractStatus(snapshot.contract_status) !== 'not_generated'
}

export function isMissionContractFullySigned(snapshot: MissionValidationSnapshot): boolean {
  return normalizeContractStatus(snapshot.contract_status) === 'fully_signed'
}

export function isMissionDpaeDone(snapshot: MissionValidationSnapshot): boolean {
  return snapshot.dpae_done === true
}

export function normalizeDpaeStatus(value: string | null | undefined): 'not_started' | 'prepared' | 'confirmed' {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'prepared' || normalized === 'confirmed') return normalized
  return 'not_started'
}

export function isMissionDpaePrepared(snapshot: MissionValidationSnapshot): boolean {
  const dpaeStatus = normalizeDpaeStatus(snapshot.dpae_status)
  if (dpaeStatus === 'prepared' || dpaeStatus === 'confirmed') return true
  return isMissionAgreementConfirmed(snapshot)
}

export function isMissionDpaeConfirmed(snapshot: MissionValidationSnapshot): boolean {
  return isMissionDpaeDone(snapshot) || normalizeDpaeStatus(snapshot.dpae_status) === 'confirmed'
}

export function canStartMissionWithDpae(snapshot: MissionValidationSnapshot): boolean {
  return isMissionDpaeConfirmed(snapshot)
}

export function getMissionContractualizationState(
  snapshot: MissionValidationSnapshot
): MissionContractualizationState {
  const statut = normalizeMissionStatus(snapshot.statut)

  if (statut === 'open' || !snapshot.engagement_status) return 'not_selected'
  if (isMissionAgreementConfirmed(snapshot)) return 'mission_confirmed'
  return 'pending_validation'
}

export function getMissionContractualizationBlockers(
  snapshot: MissionValidationSnapshot
): string[] {
  const blockers: string[] = []
  const missionStatus = normalizeMissionStatus(snapshot.statut)
  const engagement = normalizeEngagementStatus(snapshot.engagement_status)

  if (!snapshot.engagement_status || missionStatus === 'open') {
    blockers.push('Validation patron / serveur en attente pour cette mission.')
    return blockers
  }

  if (missionStatus === 'cancelled_by_patron' || missionStatus === 'cancelled_by_server') {
    blockers.push('La mission a ete annulee.')
    return blockers
  }

  if (missionStatus === 'expired') {
    blockers.push('La mission a expire.')
    return blockers
  }

  if (engagement === 'draft' || engagement === 'pending_signature') {
    blockers.push('La validation definitive entre le patron et le serveur est encore en attente.')
  }

  return blockers
}

export function getMissionAdministrativeBlockers(
  snapshot: MissionValidationSnapshot
): string[] {
  const blockers: string[] = []
  const contract = normalizeContractStatus(snapshot.contract_status)
  const payment = normalizePaymentStatus(snapshot.payment_status)

  if (contract === 'not_generated') {
    blockers.push('Le contrat CHR doit encore etre genere pour cette mission.')
  } else if (contract === 'generated') {
    blockers.push('Le contrat attend la signature du patron.')
  } else if (contract === 'signed_by_patron') {
    blockers.push('Le contrat attend la signature du serveur.')
  } else if (contract === 'signed_by_server') {
    blockers.push('Le contrat attend encore la contre-signature finale du patron.')
  }

  if (!isMissionDpaeConfirmed(snapshot)) {
    blockers.push('Declaration URSSAF a finaliser avant le debut de mission.')
  }

  if (payment === 'blocked') {
    blockers.push('Le paiement est actuellement bloque.')
  }

  if (payment === 'capture_failed') {
    blockers.push('La capture du paiement a echoue et doit etre reprise.')
  }

  return blockers
}

export function getMissionPresenceReadinessMessage(
  snapshot: MissionValidationSnapshot
): string | null {
  const presence = normalizePresenceConfirmationStatus(snapshot.presence_confirmation_status)

  switch (presence) {
    case 'pending':
      return 'La reconfirmation de disponibilite est en attente du serveur.'
    case 'confirmed':
      return 'La disponibilite a bien ete reconfirmee avant la mission.'
    case 'declined':
      return "Le serveur a signale qu'il n'etait plus disponible."
    case 'no_response':
      return "Le serveur n'a pas encore repondu a la reconfirmation."
    case 'not_requested':
    default:
      return 'La reconfirmation de disponibilite sera a envoyer avant la prise de poste.'
  }
}

export function getMissionWorkflowStage(snapshot: MissionValidationSnapshot): MissionWorkflowStage {
  const statut = normalizeMissionStatus(snapshot.statut)
  const presence = normalizePresenceConfirmationStatus(snapshot.presence_confirmation_status)
  const contract = normalizeContractStatus(snapshot.contract_status)
  const checkIn = normalizeCheckInStatus(snapshot.check_in_status)

  if (statut === 'dispute') return 'dispute'
  if (statut === 'completed') return 'completed'
  if (statut === 'no_show') return 'no_show'
  if (statut === 'expired') return 'expired'
  if (statut === 'cancelled_by_patron' || statut === 'cancelled_by_server') return 'cancelled'
  if (statut === 'open') return 'proposed'
  if (statut !== 'confirmed' && statut !== 'in_progress') return 'unknown'

  if (checkIn === 'checked_out') return 'checked_out'
  if (checkIn === 'checked_in' || statut === 'in_progress') return 'checked_in'
  if (isMissionAgreementConfirmed(snapshot)) return 'mission_confirmed'
  if (contract === 'generated') return 'contract_generated'
  if (contract === 'signed_by_patron') return 'contract_signed_by_patron'
  if (contract === 'signed_by_server') return 'contract_signed_by_worker'
  if (presence === 'pending') return 'reconfirmation_requested'
  if (presence === 'confirmed' && contract === 'not_generated') return 'reconfirmed'
  if (presence === 'declined' || presence === 'no_response') return 'selected'
  return 'selected'
}

export function canRequestPresenceConfirmation(snapshot: MissionValidationSnapshot): boolean {
  return (
    normalizeMissionStatus(snapshot.statut) === 'confirmed' &&
    isMissionAgreementConfirmed(snapshot) &&
    ['not_requested', 'pending'].includes(normalizePresenceConfirmationStatus(snapshot.presence_confirmation_status))
  )
}

export function canGenerateContract(snapshot: MissionValidationSnapshot): boolean {
  return (
    normalizeMissionStatus(snapshot.statut) === 'confirmed' &&
    normalizeContractStatus(snapshot.contract_status) === 'not_generated'
  )
}

export function canSignContractByPatron(snapshot: MissionValidationSnapshot): boolean {
  return ['generated', 'signed_by_server'].includes(normalizeContractStatus(snapshot.contract_status))
}

export function canSignContractByServeur(snapshot: MissionValidationSnapshot): boolean {
  return ['generated', 'signed_by_patron'].includes(normalizeContractStatus(snapshot.contract_status))
}

export function getCheckInBlockers(snapshot: MissionValidationSnapshot): MissionCheckInBlocker[] {
  const blockers: MissionCheckInBlocker[] = []
  const contractStatus = normalizeContractStatus(snapshot.contract_status)

  if (!isMissionAgreementConfirmed(snapshot)) {
    blockers.push('mission_not_confirmed')
    return blockers
  }

  if (contractStatus === 'not_generated' || contractStatus === 'generated') {
    blockers.push('contract_patron_signature_missing')
  }

  if (contractStatus === 'not_generated' || contractStatus === 'generated' || contractStatus === 'signed_by_patron') {
    blockers.push('contract_worker_signature_missing')
  }

  if (!isMissionDpaeConfirmed(snapshot)) {
    blockers.push('dpae_not_confirmed')
  }

  return [...new Set(blockers)]
}

export function canCheckInMission(snapshot: MissionValidationSnapshot): boolean {
  return (
    getCheckInBlockers(snapshot).length === 0 &&
    normalizeCheckInStatus(snapshot.check_in_status) === 'not_checked_in'
  )
}

export function canCheckOutMission(snapshot: MissionValidationSnapshot): boolean {
  return normalizeCheckInStatus(snapshot.check_in_status) === 'checked_in'
}

export function canCompleteMission(snapshot: MissionValidationSnapshot): boolean {
  const status = normalizeMissionStatus(snapshot.statut)
  const checkIn = normalizeCheckInStatus(snapshot.check_in_status)
  return (status === 'in_progress' || status === 'confirmed') && (checkIn === 'checked_in' || checkIn === 'checked_out')
}

export function canMarkMissionNoShow(snapshot: MissionValidationSnapshot): boolean {
  const status = normalizeMissionStatus(snapshot.statut)
  const checkIn = normalizeCheckInStatus(snapshot.check_in_status)
  return (status === 'confirmed' || status === 'in_progress') && checkIn === 'not_checked_in'
}

export function getMissionLifecycleIssues(snapshot: MissionValidationSnapshot): string[] {
  const issues: string[] = []
  const missionStatus = normalizeMissionStatus(snapshot.statut)
  const checkInStatus = normalizeCheckInStatus(snapshot.check_in_status)
  const paymentStatus = normalizePaymentStatus(snapshot.payment_status)
  const engagementStatus = normalizeEngagementStatus(snapshot.engagement_status)

  if (missionStatus === 'completed' && checkInStatus === 'not_checked_in') {
    issues.push('Mission terminee sans check-in')
  }

  if (missionStatus === 'no_show' && checkInStatus !== 'not_checked_in') {
    issues.push('No-show incoherent apres check-in')
  }

  if (missionStatus === 'in_progress' && !isMissionAgreementConfirmed(snapshot)) {
    issues.push('Mission en cours sans engagement confirme')
  }

  if (missionStatus === 'in_progress' && !isMissionContractFullySigned(snapshot)) {
    issues.push('Mission demarree sans contrat signe des deux cotes')
  }

  if (missionStatus === 'confirmed' && engagementStatus === 'draft') {
    issues.push('Mission selectionnee encore en attente de validation finale')
  }

  if ((paymentStatus === 'released' || paymentStatus === 'captured') && missionStatus !== 'completed') {
    issues.push('Paiement libere avant fin de mission')
  }

  if (paymentStatus === 'capture_failed') {
    issues.push('La capture du paiement a echoue apres la fin de mission')
  }

  if (missionStatus === 'in_progress' && !isMissionDpaeConfirmed(snapshot)) {
    issues.push('Mission demarree alors que la declaration URSSAF n est pas marquee comme faite')
  }

  return issues
}

export function getCheckInBlockMessage(
  snapshot: MissionValidationSnapshot,
  now: Date = new Date()
): string | null {
  const missionStatus = normalizeMissionStatus(snapshot.statut)
  const engagementStatus = normalizeEngagementStatus(snapshot.engagement_status)
  const checkInStatus = normalizeCheckInStatus(snapshot.check_in_status)

  if (checkInStatus === 'checked_in' || snapshot.engagement_checked_in_at) {
    return 'Le check-in a deja ete effectue pour cette mission.'
  }

  if (checkInStatus === 'checked_out' || snapshot.engagement_checked_out_at) {
    return 'Le check-in est impossible car le check-out a deja ete enregistre.'
  }

  if (missionStatus === 'completed') return 'La mission est deja terminee.'
  if (missionStatus === 'no_show') return 'La mission est deja classee en absence.'
  if (missionStatus === 'cancelled_by_patron' || missionStatus === 'cancelled_by_server') {
    return 'La mission est annulee.'
  }
  if (missionStatus === 'dispute') return 'Le check-in est bloque car la mission est en litige.'
  if (missionStatus === 'expired') return 'La mission a expire.'

  if (engagementStatus === 'draft' || engagementStatus === 'pending_signature') {
    return 'Validation patron / serveur a finaliser avant le debut de mission.'
  }

  const blockers = getCheckInBlockers(snapshot)
  if (blockers.includes('mission_not_confirmed')) {
    return 'Validation patron / serveur a finaliser avant le debut de mission.'
  }
  if (blockers.includes('contract_patron_signature_missing') && blockers.includes('contract_worker_signature_missing')) {
    return 'Le contrat doit etre signe par l employeur puis par le serveur avant le debut de mission.'
  }
  if (blockers.includes('contract_patron_signature_missing')) {
    return 'La signature employeur est requise avant le debut de mission.'
  }
  if (blockers.includes('contract_worker_signature_missing')) {
    return 'La signature du serveur est requise avant le debut de mission.'
  }
  if (blockers.includes('dpae_not_confirmed')) {
    return 'Declaration URSSAF a finaliser avant le debut de mission.'
  }

  const missionStart = parseMissionDateTime(snapshot.date, snapshot.heure_debut)
  if (missionStart && now.getTime() < missionStart.getTime()) {
    return `Le check-in sera disponible a partir du ${formatMissionMoment(snapshot.date, snapshot.heure_debut)}.`
  }

  return null
}

export function getCheckOutBlockMessage(
  snapshot: MissionValidationSnapshot,
  now: Date = new Date()
): string | null {
  void now
  const missionStatus = normalizeMissionStatus(snapshot.statut)
  const checkInStatus = normalizeCheckInStatus(snapshot.check_in_status)

  if (checkInStatus === 'checked_out' || snapshot.engagement_checked_out_at || missionStatus === 'completed') {
    return 'Le check-out a deja ete effectue pour cette mission.'
  }

  if (checkInStatus !== 'checked_in' && !snapshot.engagement_checked_in_at && missionStatus !== 'in_progress') {
    return 'Le check-out est impossible tant que le check-in n a pas ete effectue.'
  }

  return null
}

export function getUrgentReplacementBlockMessage(snapshot: MissionValidationSnapshot): string | null {
  const missionStatus = normalizeMissionStatus(snapshot.statut)
  const engagementStatus = normalizeEngagementStatus(snapshot.engagement_status)

  if (missionStatus === 'completed' || missionStatus === 'no_show') {
    return 'Le remplacement urgent est inutile car la mission est deja cloturee.'
  }

  if (missionStatus === 'cancelled_by_patron' || missionStatus === 'cancelled_by_server' || missionStatus === 'expired') {
    return 'Le remplacement urgent est impossible sur une mission deja fermee.'
  }

  if (engagementStatus === 'cancelled' || engagementStatus === 'completed') {
    return 'Le remplacement urgent est impossible car aucun engagement actif ne reste sur cette mission.'
  }

  if (engagementStatus !== 'draft' && engagementStatus !== 'pending_signature' && engagementStatus !== 'confirmed' && engagementStatus !== 'active') {
    return 'Le remplacement urgent est indisponible tant qu aucun engagement actif n est rattache a la mission.'
  }

  return null
}

export function getMissionOperationalState(
  snapshot: MissionValidationSnapshot
): MissionOperationalState {
  const missionStatus = normalizeMissionStatus(snapshot.statut)
  const checkInStatus = normalizeCheckInStatus(snapshot.check_in_status)
  const agreementConfirmed = isMissionAgreementConfirmed(snapshot)

  if (missionStatus === 'completed' || checkInStatus === 'checked_out') return 'completed'
  if (missionStatus === 'in_progress' || checkInStatus === 'checked_in') return 'in_progress'
  if (!agreementConfirmed) return 'waiting_validation'
  if (!isMissionContractFullySigned(snapshot) || !isMissionDpaeConfirmed(snapshot)) return 'administrative_pending'
  if (isMissionContractFullySigned(snapshot) && isMissionDpaeConfirmed(snapshot)) return 'ready_for_check_in'
  return 'mission_confirmed'
}

export function getMissionOperationalLabel(snapshot: MissionValidationSnapshot): string {
  switch (getMissionOperationalState(snapshot)) {
    case 'waiting_validation':
      return 'Confirmée'
    case 'mission_confirmed':
      return 'Confirmée'
    case 'administrative_pending':
      return 'Confirmée'
    case 'ready_for_check_in':
      return 'Confirmée'
    case 'in_progress':
      return 'En cours'
    case 'completed':
      return 'Terminée'
    default:
      return 'Confirmée'
  }
}

export function getMissionStatusValue(snapshot: MissionValidationSnapshot): MissionStatusValue {
  const missionStatus = normalizeMissionStatus(snapshot.statut)
  const operational = getMissionOperationalState(snapshot)

  if (
    missionStatus === 'cancelled_by_patron' ||
    missionStatus === 'cancelled_by_server' ||
    missionStatus === 'expired' ||
    missionStatus === 'no_show' ||
    missionStatus === 'dispute'
  ) {
    return 'cancelled'
  }

  switch (operational) {
    case 'waiting_validation':
      return 'pending'
    case 'mission_confirmed':
      return 'confirmed'
    case 'administrative_pending':
      return 'admin_pending'
    case 'ready_for_check_in':
      return 'ready'
    case 'in_progress':
      return 'active'
    case 'completed':
      return 'completed'
    default:
      return 'confirmed'
  }
}

export function getMissionStatusLabel(snapshot: MissionValidationSnapshot): string {
  switch (getMissionStatusValue(snapshot)) {
    case 'pending':
      return 'En attente'
    case 'confirmed':
      return 'Confirmée'
    case 'admin_pending':
      return 'Confirmée'
    case 'ready':
      return 'Confirmée'
    case 'active':
      return 'En cours'
    case 'completed':
      return 'Terminée'
    case 'cancelled':
      return 'Annulée'
    default:
      return 'Confirmée'
  }
}

export function getMissionContractDisplayLabel(snapshot: MissionValidationSnapshot): string {
  const contractStatus = normalizeContractStatus(snapshot.contract_status)

  if (!isMissionAgreementConfirmed(snapshot)) {
    return 'À générer'
  }

  switch (contractStatus) {
    case 'not_generated':
      return 'À générer'
    case 'generated':
      return 'À signer'
    case 'signed_by_patron':
      return 'À signer'
    case 'signed_by_server':
      return 'À signer'
    case 'fully_signed':
      return 'Contrat signé'
    default:
      return 'À signer'
  }
}

export function getMissionValidationSummary(snapshot: MissionValidationSnapshot) {
  const presenceConfirmationStatus = normalizePresenceConfirmationStatus(snapshot.presence_confirmation_status)
  const contractStatus = normalizeContractStatus(snapshot.contract_status)
  const paymentStatus = normalizePaymentStatus(snapshot.payment_status)
  const checkInStatus = normalizeCheckInStatus(snapshot.check_in_status)
  const engagementStatus = normalizeEngagementStatus(snapshot.engagement_status)
  const agreementConfirmed = isMissionAgreementConfirmed(snapshot)

  return {
    missionStatus: normalizeMissionStatus(snapshot.statut) as CanonicalMissionStatus | 'unknown',
    missionStatusValue: getMissionStatusValue(snapshot),
    missionStatusLabel: getMissionStatusLabel(snapshot),
    presenceConfirmationStatus,
    contractStatus,
    contractDisplayLabel: getMissionContractDisplayLabel(snapshot),
    paymentStatus,
    checkInStatus,
    engagementStatus,
    dpaeDone: isMissionDpaeConfirmed(snapshot),
    dpaeStatus: normalizeDpaeStatus(snapshot.dpae_status),
    workflowStage: getMissionWorkflowStage(snapshot),
    isContractualized: agreementConfirmed,
    isAgreementConfirmed: agreementConfirmed,
    operationalState: getMissionOperationalState(snapshot),
    operationalLabel: getMissionOperationalLabel(snapshot),
    contractualizationState: getMissionContractualizationState(snapshot),
    contractualizationBlockers: getMissionContractualizationBlockers(snapshot),
    administrativeBlockers: getMissionAdministrativeBlockers(snapshot),
    checkInBlockers: getCheckInBlockers(snapshot),
    isReadyForCheckIn: canCheckInMission(snapshot),
    presenceMessage: getMissionPresenceReadinessMessage(snapshot),
    isPresenceConfirmed: presenceConfirmationStatus === 'confirmed',
  }
}
