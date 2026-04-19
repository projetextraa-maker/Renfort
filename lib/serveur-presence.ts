export type PresenceBadgeTone = 'very_reliable' | 'reliable' | 'fair' | 'uncertain' | 'new'

function toSafeNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function getTrackedPresenceCount(
  missionsRealisees: number | string | null | undefined,
  missionsNoShow: number | string | null | undefined
): number {
  return toSafeNumber(missionsRealisees) + toSafeNumber(missionsNoShow)
}

export function getPresenceRate(
  missionsRealisees: number | string | null | undefined,
  missionsNoShow: number | string | null | undefined
): number | null {
  const completed = toSafeNumber(missionsRealisees)
  const noShow = toSafeNumber(missionsNoShow)
  const tracked = completed + noShow

  if (tracked <= 0) return null

  return Math.max(0, Math.min(100, Math.round((completed / tracked) * 100)))
}

export function getPresenceBadge(
  missionsRealisees: number | string | null | undefined,
  missionsNoShow: number | string | null | undefined
): { label: string; tone: PresenceBadgeTone; rate: number | null; trackedCount: number } {
  const trackedCount = getTrackedPresenceCount(missionsRealisees, missionsNoShow)
  const rate = getPresenceRate(missionsRealisees, missionsNoShow)

  if (trackedCount < 3 || rate == null) {
    return { label: 'Nouveau', tone: 'new', rate, trackedCount }
  }

  if (rate >= 95) {
    return { label: 'Tres fiable', tone: 'very_reliable', rate, trackedCount }
  }

  if (rate >= 85) {
    return { label: 'Fiable', tone: 'reliable', rate, trackedCount }
  }

  if (rate >= 70) {
    return { label: 'Correct', tone: 'fair', rate, trackedCount }
  }

  return { label: 'A confirmer', tone: 'uncertain', rate, trackedCount }
}
