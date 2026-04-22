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

function normalizeMissionDateValue(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const isoLike = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoLike?.[1]) return isoLike[1]

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null

  const year = parsed.getUTCFullYear()
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0')
  const day = String(parsed.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
  const normalizedInputDate = normalizeMissionDateValue(input.date)
  if (!normalizedInputDate) return false

  if (!isServerAvailableForMission(input.disponibilites, normalizedInputDate, input.slot)) {
    return false
  }

  return !(input.activeMissions ?? []).some((mission) => {
    if (!mission?.date) return false
    const normalizedMissionDate = normalizeMissionDateValue(mission.date)
    if (!normalizedMissionDate) return false

    if (input.heureDebut && input.heureFin && mission.heure_debut && mission.heure_fin) {
      return doMissionRangesOverlap(
        {
          date: normalizedInputDate,
          heureDebut: input.heureDebut,
          heureFin: input.heureFin,
        },
        {
          date: normalizedMissionDate,
          heureDebut: mission.heure_debut,
          heureFin: mission.heure_fin,
        }
      )
    }

    if (normalizedMissionDate !== normalizedInputDate) return false
    return doMissionSlotsOverlap(
      input.slot,
      deriveMissionSlot(mission.mission_slot ?? null, mission.heure_debut, mission.heure_fin)
    )
  })
}

export function explainServerAvailabilityFromData(input: {
  disponibilites: ServeurDisponibiliteHebdo[]
  activeMissions?: ActiveMissionAvailabilityRecord[]
  date: string
  slot: MissionSlot
  heureDebut?: string | null
  heureFin?: string | null
}): {
  available: boolean
  normalizedDate: string | null
  weeklyMatch: boolean
  conflictReason: 'time_overlap' | 'slot_overlap' | null
  conflictingMission: ActiveMissionAvailabilityRecord | null
} {
  const normalizedInputDate = normalizeMissionDateValue(input.date)
  if (!normalizedInputDate) {
    return {
      available: false,
      normalizedDate: null,
      weeklyMatch: false,
      conflictReason: null,
      conflictingMission: null,
    }
  }

  const weeklyMatch = isServerAvailableForMission(input.disponibilites, normalizedInputDate, input.slot)
  if (!weeklyMatch) {
    return {
      available: false,
      normalizedDate: normalizedInputDate,
      weeklyMatch: false,
      conflictReason: null,
      conflictingMission: null,
    }
  }

  for (const mission of input.activeMissions ?? []) {
    if (!mission?.date) continue
    const normalizedMissionDate = normalizeMissionDateValue(mission.date)
    if (!normalizedMissionDate) continue

    if (input.heureDebut && input.heureFin && mission.heure_debut && mission.heure_fin) {
      const overlap = doMissionRangesOverlap(
        {
          date: normalizedInputDate,
          heureDebut: input.heureDebut,
          heureFin: input.heureFin,
        },
        {
          date: normalizedMissionDate,
          heureDebut: mission.heure_debut,
          heureFin: mission.heure_fin,
        }
      )

      if (overlap) {
        return {
          available: false,
          normalizedDate: normalizedInputDate,
          weeklyMatch: true,
          conflictReason: 'time_overlap',
          conflictingMission: mission,
        }
      }

      continue
    }

    if (normalizedMissionDate !== normalizedInputDate) continue
    const overlap = doMissionSlotsOverlap(
      input.slot,
      deriveMissionSlot(mission.mission_slot ?? null, mission.heure_debut, mission.heure_fin)
    )

    if (overlap) {
      return {
        available: false,
        normalizedDate: normalizedInputDate,
        weeklyMatch: true,
        conflictReason: 'slot_overlap',
        conflictingMission: mission,
      }
    }
  }

  return {
    available: true,
    normalizedDate: normalizedInputDate,
    weeklyMatch: true,
    conflictReason: null,
    conflictingMission: null,
  }
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
  const normalizedInputDate = normalizeMissionDateValue(date)

  console.log('server-availability: input', {
    requestedDate: date,
    normalizedDate: normalizedInputDate,
    slot,
    heureDebut: options?.heureDebut ?? null,
    heureFin: options?.heureFin ?? null,
    totalServeurs: uniqueIds.length,
  })

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
  const diagnostics: Array<{
    serveurId: string
    available: boolean
    weeklySlots: string[]
    activeMissions: Array<{
      date: string | null
      heure_debut?: string | null
      heure_fin?: string | null
      mission_slot?: string | null
    }>
    normalizedDate: string | null
    weeklyMatch: boolean
    conflictReason: 'time_overlap' | 'slot_overlap' | null
  }> = []

  uniqueIds.forEach((serveurId) => {
    const weeklyRows = disponibilitesByServeur.get(serveurId) ?? []
    const activeRows = activeMissionsByServeur.get(serveurId) ?? []
    const explanation = explainServerAvailabilityFromData({
      disponibilites: weeklyRows,
      activeMissions: activeRows,
      date,
      slot,
      heureDebut: options?.heureDebut ?? null,
      heureFin: options?.heureFin ?? null,
    })

    map[serveurId] = explanation.available
    diagnostics.push({
      serveurId,
      available: explanation.available,
      weeklySlots: weeklyRows.map((row) => `${row.jour}:${row.creneau}`),
      activeMissions: activeRows.map((row) => ({
        date: row.date,
        heure_debut: row.heure_debut ?? null,
        heure_fin: row.heure_fin ?? null,
        mission_slot: row.mission_slot ?? null,
      })),
      normalizedDate: explanation.normalizedDate,
      weeklyMatch: explanation.weeklyMatch,
      conflictReason: explanation.conflictReason,
    })
  })

  console.log('server-availability: results', {
    requestedDate: date,
    normalizedDate: normalizedInputDate,
    slot,
    totalServeurs: uniqueIds.length,
    availableCount: uniqueIds.filter((serveurId) => map[serveurId]).length,
    unavailableCount: uniqueIds.filter((serveurId) => !map[serveurId]).length,
    preview: diagnostics.slice(0, 20),
  })

  return map
}
