export const DISTANCE_FILTERS_KM = [10, 20, 50] as const

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusKm = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function isWithinDistanceRadius(
  distanceKm: number | null | undefined,
  rayonKm: number | null | undefined
): boolean {
  if (distanceKm == null) return true
  if (rayonKm == null) return true
  return distanceKm <= rayonKm
}
