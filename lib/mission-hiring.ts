import { getMissionValidationSummary, type MissionValidationSnapshot } from './mission-validation'
import { normalizeMissionStatus } from './missions'

export const MISSION_APPLICATION_STATUSES = [
  'pending',
  'selected',
  'declined',
  'expired',
  'cancelled',
] as const

export type MissionApplicationStatus = (typeof MISSION_APPLICATION_STATUSES)[number]

export type MissionApplicationSnapshot = {
  statut?: string | null
  initiateur?: string | null
}

export type WorkerMatchingSnapshot = {
  disponible?: boolean | null
  prenom?: string | null
  nom?: string | null
  ville?: string | null
  lat?: number | null
  lng?: number | null
  suspended?: boolean | null
  suspendu?: boolean | null
  is_suspended?: boolean | null
  profil_complet?: boolean | null
  profile_complete?: boolean | null
  is_profile_complete?: boolean | null
}

export function normalizeMissionApplicationStatus(
  statut: string | null | undefined
): MissionApplicationStatus {
  const normalized = String(statut ?? '').toLowerCase()

  switch (normalized) {
    case 'acceptee':
    case 'selected':
      return 'selected'
    case 'refusee':
    case 'declined':
      return 'declined'
    case 'expiree':
    case 'expired':
      return 'expired'
    case 'annulee':
    case 'cancelled':
      return 'cancelled'
    case 'en_attente':
    case 'pending':
    default:
      return 'pending'
  }
}

export function getWorkerInterestLabel(snapshot: MissionApplicationSnapshot): string {
  const status = normalizeMissionApplicationStatus(snapshot.statut)
  const initiateur = String(snapshot.initiateur ?? '').toLowerCase()

  if (initiateur === 'patron') {
    if (status === 'selected') return 'Retenue'
    if (status === 'pending') return 'Proposée'
  } else {
    if (status === 'selected') return 'Retenue'
    if (status === 'pending') return 'Candidature envoyée'
  }

  if (status === 'declined') return 'Refusée'
  if (status === 'expired') return 'Expirée'
  if (status === 'cancelled') return 'Annulée'
  return 'Proposée'
}

export function getPatronApplicationLabel(snapshot: MissionApplicationSnapshot): string {
  const status = normalizeMissionApplicationStatus(snapshot.statut)
  if (status === 'selected') return 'Retenue'
  if (status === 'declined') return 'Refusée'
  if (status === 'expired') return 'Expirée'
  if (status === 'cancelled') return 'Annulée'
  return 'Proposée'
}

export function isWorkerEligibleForMatching(worker: WorkerMatchingSnapshot): boolean {
  const isSuspended = Boolean(worker.suspendu ?? worker.suspended ?? worker.is_suspended ?? false)
  if (isSuspended) return false

  const hasCoreProfile = Boolean(
    worker.prenom &&
    worker.nom &&
    worker.ville
  )

  const explicitProfileComplete = worker.profil_complet ?? worker.profile_complete ?? worker.is_profile_complete
  if (explicitProfileComplete === false) return false

  return hasCoreProfile
}

export function computeNoShowRate(
  completedMissions: number | null | undefined,
  noShowMissions: number | null | undefined
): number {
  const completed = Number(completedMissions ?? 0)
  const noShow = Number(noShowMissions ?? 0)
  const tracked = completed + noShow
  if (!Number.isFinite(tracked) || tracked <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((noShow / tracked) * 100)))
}

export function getMissionEngagementStage(snapshot: MissionValidationSnapshot): string {
  const status = normalizeMissionStatus(snapshot.statut)
  const summary = getMissionValidationSummary(snapshot)

  if (status === 'open') return 'En attente'
  if (status === 'expired') return 'Annulée'
  if (status === 'cancelled_by_patron' || status === 'cancelled_by_server') return 'Annulée'
  if (status === 'no_show') return 'Serveur absent'
  if (status === 'completed') return 'Terminée'
  if (status === 'dispute') return 'Litige ouvert'

  switch (summary.operationalState) {
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

export function canOpenUrgentReplacement(snapshot: MissionValidationSnapshot): boolean {
  const status = normalizeMissionStatus(snapshot.statut)
  return status === 'confirmed' || status === 'in_progress' || status === 'no_show'
}

export function getUrgentReplacementRule(): string {
  return 'Un remplacement urgent doit créer un nouvel engagement et un nouveau contrat, sans écraser le premier serveur rattaché à la mission.'
}
