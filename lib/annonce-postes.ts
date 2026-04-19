export function normalizeAnnoncePostes(input: unknown): string[] {
  if (Array.isArray(input)) {
    return Array.from(
      new Set(
        input
          .map((item) => String(item ?? '').trim())
          .filter(Boolean)
      )
    )
  }

  if (typeof input === 'string') {
    return Array.from(
      new Set(
        input
          .split('+')
          .map((item) => item.trim())
          .filter(Boolean)
      )
    )
  }

  return []
}

export function buildAnnoncePosteLabel(postes: string[]): string {
  const safePostes = normalizeAnnoncePostes(postes)
  if (safePostes.length === 0) return ''
  return safePostes.join(' + ')
}

export function missionMatchesRequestedPostes(
  serveurPostes: string[],
  requestedPostes: string[]
): boolean {
  const normalizedServeur = normalizeAnnoncePostes(serveurPostes).map((item) => item.toLowerCase())
  const normalizedRequested = normalizeAnnoncePostes(requestedPostes).map((item) => item.toLowerCase())

  if (normalizedRequested.length === 0) return true
  if (normalizedServeur.length === 0) return false

  return normalizedRequested.some((requested) =>
    normalizedServeur.some((serveurPoste) => serveurPoste === requested)
  )
}
