type ComputeServeurGlobalScoreParams = {
  tauxPresence: number | null
  noteMoyenne: number | null
  distanceKm: number | null
  missionsRealisees: number
}

type CompareServeurRankingParams = {
  tauxPresence: number | null
  noteMoyenne: number | null
  distanceKm: number | null
  missionsRealisees: number
}

type ComputeRecommendationScoreParams = {
  tauxPresence: number | null
  noteMoyenne: number | null
  distanceKm: number | null
  missionsRealisees: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function getPresenceScore(tauxPresence: number | null): number {
  const taux = clamp(tauxPresence ?? 100, 0, 100)
  if (taux >= 95) return 40
  if (taux >= 90) return 35
  if (taux >= 80) return 28
  if (taux >= 70) return 20
  return 10
}

export function getNoteScore(noteMoyenne: number | null): number {
  const note = clamp(noteMoyenne ?? 0, 0, 5)
  if (note >= 4.8) return 25
  if (note >= 4.5) return 22
  if (note >= 4) return 18
  if (note >= 3.5) return 12
  return 6
}

export function getExperienceScore(missionsRealisees: number): number {
  if (missionsRealisees <= 0) return 10
  if (missionsRealisees < 5) return 12
  if (missionsRealisees < 10) return 14
  if (missionsRealisees < 50) return 17
  return 20
}

export function getDistanceScore(distanceKm: number | null): number {
  if (distanceKm == null) return 0
  if (distanceKm <= 3) return 15
  if (distanceKm <= 5) return 13
  if (distanceKm <= 10) return 10
  if (distanceKm <= 20) return 6
  if (distanceKm <= 30) return 3
  return 0
}

export function getExperienceRecommendationValue(missionsRealisees: number): number {
  if (missionsRealisees <= 0) return 20
  if (missionsRealisees < 5) return 40
  if (missionsRealisees < 10) return 60
  if (missionsRealisees < 30) return 80
  return 100
}

export function getNoteRecommendationValue(noteMoyenne: number | null): number {
  const note = clamp(noteMoyenne ?? 0, 0, 5)
  return Math.round((note / 5) * 100)
}

export function getDistanceRecommendationValue(distanceKm: number | null): number {
  if (distanceKm == null) return 20
  if (distanceKm <= 5) return 100
  if (distanceKm <= 15) return 80
  if (distanceKm <= 30) return 60
  if (distanceKm <= 50) return 40
  return 20
}

export function computeRecommendationScore({
  tauxPresence,
  noteMoyenne,
  distanceKm,
  missionsRealisees,
}: ComputeRecommendationScoreParams): number {
  const presenceValue = clamp(tauxPresence ?? 0, 0, 100)
  const experienceValue = getExperienceRecommendationValue(missionsRealisees)
  const noteValue = getNoteRecommendationValue(noteMoyenne)
  const distanceValue = getDistanceRecommendationValue(distanceKm)

  return Math.round(
    presenceValue * 0.5 +
    experienceValue * 0.25 +
    noteValue * 0.15 +
    distanceValue * 0.1
  )
}

export function computeServeurGlobalScore({
  tauxPresence,
  noteMoyenne,
  distanceKm,
  missionsRealisees,
}: ComputeServeurGlobalScoreParams): number {
  const safePresence = clamp(tauxPresence ?? 0, 0, 100)
  const safeExperience = clamp(missionsRealisees, 0, 999)
  const safeNote = Math.round(clamp(noteMoyenne ?? 0, 0, 5) * 100)
  const safeDistanceScore = getDistanceScore(distanceKm)

  return (
    safePresence * 1_000_000 +
    safeExperience * 1_000 +
    safeNote * 10 +
    safeDistanceScore
  )
}

export function compareServeurRanking(
  a: CompareServeurRankingParams,
  b: CompareServeurRankingParams
): number {
  const presenceDiff = clamp(b.tauxPresence ?? -1, -1, 100) - clamp(a.tauxPresence ?? -1, -1, 100)
  if (presenceDiff !== 0) return presenceDiff

  const experienceDiff = clamp(b.missionsRealisees, 0, 999) - clamp(a.missionsRealisees, 0, 999)
  if (experienceDiff !== 0) return experienceDiff

  const noteDiff = clamp(b.noteMoyenne ?? -1, -1, 5) - clamp(a.noteMoyenne ?? -1, -1, 5)
  if (noteDiff !== 0) return noteDiff

  const safeDistanceA = a.distanceKm == null ? Number.POSITIVE_INFINITY : a.distanceKm
  const safeDistanceB = b.distanceKm == null ? Number.POSITIVE_INFINITY : b.distanceKm
  return safeDistanceA - safeDistanceB
}
