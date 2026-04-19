import { ANNONCE_COMPAT_SELECT, normalizeAnnonceRecords } from './annonce-read'
import { supabase } from './supabase'
import { expireOpenAnnonces } from './annonces'
import { fetchEtablissementNameMapByIds } from './etablissements'
import { haversineKm, isWithinDistanceRadius } from './location-distance'
import { ACTIVE_MISSION_READ_STATUSES, OPEN_MISSION_READ_STATUSES, shouldHideMissionFromOpenLists } from './missions'
import { isServerAvailableFromData } from './server-availability'
import { type ServeurDisponibiliteHebdo } from './serveur-disponibilites'

export interface OffreProche {
  id: string
  poste: string
  ville: string
  nom_restaurant?: string | null
  heure_debut: string
  heure_fin: string
  salaire: number
  date: string
  statut: string
  patron_id: string
  etablissement_id?: string | null
  description: string | null
  lat: number | null
  lng: number | null
  distanceKm: number
}

export async function getNearbyOffresForServeur(
  serveurId: string,
  rayonOverride?: number,
  limit: number = 50
): Promise<OffreProche[]> {
  const { data: serveur, error: serveurError } = await supabase
    .from('serveurs')
    .select('lat, lng, rayon')
    .eq('id', serveurId)
    .single()

  if (serveurError || !serveur || serveur.lat == null || serveur.lng == null) {
    return []
  }

  const rayon = rayonOverride ?? serveur.rayon ?? 50

  const { data: availabilityRows } = await supabase
    .from('serveur_disponibilites_hebdo')
    .select('serveur_id, jour, creneau')
    .eq('serveur_id', serveurId)

  const { data: annonces, error: annoncesError } = await supabase
    .from('annonces')
    .select(ANNONCE_COMPAT_SELECT)
    .in('statut', [...OPEN_MISSION_READ_STATUSES])
    .order('date', { ascending: true })
    .limit(100)

  if (annoncesError || !annonces) {
    console.error('annonces error:', annoncesError)
    return []
  }

  const normalizedAnnonces = normalizeAnnonceRecords(annonces as any[])

  const patronIds = [...new Set(normalizedAnnonces.map((a: any) => a.patron_id).filter(Boolean))]
  const etablissementIds = [...new Set(normalizedAnnonces.map((a: any) => a.etablissement_id).filter(Boolean))]
  const { data: patronsData } = patronIds.length > 0
    ? await supabase.from('patrons').select('id, nom_restaurant').in('id', patronIds)
    : { data: [] as any[] }
  const etablissementMap = etablissementIds.length > 0
    ? await fetchEtablissementNameMapByIds(etablissementIds)
    : {}

  const patronMap: Record<string, string> = {}
  ;(patronsData ?? []).forEach((patron: any) => {
    patronMap[String(patron.id)] = patron.nom_restaurant ?? 'Restaurant'
  })
  const expiredAnnonceIds = normalizedAnnonces
    .filter((a: any) => shouldHideMissionFromOpenLists(a.statut, a.date, a.heure_debut, a.heure_fin))
    .map((a: any) => a.id)

  if (expiredAnnonceIds.length > 0) {
    await expireOpenAnnonces(expiredAnnonceIds)
  }

  const { data: activeDemandes } = await supabase
    .from('demandes')
    .select('annonce_id')
    .eq('serveur_id', serveurId)
    .in('statut', ['en_attente', 'acceptee'])

  const excludedAnnonceIds = new Set((activeDemandes ?? []).map((demande: any) => demande.annonce_id))

  const { data: activeWorkerMissions } = await supabase
    .from('annonces')
    .select('id, date, heure_debut, heure_fin, mission_slot')
    .eq('serveur_id', serveurId)
    .in('statut', [...ACTIVE_MISSION_READ_STATUSES])

  const workerMissionRanges = (activeWorkerMissions ?? []) as {
    serveur_id?: string | null
    id: string
    date: string | null
    heure_debut?: string | null
    heure_fin?: string | null
    mission_slot?: string | null
  }[]

  const serveurDisponibilites = (availabilityRows ?? []) as ServeurDisponibiliteHebdo[]

  const offres = normalizedAnnonces
    .filter((a: any) => !shouldHideMissionFromOpenLists(a.statut, a.date, a.heure_debut, a.heure_fin))
    .filter((a: any) => !excludedAnnonceIds.has(a.id))
    .filter((a: any) => isServerAvailableFromData({
      disponibilites: serveurDisponibilites,
      activeMissions: workerMissionRanges,
      date: a.date,
      slot: a.mission_slot,
      heureDebut: a.heure_debut,
      heureFin: a.heure_fin,
    }))
    .filter((a: any) => a.lat != null && a.lng != null)
    .map((a: any) => ({
      ...a,
      nom_restaurant: (a.etablissement_id ? etablissementMap[String(a.etablissement_id)] : null) ?? patronMap[String(a.patron_id)] ?? 'Restaurant',
      distanceKm: haversineKm(serveur.lat, serveur.lng, a.lat, a.lng),
    }))
    .filter((a: any) => isWithinDistanceRadius(a.distanceKm, rayon))
    .sort((a: any, b: any) => {
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm
      return String(a.date).localeCompare(String(b.date))
    })
    .slice(0, limit) as OffreProche[]

  return offres
}
