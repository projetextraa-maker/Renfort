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
    if (status === 'selected') return 'Selectionne par le patron'
    if (status === 'pending') return 'Mission proposee'
  } else {
    if (status === 'selected') return 'Profil retenu'
    if (status === 'pending') return 'Intérêt envoyé'
  }

  if (status === 'declined') return 'Refuse'
  if (status === 'expired') return 'Expire'
  if (status === 'cancelled') return 'Annule'
  return 'En attente'
}

export function getPatronApplicationLabel(snapshot: MissionApplicationSnapshot): string {
  const status = normalizeMissionApplicationStatus(snapshot.statut)
  if (status === 'selected') return 'Profil sélectionné'
  if (status === 'declined') return 'Profil refuse'
  if (status === 'expired') return 'Profil expire'
  if (status === 'cancelled') return 'Mission annulee'
  return 'Intérêt à traiter'
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

  if (status === 'open') return 'Mission ouverte'
  if (status === 'expired') return 'Mission expiree'
  if (status === 'cancelled_by_patron' || status === 'cancelled_by_server') return 'Mission annulee'
  if (status === 'no_show') return 'Serveur absent'
  if (status === 'completed') return 'Mission terminee'
  if (status === 'dispute') return 'Litige ouvert'

  switch (summary.operationalState) {
    case 'waiting_validation':
      return 'En attente de validation'
    case 'mission_confirmed':
      return 'Mission confirmee'
    case 'administrative_pending':
      return 'Administratif a finaliser'
    case 'ready_for_check_in':
      return 'Prete pour check-in'
    case 'in_progress':
      return 'En cours'
    case 'completed':
      return 'Mission terminee'
    default:
      return 'Mission confirmee'
  }
}

export function canOpenUrgentReplacement(snapshot: MissionValidationSnapshot): boolean {
  const status = normalizeMissionStatus(snapshot.statut)
  return status === 'confirmed' || status === 'in_progress' || status === 'no_show'
}

export function getUrgentReplacementRule(): string {
  return 'Un remplacement urgent doit creer un nouvel engagement et un nouveau contrat, sans ecraser le premier serveur rattache a la mission.'
}
