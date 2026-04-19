// lib/missionStatus.ts

export type MissionStatut =
  | 'ouverte' | 'open'
  | 'acceptee' | 'attribuee' | 'confirmed'
  | 'in_progress'
  | 'completed' | 'terminee'
  | 'no_show'
  | 'cancelled' | 'annulee'
  | 'expired'

// Mapping anciens → nouveaux statuts
export function normalizeStatut(statut: string): string {
  switch (statut) {
    case 'ouverte':    return 'open'
    case 'acceptee':
    case 'attribuee':  return 'confirmed'
    case 'terminee':   return 'completed'
    case 'annulee':    return 'cancelled'
    default:           return statut // déjà dans le nouveau système
  }
}

// Est-ce que la mission devrait passer en in_progress ?
export function shouldBeInProgress(mission: {
  statut: string
  date: string
  heure_debut: string
}): boolean {
  const normalized = normalizeStatut(mission.statut)

  // Seulement si confirmed (ou équivalent)
  if (normalized !== 'confirmed') return false

  const now = new Date()

  // Construit la date/heure de début
  try {
    const [year, month, day] = mission.date.split('-').map(Number)
    const [hour, minute]     = mission.heure_debut.split(':').map(Number)
    const debut = new Date(year, month - 1, day, hour, minute)

    return now >= debut
  } catch {
    return false
  }
}

// Appliquer la transition si nécessaire (retourne le nouveau statut)
export function getEffectiveStatut(mission: {
  statut: string
  date: string
  heure_debut: string
}): string {
  if (shouldBeInProgress(mission)) return 'in_progress'
  return mission.statut // on ne touche pas les autres
}