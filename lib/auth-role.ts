import { supabase } from './supabase'

export type AccountRole = 'patron' | 'serveur'

const PATRON_HOME_ROUTE = '/dashboard_patron'
const SERVEUR_HOME_ROUTE = '/(server-tabs)/missions'
const PATRON_LOGIN_ROUTE = '/connexion-patron'
const SERVEUR_LOGIN_ROUTE = '/connexion-serveur'

const PATRON_ONLY_ROUTES = new Set([
  'dashboard_patron',
  'missions-patron',
  'poster-annonce',
  'serveurs-disponibles',
  'profil-patron',
  'modifier-profil-patron',
  'mes-etablissements',
  'abonnement',
  'evaluer-serveur',
  'historique-missions',
])

const SERVEUR_ONLY_ROUTES = new Set([
  'dashboard_serveur',
  'missions-disponibles',
  'rayon-serveur',
])

export function getHomeRouteForRole(role: AccountRole) {
  return role === 'patron' ? PATRON_HOME_ROUTE : SERVEUR_HOME_ROUTE
}

export function getLoginRouteForRole(role: AccountRole) {
  return role === 'patron' ? PATRON_LOGIN_ROUTE : SERVEUR_LOGIN_ROUTE
}

export async function resolveAccountRole(userId: string, metadataRole: unknown): Promise<AccountRole | null> {
  if (metadataRole === 'patron' || metadataRole === 'serveur') {
    return metadataRole
  }

  const [{ data: patron }, { data: serveur }] = await Promise.all([
    supabase.from('patrons').select('id').eq('id', userId).maybeSingle(),
    supabase.from('serveurs').select('id').eq('id', userId).maybeSingle(),
  ])

  if (patron?.id) return 'patron'
  if (serveur?.id) return 'serveur'
  return null
}

export function getRequiredRoleForSegments(segments: string[]): AccountRole | null {
  const [firstSegment] = segments

  if (!firstSegment) return null
  if (firstSegment === '(server-tabs)') return 'serveur'
  if (PATRON_ONLY_ROUTES.has(firstSegment)) return 'patron'
  if (SERVEUR_ONLY_ROUTES.has(firstSegment)) return 'serveur'
  return null
}
