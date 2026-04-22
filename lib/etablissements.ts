import { supabase } from './supabase'

export type Etablissement = {
  id: string
  user_id: string
  nom: string
  adresse: string | null
  ville: string
  lat: number | null
  lng: number | null
  is_default: boolean
  created_at?: string | null
  updated_at?: string | null
  last_used_at?: string | null
}

export type EtablissementDraftInput = {
  user_id: string
  nom: string
  adresse: string | null
  ville: string
  lat: number | null
  lng: number | null
  is_default: boolean
}

type CanonicalEtablissementRow = {
  id: string
  user_id: string | null
  nom: string | null
  adresse: string | null
  ville: string | null
  lat: number | null
  lng: number | null
  is_default: boolean | null
  created_at?: string | null
  updated_at?: string | null
  last_used_at?: string | null
}

type LegacyEtablissementRow = {
  id: string
  patron_id: string | null
  name: string | null
  address: string | null
  city: string | null
  lat: number | null
  lng: number | null
  is_primary: boolean | null
  created_at?: string | null
  updated_at?: string | null
  last_used_at?: string | null
}

export function buildEtablissementWritePayload(input: EtablissementDraftInput) {
  return {
    user_id: input.user_id,
    nom: input.nom,
    // Compatibility write while some environments still enforce legacy columns.
    name: input.nom,
    adresse: input.adresse,
    address: input.adresse,
    ville: input.ville,
    city: input.ville,
    lat: input.lat,
    lng: input.lng,
    is_default: input.is_default,
    is_primary: input.is_default,
  }
}

export function buildCanonicalEtablissementWritePayload(input: EtablissementDraftInput) {
  return {
    user_id: input.user_id,
    nom: input.nom,
    adresse: input.adresse,
    ville: input.ville,
    lat: input.lat,
    lng: input.lng,
    is_default: input.is_default,
  }
}

function normalizeCanonicalRow(row: CanonicalEtablissementRow): Etablissement | null {
  if (!row.id || !row.user_id || !row.nom || !row.ville) return null

  return {
    id: row.id,
    user_id: row.user_id,
    nom: row.nom,
    adresse: row.adresse ?? null,
    ville: row.ville,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    is_default: Boolean(row.is_default),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    last_used_at: row.last_used_at ?? null,
  }
}

function normalizeLegacyRow(row: LegacyEtablissementRow, userId: string): Etablissement | null {
  if (!row.id) return null

  const nom = row.name?.trim()
  const ville = row.city?.trim()
  if (!nom || !ville) return null

  return {
    id: row.id,
    user_id: row.patron_id ?? userId,
    nom,
    adresse: row.address ?? null,
    ville,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    is_default: Boolean(row.is_primary),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    last_used_at: row.last_used_at ?? null,
  }
}

function mergeEtablissements(items: Etablissement[]): Etablissement[] {
  const byId = new Map<string, Etablissement>()

  items.forEach((item) => {
    const previous = byId.get(item.id)
    if (!previous) {
      byId.set(item.id, item)
      return
    }

    byId.set(item.id, {
      ...previous,
      ...item,
      nom: item.nom || previous.nom,
      adresse: item.adresse ?? previous.adresse,
      ville: item.ville || previous.ville,
      user_id: item.user_id || previous.user_id,
      is_default: item.is_default || previous.is_default,
      created_at: item.created_at ?? previous.created_at ?? null,
      updated_at: item.updated_at ?? previous.updated_at ?? null,
      last_used_at: item.last_used_at ?? previous.last_used_at ?? null,
    })
  })

  return Array.from(byId.values()).sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1
    if (a.last_used_at && b.last_used_at) return String(b.last_used_at).localeCompare(String(a.last_used_at))
    if (a.last_used_at) return -1
    if (b.last_used_at) return 1
    return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  })
}

