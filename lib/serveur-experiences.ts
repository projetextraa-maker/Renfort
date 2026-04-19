export interface ServeurExperience {
  id?: string
  poste: string
  description: string
  duree: string
}

export const EXPERIENCE_POSTES = [
  'Serveur',
  'Runner',
  'Barman',
  'Barista',
  'Plongeur',
  'Commis',
  'Chef de rang',
  'Hote / hotesse',
] as const

export const EXPERIENCE_DESCRIPTIONS_SUGGESTIONS = [
  'Brasserie',
  'Restaurant traditionnel',
  'Gastronomique',
  'Bar',
  'Evenementiel',
  'Hotel',
  'Plage / saisonnier',
] as const

export const EXPERIENCE_DUREES = [
  'Moins de 6 mois',
  '6 mois a 1 an',
  '1 a 2 ans',
  '2 a 5 ans',
  '5 ans et +',
] as const

export function formatServeurExperience(experience: ServeurExperience): string {
  return `${experience.poste} - ${experience.duree} - ${experience.description}`
}

export function getPrimaryServeurExperienceLabel(experiences: ServeurExperience[]): string {
  if (experiences.length === 0) return 'Experiences a renseigner'
  const [first] = experiences
  if (!first) return 'Experiences a renseigner'
  return `${first.poste} - ${first.duree}`
}

export function getServeurExperiencesBio(experiences: ServeurExperience[]): string {
  if (experiences.length === 0) {
    return 'Aucune experience structuree renseignee pour le moment.'
  }

  return experiences.map(formatServeurExperience).join('\n')
}
