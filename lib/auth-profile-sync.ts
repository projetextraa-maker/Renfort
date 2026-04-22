import type { User } from '@supabase/supabase-js'
import { buildCanonicalEtablissementWritePayload, fetchEtablissementsForPatron } from './etablissements'
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

type SyncFailure = {
  ok: false
  reason: string
  error?: unknown
}

type SyncSuccess = {
  ok: true
  warning?: 'insert_etablissement_failed'
  etablissementErrorMessage?: string
}

type SyncResult = SyncFailure | SyncSuccess

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

function getErrorMessage(error: unknown) {
  return String(
    (error as any)?.message
    ?? (error as any)?.error_description
    ?? (error as any)?.details
    ?? ''
  )
}

function getErrorCode(error: unknown) {
  return (error as any)?.code ?? null
}

function getErrorDetails(error: unknown) {
  return (error as any)?.details ?? null
}

function getErrorHint(error: unknown) {
  return (error as any)?.hint ?? null
}

async function ensurePatronProfile(user: User, metadata: PatronMetadata): Promise<SyncResult> {
  const { data: existing, error: existingError } = await supabase
    .from('patrons')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (existingError) {
    console.error('ensurePatronProfile existing fetch error', existingError)
    return { ok: false, reason: 'fetch_patron_failed', error: existingError }
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
      return { ok: false, reason: 'upsert_patron_failed', error: upsertError }
    }
  }

  const etablissements = await fetchEtablissementsForPatron(user.id)
  if (etablissements.length === 0) {
    const canonicalPayload = buildCanonicalEtablissementWritePayload({
      user_id: user.id,
      nom: toNullableString(metadata.nom_restaurant) ?? 'Mon etablissement',
      adresse: null,
      ville: toNullableString(metadata.ville) ?? 'Ville a renseigner',
      lat: toNullableNumber(metadata.lat),
      lng: toNullableNumber(metadata.lng),
      is_default: true,
    })

    const etablissementPayload = {
      ...canonicalPayload,
      name: canonicalPayload.nom,
    }

    console.log('ensurePatronProfile etablissement insert payload', etablissementPayload)

    const { error: etablissementError } = await supabase
      .from('etablissements')
      .insert(etablissementPayload)

    if (etablissementError) {
      console.error('ensurePatronProfile etablissement insert error', {
        message: getErrorMessage(etablissementError),
        code: getErrorCode(etablissementError),
        details: getErrorDetails(etablissementError),
        hint: getErrorHint(etablissementError),
        payload: etablissementPayload,
      })

      return {
        ok: true,
        warning: 'insert_etablissement_failed',
        etablissementErrorMessage: getErrorMessage(etablissementError),
      }
    }
  }

  return { ok: true }
}

async function ensureServeurProfile(user: User, metadata: ServeurMetadata): Promise<SyncResult> {
  const { data: existing, error: existingError } = await supabase
    .from('serveurs')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (existingError) {
    console.error('ensureServeurProfile existing fetch error', existingError)
    return { ok: false, reason: 'fetch_serveur_failed', error: existingError }
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
      return { ok: false, reason: 'upsert_serveur_failed', error: upsertError }
    }
  }

  return { ok: true }
}

export async function ensureAccountProfileForUser(user: User | null | undefined): Promise<SyncResult> {
  if (!user) return { ok: false, reason: 'missing_user' }

  const role = normalizeRole(user.user_metadata?.account_role)
  if (!role) return { ok: false, reason: 'missing_role' }

  return role === 'patron'
    ? ensurePatronProfile(user, user.user_metadata as PatronMetadata)
    : ensureServeurProfile(user, user.user_metadata as ServeurMetadata)
}

export async function inspectAccountStateForUser(user: User | null | undefined) {
  if (!user) return { ok: false as const, reason: 'missing_user' }

  const role = normalizeRole(user.user_metadata?.account_role)
  const [
    { data: patronRow, error: patronError },
    { data: serveurRow, error: serveurError },
  ] = await Promise.all([
    supabase.from('patrons').select('id').eq('id', user.id).maybeSingle(),
    supabase.from('serveurs').select('id').eq('id', user.id).maybeSingle(),
  ])

  if (patronError) {
    console.error('inspectAccountStateForUser patron fetch error', patronError)
    return { ok: false as const, reason: 'fetch_patron_failed', error: patronError }
  }

  if (serveurError) {
    console.error('inspectAccountStateForUser serveur fetch error', serveurError)
    return { ok: false as const, reason: 'fetch_serveur_failed', error: serveurError }
  }

  const etablissements = patronRow?.id ? await fetchEtablissementsForPatron(user.id) : []

  return {
    ok: true as const,
    role,
    patronExists: Boolean(patronRow?.id),
    serveurExists: Boolean(serveurRow?.id),
    etablissementCount: etablissements.length,
  }
}
