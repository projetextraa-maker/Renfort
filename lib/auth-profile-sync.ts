import type { User } from '@supabase/supabase-js'
import { buildEtablissementWritePayload, fetchEtablissementsForPatron } from './etablissements'
import { buildReferralCode } from './referrals'
import { supabase } from './supabase'

type SupportedRole = 'patron' | 'serveur'

type PatronMetadata = {
  nom_restaurant?: string | null
  prenom?: string | null
  telephone?: string | null
  code_postal?: string | null
  ville?: string | null
  lat?: number | string | null
  lng?: number | string | null
}

type ServeurMetadata = {
  prenom?: string | null
  nom?: string | null
  telephone?: string | null
  code_postal?: string | null
  ville?: string | null
  lat?: number | string | null
  lng?: number | string | null
  rayon?: number | string | null
  referred_by?: string | null
}

function normalizeRole(metadataRole: unknown): SupportedRole | null {
  return metadataRole === 'patron' || metadataRole === 'serveur' ? metadataRole : null
}

function toNullableString(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized.length > 0 ? normalized : null
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toNullableUuid(value: unknown) {
  const normalized = toNullableString(value)
  if (!normalized) return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null
}

async function ensurePatronProfile(user: User, metadata: PatronMetadata) {
  const { data: existing, error: existingError } = await supabase
    .from('patrons')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (existingError) {
    console.error('ensurePatronProfile existing fetch error', existingError)
    return { ok: false as const, reason: 'fetch_patron_failed', error: existingError }
  }

  if (!existing?.id) {
    const payload = {
      id: user.id,
      nom_restaurant: toNullableString(metadata.nom_restaurant),
      prenom: toNullableString(metadata.prenom),
      email: user.email ?? null,
      telephone: toNullableString(metadata.telephone),
      code_postal: toNullableString(metadata.code_postal),
      ville: toNullableString(metadata.ville),
      lat: toNullableNumber(metadata.lat),
      lng: toNullableNumber(metadata.lng),
    }

    const { error: upsertError } = await supabase.from('patrons').upsert(payload)
    if (upsertError) {
      console.error('ensurePatronProfile upsert error', upsertError, payload)
      return { ok: false as const, reason: 'upsert_patron_failed', error: upsertError }
    }
  }

  const etablissements = await fetchEtablissementsForPatron(user.id)
  if (etablissements.length === 0) {
    const { error: etablissementError } = await supabase
      .from('etablissements')
      .insert(
        buildEtablissementWritePayload({
          user_id: user.id,
          nom: toNullableString(metadata.nom_restaurant) ?? 'Mon établissement',
          adresse: null,
          ville: toNullableString(metadata.ville) ?? 'Ville à renseigner',
          lat: toNullableNumber(metadata.lat),
          lng: toNullableNumber(metadata.lng),
          is_default: true,
        })
      )

    if (etablissementError) {
      console.error('ensurePatronProfile etablissement insert error', etablissementError)
      return { ok: false as const, reason: 'insert_etablissement_failed', error: etablissementError }
    }
  }

  return { ok: true as const }
}

async function ensureServeurProfile(user: User, metadata: ServeurMetadata) {
  const { data: existing, error: existingError } = await supabase
    .from('serveurs')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (existingError) {
    console.error('ensureServeurProfile existing fetch error', existingError)
    return { ok: false as const, reason: 'fetch_serveur_failed', error: existingError }
  }

  if (!existing?.id) {
    const payload = {
      id: user.id,
      prenom: toNullableString(metadata.prenom),
      nom: toNullableString(metadata.nom),
      email: user.email ?? null,
      telephone: toNullableString(metadata.telephone),
      code_postal: toNullableString(metadata.code_postal),
      ville: toNullableString(metadata.ville),
      lat: toNullableNumber(metadata.lat),
      lng: toNullableNumber(metadata.lng),
      rayon: toNullableNumber(metadata.rayon) ?? 50,
      referral_code: buildReferralCode(String(metadata.prenom ?? ''), user.id),
      referred_by: toNullableUuid(metadata.referred_by),
    }

    const { error: upsertError } = await supabase.from('serveurs').upsert(payload)
    if (upsertError) {
      console.error('ensureServeurProfile upsert error', upsertError, payload)
      return { ok: false as const, reason: 'upsert_serveur_failed', error: upsertError }
    }
  }

  return { ok: true as const }
}

export async function ensureAccountProfileForUser(user: User | null | undefined) {
  if (!user) return { ok: false as const, reason: 'missing_user' }

  const role = normalizeRole(user.user_metadata?.account_role)
  if (!role) return { ok: false as const, reason: 'missing_role' }

  return role === 'patron'
    ? ensurePatronProfile(user, user.user_metadata as PatronMetadata)
    : ensureServeurProfile(user, user.user_metadata as ServeurMetadata)
}
