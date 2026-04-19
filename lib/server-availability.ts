import { supabase } from './supabase'
import { ACTIVE_MISSION_READ_STATUSES, doMissionRangesOverlap } from './missions'
import {
  detectMissionSlot,
  isServerAvailableForMission,
  type MissionSlot,
  type ServeurDisponibiliteHebdo,
} from './serveur-disponibilites'

type ActiveMissionAvailabilityRecord = {
  serveur_id?: string | null
  date: string | null
  heure_debut?: string | null
  heure_fin?: string | null
  mission_slot?: string | null
}

type AvailabilityCheckOptions = {
  heureDebut?: string | null
  heureFin?: string | null
}

function normalizeMissionSlot(value: string | null | undefined): MissionSlot | null {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'midday' || normalized === 'evening' || normalized === 'full') {
    return normalized
  }
  return null
}

function deriveMissionSlot(
  missionSlot: string | null | undefined,
  heureDebut?: string | null,
  heureFin?: string | null
): MissionSlot {
  return normalizeMissionSlot(missionSlot) ?? detectMissionSlot(String(heureDebut ?? ''), String(heureFin ?? ''))
}

function doMissionSlotsOverlap(first: MissionSlot, second: MissionSlot): boolean {
  if (first === 'full' || second === 'full') return true
  return first === second
}

export function getServerBusySlotMessage(
  slot: MissionSlot | null | undefined,
  audience: 'self' | 'profile' = 'profile'
): string {
  const subject = audience === 'self' ? 'Vous etes deja engage' : 'Ce profil est deja engage'
  if (slot === 'midday') return `${subject} sur ce midi.`
  if (slot === 'evening') return `${subject} sur ce soir.`
  if (slot === 'full') return `${subject} sur cette journee.`
  return `${subject} sur ce creneau.`
}

export function isServerAvailableFromData(input: {
  disponibilites: ServeurDisponibiliteHebdo[]
  activeMissions?: ActiveMissionAvailabilityRecord[]
  date: string
  slot: MissionSlot
  heureDebut?: string | null
  heureFin?: string | null
}): boolean {
  if (!isServerAvailableForMission(input.disponibilites, input.date, input.slot)) {
    return false
  }

  return !(input.activeMissions ?? []).some((mission) => {
    if (!mission?.date) return false

    if (input.heureDebut && input.heureFin && mission.heure_debut && mission.heure_fin) {
      return doMissionRangesOverlap(
        {
          date: input.date,
          heureDebut: input.heureDebut,
          heureFin: input.heureFin,
        },
        {
          date: mission.date,
          heureDebut: mission.heure_debut,
          heureFin: mission.heure_fin,
        }
      )
    }

    if (mission.date !== input.date) return false
    return doMissionSlotsOverlap(
      input.slot,
      deriveMissionSlot(mission.mission_slot ?? null, mission.heure_debut, mission.heure_fin)
    )
  })
}

export async function isServerAvailable(
  serveurId: string,
  date: string,
  slot: MissionSlot,
  options?: AvailabilityCheckOptions
): Promise<boolean> {
  const [slotsResult, activeMissionsResult] = await Promise.all([
    supabase
      .from('serveur_disponibilites_hebdo')
      .select('serveur_id, jour, creneau')
      .eq('serveur_id', serveurId),
    supabase
      .from('annonces')
      .select('serveur_id, date, heure_debut, heure_fin, mission_slot')
      .eq('serveur_id', serveurId)
      .in('statut', [...ACTIVE_MISSION_READ_STATUSES]),
  ])

  if (slotsResult.error) return false
  if (activeMissionsResult.error) return false

  return isServerAvailableFromData({
    disponibilites: (slotsResult.data ?? []) as ServeurDisponibiliteHebdo[],
    activeMissions: (activeMissionsResult.data ?? []) as ActiveMissionAvailabilityRecord[],
    date,
    slot,
    heureDebut: options?.heureDebut ?? null,
    heureFin: options?.heureFin ?? null,
  })
}

export async function fetchServerAvailabilityMap(
  serveurIds: string[],
  date: string,
  slot: MissionSlot,
  options?: AvailabilityCheckOptions
): Promise<Record<string, boolean>> {
  const uniqueIds = [...new Set(serveurIds.filter(Boolean))]
  if (uniqueIds.length === 0) return {}

  const [slotsResult, activeMissionsResult] = await Promise.all([
    supabase
      .from('serveur_disponibilites_hebdo')
      .select('serveur_id, jour, creneau')
      .in('serveur_id', uniqueIds),
    supabase
      .from('annonces')
      .select('serveur_id, date, heure_debut, heure_fin, mission_slot')
      .in('serveur_id', uniqueIds)
      .in('statut', [...ACTIVE_MISSION_READ_STATUSES]),
  ])

  const disponibilitesByServeur = new Map<string, ServeurDisponibiliteHebdo[]>()
  ;((slotsResult.data ?? []) as ServeurDisponibiliteHebdo[]).forEach((item) => {
    if (!item.serveur_id) return
    const current = disponibilitesByServeur.get(item.serveur_id) ?? []
    current.push(item)
    disponibilitesByServeur.set(item.serveur_id, current)
  })

  const activeMissionsByServeur = new Map<string, ActiveMissionAvailabilityRecord[]>()
  ;((activeMissionsResult.data ?? []) as ActiveMissionAvailabilityRecord[]).forEach((item) => {
    const serveurId = String(item.serveur_id ?? '').trim()
    if (!serveurId) return
    const current = activeMissionsByServeur.get(serveurId) ?? []
    current.push(item)
    activeMissionsByServeur.set(serveurId, current)
  })

  const map: Record<string, boolean> = {}
  uniqueIds.forEach((serveurId) => {
    map[serveurId] = isServerAvailableFromData({
      disponibilites: disponibilitesByServeur.get(serveurId) ?? [],
      activeMissions: activeMissionsByServeur.get(serveurId) ?? [],
      date,
      slot,
      heureDebut: options?.heureDebut ?? null,
      heureFin: options?.heureFin ?? null,
    })
  })

  return map
}
