export const CANONICAL_MISSION_STATUSES = [
  'open',
  'confirmed',
  'in_progress',
  'completed',
  'no_show',
  'cancelled_by_patron',
  'cancelled_by_server',
  'dispute',
  'expired',
] as const

export type CanonicalMissionStatus = (typeof CANONICAL_MISSION_STATUSES)[number]

export const OPEN_MISSION_READ_STATUSES = ['open', 'ouverte', 'pending'] as const
export const CONFIRMED_MISSION_READ_STATUSES = ['confirmed', 'attribuee', 'acceptee', 'assigned', 'accepted'] as const
export const COMPLETED_MISSION_READ_STATUSES = ['completed', 'terminee'] as const
export const CANCELLED_MISSION_READ_STATUSES = ['cancelled_by_patron', 'cancelled_by_server', 'annulee', 'cancelled'] as const
export const ACTIVE_MISSION_READ_STATUSES = [...CONFIRMED_MISSION_READ_STATUSES, 'in_progress'] as const

export function normalizeMissionStatus(statut: string | null | undefined): CanonicalMissionStatus | 'unknown' {
  const normalized = String(statut ?? '').toLowerCase()

  switch (normalized) {
    case 'open':
    case 'ouverte':
    case 'pending':
      return 'open'
    case 'confirmed':
    case 'attribuee':
    case 'acceptee':
    case 'assigned':
    case 'accepted':
      return 'confirmed'
    case 'in_progress':
      return 'in_progress'
    case 'completed':
    case 'terminee':
      return 'completed'
    case 'no_show':
      return 'no_show'
    case 'cancelled_by_patron':
    case 'annulee':
    case 'cancelled':
      return 'cancelled_by_patron'
    case 'cancelled_by_server':
      return 'cancelled_by_server'
    case 'dispute':
      return 'dispute'
    case 'expired':
      return 'expired'
    default:
      return 'unknown'
  }
}

// Shared mission time parsing used by patron and extra flows.
// This keeps runtime status decisions consistent across screens.
export function parseMissionDateTime(dateValue: string | null | undefined, timeValue?: string | null | undefined): Date | null {
  if (!dateValue) return null

  const [year, month, day] = String(dateValue).split('-').map(Number)
  if (!year || !month || !day) return null

  const [hours = 0, minutes = 0] = String(timeValue ?? '00:00').split(':').map(Number)
  return new Date(year, month - 1, day, hours || 0, minutes || 0, 0, 0)
}

export function getMissionTimeRange(
  dateValue: string | null | undefined,
  heureDebut?: string | null | undefined,
  heureFin?: string | null | undefined
): { start: Date; end: Date } | null {
  const start = parseMissionDateTime(dateValue, heureDebut)
  const end = parseMissionDateTime(dateValue, heureFin)
  if (!start || !end) return null

  // Night missions can end after midnight, e.g. 23:00 -> 02:00.
  if (end.getTime() <= start.getTime()) {
    end.setDate(end.getDate() + 1)
  }

  return { start, end }
}

export function doMissionRangesOverlap(
  first: { date: string | null | undefined; heureDebut?: string | null | undefined; heureFin?: string | null | undefined },
  second: { date: string | null | undefined; heureDebut?: string | null | undefined; heureFin?: string | null | undefined }
): boolean {
  const firstRange = getMissionTimeRange(first.date, first.heureDebut, first.heureFin)
  const secondRange = getMissionTimeRange(second.date, second.heureDebut, second.heureFin)
  if (!firstRange || !secondRange) return false

  return firstRange.start.getTime() < secondRange.end.getTime() &&
    secondRange.start.getTime() < firstRange.end.getTime()
}

export function isOpenMissionStatus(statut: string | null | undefined): boolean {
  return normalizeMissionStatus(statut) === 'open'
}

export function isConfirmedMissionStatus(statut: string | null | undefined): boolean {
  return normalizeMissionStatus(statut) === 'confirmed'
}

export function isActiveMissionStatus(statut: string | null | undefined): boolean {
  const normalized = normalizeMissionStatus(statut)
  return normalized === 'confirmed' || normalized === 'in_progress'
}

export function isCompletedMissionStatus(statut: string | null | undefined): boolean {
  const normalized = normalizeMissionStatus(statut)
  return normalized === 'completed' || normalized === 'no_show'
}

export function isCancelledMissionStatus(statut: string | null | undefined): boolean {
  const normalized = normalizeMissionStatus(statut)
  return normalized === 'cancelled_by_patron' || normalized === 'cancelled_by_server'
}

export function isDisputedMissionStatus(statut: string | null | undefined): boolean {
  return normalizeMissionStatus(statut) === 'dispute'
}

// MVP runtime status rule:
// a mission is considered in progress as soon as now >= date + heure_debut,
// but only if it still belongs to the confirmed-like status family.
// Screens should not reimplement this check locally.
export function shouldMissionBeInProgress(
  statut: string | null | undefined,
  dateValue: string | null | undefined,
  heureDebut?: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!isConfirmedMissionStatus(statut)) return false
  const missionStart = parseMissionDateTime(dateValue, heureDebut)
  if (!missionStart) return false
  return now.getTime() >= missionStart.getTime()
}

export function isMissionExpired(dateValue: string | null | undefined): boolean {
  if (!dateValue) return false

  const [year, month, day] = String(dateValue).split('-').map(Number)
  if (!year || !month || !day) return false

  const missionDate = new Date(year, month - 1, day)
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  return missionDate < todayStart
}

export function hasMissionEnded(
  dateValue: string | null | undefined,
  heureDebut?: string | null | undefined,
  heureFin?: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (heureDebut && heureFin) {
    const missionRange = getMissionTimeRange(dateValue, heureDebut, heureFin)
    if (missionRange) {
      return missionRange.end.getTime() < now.getTime()
    }
  }

  const missionEnd = parseMissionDateTime(dateValue, heureFin)
  if (!missionEnd) return false
  return missionEnd.getTime() < now.getTime()
}

export function shouldHideMissionFromOpenLists(
  statut: string | null | undefined,
  dateValue: string | null | undefined,
  heureDebut?: string | null | undefined,
  heureFin?: string | null | undefined
): boolean {
  if (!isOpenMissionStatus(statut)) return false
  if (heureFin) return hasMissionEnded(dateValue, heureDebut, heureFin)
  return isMissionExpired(dateValue)
}
