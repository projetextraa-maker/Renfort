import {
  isCanonicalAvailabilitySlotKey,
  type ServeurDisponibiliteHebdo,
} from './serveur-disponibilites'
import { supabase } from './supabase'

function sanitizeDisponibilite(
  item: any
): ServeurDisponibiliteHebdo | null {
  if (!item?.jour || !item?.creneau) return null

  const creneau = String(item.creneau).trim().toLowerCase()
  if (!isCanonicalAvailabilitySlotKey(creneau)) return null

  return {
    serveur_id: item.serveur_id ?? undefined,
    jour: item.jour,
    creneau,
  }
}

export async function fetchServeurDisponibilitesHebdo(
  serveurId: string
): Promise<ServeurDisponibiliteHebdo[]> {
  if (!serveurId) return []

  const { data, error } = await supabase
    .from('serveur_disponibilites_hebdo')
    .select('serveur_id, jour, creneau')
    .eq('serveur_id', serveurId)
    .order('jour', { ascending: true })

  if (error || !data) {
    console.log('fetchServeurDisponibilitesHebdo error', error)
    return []
  }

  return data
    .map((item) => sanitizeDisponibilite(item))
    .filter(Boolean) as ServeurDisponibiliteHebdo[]
}

export async function replaceServeurDisponibilitesHebdo(
  serveurId: string,
  items: ServeurDisponibiliteHebdo[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!serveurId) {
    return { ok: false, error: 'serveur_id manquant' }
  }

  const safeItems = (items ?? [])
    .map((item) => sanitizeDisponibilite({ ...item, serveur_id: serveurId }))
    .filter(Boolean) as ServeurDisponibiliteHebdo[]

  const dedupedItems = Array.from(
    new Map(
      safeItems.map((item) => [`${item.jour}:${item.creneau}`, item] as const)
    ).values()
  )

  const { error: deleteError } = await supabase
    .from('serveur_disponibilites_hebdo')
    .delete()
    .eq('serveur_id', serveurId)

  if (deleteError) {
    return { ok: false, error: deleteError.message }
  }

  if (dedupedItems.length === 0) {
    return { ok: true }
  }

  const rowsToInsert = dedupedItems.map((item) => ({
    serveur_id: serveurId,
    jour: item.jour,
    creneau: item.creneau,
  }))

  const { error: insertError } = await supabase
    .from('serveur_disponibilites_hebdo')
    .insert(rowsToInsert)

  if (insertError) {
    return { ok: false, error: insertError.message }
  }

  return { ok: true }
}
