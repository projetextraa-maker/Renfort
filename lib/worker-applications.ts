import { ANNONCE_COMPAT_SELECT, normalizeAnnonceRecords } from './annonce-read'
import { fetchEtablissementNameMapByIds } from './etablissements'
import { getWorkerInterestLabel, normalizeMissionApplicationStatus } from './mission-hiring'
import { hasMissionEnded, isCancelledMissionStatus, isCompletedMissionStatus } from './missions'
import { supabase } from './supabase'

export type WorkerApplicationStatus = 'interested' | 'selected' | 'declined' | 'expired'

export type WorkerTrackedApplication = {
  demande_id: string
  annonce_id: string
  poste: string
  etablissement_id?: string | null
  etablissement_nom: string
  ville: string
  date: string
  heure_debut: string
  heure_fin: string
  salaire: number | null
  status: WorkerApplicationStatus
  status_label: string
}

function toTrackedStatus(value: string | null | undefined): WorkerApplicationStatus {
  const normalized = normalizeMissionApplicationStatus(value)
  if (normalized === 'selected') return 'selected'
  if (normalized === 'declined') return 'declined'
  if (normalized === 'expired' || normalized === 'cancelled') return 'expired'
  return 'interested'
}

export function getWorkerTrackedApplicationTone(status: WorkerApplicationStatus) {
  switch (status) {
    case 'selected':
      return { bg: '#E8F5ED', border: '#CFE7D8', text: '#2E8B57' }
    case 'declined':
      return { bg: '#FEF2F2', border: '#F2CACA', text: '#C84B4B' }
    case 'expired':
      return { bg: '#F4EFE7', border: '#E6DED2', text: '#6D675E' }
    case 'interested':
    default:
      return { bg: '#FEF3EB', border: '#F5C9A9', text: '#C46A3C' }
  }
}

function shouldKeepTrackedApplication(input: {
  annonceStatut: string | null | undefined
  annonceDate: string | null | undefined
  annonceHeureDebut: string | null | undefined
  annonceHeureFin: string | null | undefined
  trackedStatus: WorkerApplicationStatus
}): boolean {
  if (input.trackedStatus === 'declined' || input.trackedStatus === 'expired') return false
  if (isCompletedMissionStatus(input.annonceStatut) || isCancelledMissionStatus(input.annonceStatut)) return false
  if (hasMissionEnded(input.annonceDate, input.annonceHeureDebut, input.annonceHeureFin)) return false
  return true
}

export async function fetchWorkerTrackedApplications(
  serveurId: string
): Promise<WorkerTrackedApplication[]> {
  const { data: demandes, error: demandesError } = await supabase
    .from('demandes')
    .select('id, annonce_id, statut, initiateur')
    .eq('serveur_id', serveurId)
    .eq('initiateur', 'serveur')
    .in('statut', ['en_attente', 'acceptee', 'refusee', 'expiree', 'annulee'])
    .order('created_at', { ascending: false })

  if (demandesError || !demandes || demandes.length === 0) return []

  const annonceIds = [...new Set(demandes.map((item: any) => item.annonce_id).filter(Boolean))]
  if (annonceIds.length === 0) return []

  const { data: annoncesData } = await supabase
    .from('annonces')
    .select(ANNONCE_COMPAT_SELECT)
    .in('id', annonceIds)

  const annonces = normalizeAnnonceRecords(annoncesData as any[])
  const annonceMap = Object.fromEntries(annonces.map((annonce) => [annonce.id, annonce]))

  const patronIds = [...new Set(annonces.map((annonce) => annonce.patron_id).filter(Boolean))]
  const etablissementIds = [...new Set(annonces.map((annonce) => annonce.etablissement_id).filter(Boolean))]

  const { data: patronsData } = patronIds.length > 0
    ? await supabase.from('patrons').select('id, nom_restaurant').in('id', patronIds)
    : { data: [] as any[] }

  const etablissementMap = etablissementIds.length > 0
    ? await fetchEtablissementNameMapByIds(etablissementIds as string[])
    : {}

  const patronMap: Record<string, string> = {}
  ;(patronsData ?? []).forEach((patron: any) => {
    patronMap[String(patron.id)] = patron.nom_restaurant ?? 'Etablissement'
  })

  return demandes
    .map((demande: any) => {
      const annonce = annonceMap[String(demande.annonce_id)]
      if (!annonce) return null

      const status = toTrackedStatus(demande.statut)
      if (
        !shouldKeepTrackedApplication({
          annonceStatut: annonce.statut,
          annonceDate: annonce.date,
          annonceHeureDebut: annonce.heure_debut,
          annonceHeureFin: annonce.heure_fin,
          trackedStatus: status,
        })
      ) {
        return null
      }

      return {
        demande_id: String(demande.id),
        annonce_id: annonce.id,
        poste: annonce.poste,
        etablissement_id: annonce.etablissement_id ?? null,
        etablissement_nom: annonce.etablissement_id
          ? etablissementMap[String(annonce.etablissement_id)] ?? annonce.ville ?? patronMap[String(annonce.patron_id)] ?? 'Etablissement'
          : patronMap[String(annonce.patron_id)] ?? annonce.ville ?? 'Etablissement',
        ville: annonce.ville,
        date: annonce.date,
        heure_debut: annonce.heure_debut,
        heure_fin: annonce.heure_fin,
        salaire: annonce.salaire ?? null,
        status,
        status_label: getWorkerInterestLabel({ statut: demande.statut, initiateur: 'serveur' }),
      } satisfies WorkerTrackedApplication
    })
    .filter(Boolean) as WorkerTrackedApplication[]
}
