import { type NormalizedAnnonceRecord } from './annonce-read'
import {
  isActiveMissionStatus,
  isCompletedMissionStatus as isResolvedMissionStatus,
  isOpenMissionStatus,
  normalizeMissionStatus,
} from './missions'

export type DashboardPatronAnnonce = Pick<
  NormalizedAnnonceRecord,
  | 'id'
  | 'poste'
  | 'date'
  | 'heure_debut'
  | 'heure_fin'
  | 'salaire'
  | 'ville'
  | 'statut'
  | 'serveur_id'
  | 'note'
  | 'etablissement_id'
  | 'check_in_status'
  | 'checked_out_at'
>

export type DashboardPatronAnnonceWithRating = DashboardPatronAnnonce & {
  rating_status: 'pending' | 'rated'
}

export function getDashboardPatronStatusConfig(
  statut: string,
  colors: {
    amberBg: string
    amber: string
    amberBd: string
    greenBg: string
    green: string
    greenBd: string
    redBg: string
    red: string
    redBd: string
  }
) {
  switch (normalizeMissionStatus(statut)) {
    case 'open':
      return { label: 'En attente', bg: colors.amberBg, color: colors.amber, border: colors.amberBd }
    case 'confirmed':
      return { label: 'Sélectionnée', bg: colors.greenBg, color: colors.green, border: colors.greenBd }
    case 'in_progress':
      return { label: 'En cours', bg: colors.greenBg, color: colors.green, border: colors.greenBd }
    case 'completed':
      return { label: 'Terminée', bg: '#F5F3F0', color: '#888', border: '#E0D9D0' }
    case 'no_show':
      return { label: 'Serveur absent', bg: colors.redBg, color: colors.red, border: colors.redBd }
    case 'cancelled_by_patron':
      return { label: 'Annulée par vous', bg: colors.redBg, color: colors.red, border: colors.redBd }
    case 'cancelled_by_server':
      return { label: 'Annulée par le serveur', bg: colors.redBg, color: colors.red, border: colors.redBd }
    case 'expired':
      return { label: 'Expirée', bg: colors.redBg, color: colors.red, border: colors.redBd }
    default:
      return { label: statut, bg: '#F5F3F0', color: '#888', border: '#E0D9D0' }
  }
}

export function isPendingDashboardMissionStatus(statut: string | null | undefined) {
  return isOpenMissionStatus(statut)
}

export function isAssignedDashboardMissionStatus(statut: string | null | undefined) {
  return isActiveMissionStatus(statut)
}

export function isCompletedDashboardMissionStatus(statut: string | null | undefined) {
  return isResolvedMissionStatus(statut)
}

export function hasMissionCheckedOut(annonce: DashboardPatronAnnonce | DashboardPatronAnnonceWithRating) {
  return normalizeMissionStatus(annonce.statut) === 'completed' && (
    String(annonce.check_in_status ?? '').toLowerCase() === 'checked_out' ||
    Boolean(annonce.checked_out_at)
  )
}