export async function fetchEtablissementsForPatron(userId: string): Promise<Etablissement[]> {
  const merged: Etablissement[] = []

  const { data: canonicalData } = await supabase
    .from('etablissements')
    .select('id, user_id, nom, adresse, ville, lat, lng, is_default, created_at, updated_at, last_used_at')
    .eq('user_id', userId)

  ;(canonicalData ?? []).forEach((row: any) => {
    const normalized = normalizeCanonicalRow(row as CanonicalEtablissementRow)
    if (normalized) merged.push(normalized)
  })

  const { data: legacyData } = await supabase
    .from('etablissements')
    .select('id, patron_id, name, address, city, lat, lng, is_primary, created_at, last_used_at')
    .eq('patron_id', userId)

  ;(legacyData ?? []).forEach((row: any) => {
    const normalized = normalizeLegacyRow(row as LegacyEtablissementRow, userId)
    if (normalized) merged.push(normalized)
  })

  return mergeEtablissements(merged)
}

export function getDefaultEtablissement(etablissements: Etablissement[]): Etablissement | null {
  if (etablissements.length === 0) return null
  return etablissements.find((item) => item.is_default) ?? etablissements[0]
}

export function getPreferredEtablissement(etablissements: Etablissement[]): Etablissement | null {
  if (etablissements.length === 0) return null
  const byLastUsed = etablissements.find((item) => item.last_used_at)
  return byLastUsed ?? getDefaultEtablissement(etablissements)
}

export async function setDefaultEtablissement(
  userId: string,
  etablissementId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const etablissements = await fetchEtablissementsForPatron(userId)
  if (etablissements.length === 0) {
    return { ok: false, error: 'Aucun etablissement trouve.' }
  }

  for (const item of etablissements) {
    const { error } = await supabase
      .from('etablissements')
      .update({
        user_id: userId,
        is_default: item.id === etablissementId,
      })
      .eq('id', item.id)

    if (error) return { ok: false, error: error.message }
  }

  return { ok: true }
}

export async function touchEtablissementLastUsed(
  userId: string,
  etablissementId: string
): Promise<void> {
  await supabase
    .from('etablissements')
    .update({ user_id: userId, last_used_at: new Date().toISOString() })
    .eq('id', etablissementId)
}

export async function fetchEtablissementNameMapByIds(ids: string[]): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (uniqueIds.length === 0) return {}

  const map: Record<string, string> = {}

  const { data: canonicalData } = await supabase
    .from('etablissements')
    .select('id, nom')
    .in('id', uniqueIds)

  ;(canonicalData ?? []).forEach((row: any) => {
    if (row?.id && row?.nom) {
      map[String(row.id)] = String(row.nom)
    }
  })

  const missingIds = uniqueIds.filter((id) => !map[id])
  if (missingIds.length === 0) return map

  const { data: legacyData } = await supabase
    .from('etablissements')
    .select('id, name')
    .in('id', missingIds)

  ;(legacyData ?? []).forEach((row: any) => {
    if (row?.id && row?.name) {
      map[String(row.id)] = String(row.name)
    }
  })

  return map
}

export async function fetchEtablissementById(id: string): Promise<Etablissement | null> {
  if (!id) return null

  const { data: canonicalData } = await supabase
    .from('etablissements')
    .select('id, user_id, nom, adresse, ville, lat, lng, is_default, created_at, updated_at, last_used_at')
    .eq('id', id)
    .maybeSingle()

  const canonical = canonicalData
    ? normalizeCanonicalRow(canonicalData as CanonicalEtablissementRow)
    : null

  if (canonical) return canonical

  const { data: legacyData } = await supabase
    .from('etablissements')
    .select('id, patron_id, name, address, city, lat, lng, is_primary, created_at, updated_at, last_used_at')
    .eq('id', id)
    .maybeSingle()

  if (!legacyData) return null

  return normalizeLegacyRow(
    legacyData as LegacyEtablissementRow,
    String((legacyData as LegacyEtablissementRow).patron_id ?? '')
  )
}
