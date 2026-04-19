import { supabase } from './supabase'
import type { ServeurExperience } from './serveur-experiences'

function normalizeRow(row: any): ServeurExperience {
  return {
    id: row.id,
    poste: row.poste ?? '',
    duree: row.duree ?? '',
    description: row.description ?? '',
  }
}

export async function fetchServeurExperiences(serveurId: string): Promise<ServeurExperience[]> {
  const { data, error } = await supabase
    .from('serveur_experiences')
    .select('id, poste, duree, description, created_at')
    .eq('serveur_id', serveurId)
    .order('created_at', { ascending: false })

  if (error || !data) {
    console.log('fetchServeurExperiences error', error)
    return []
  }

  return data.map(normalizeRow)
}

export async function replaceServeurExperiences(
  serveurId: string,
  experiences: ServeurExperience[]
): Promise<{ ok: boolean; error?: string }> {
  const sanitized = experiences
    .map((item) => ({
      poste: item.poste.trim(),
      duree: item.duree.trim(),
      description: item.description.trim(),
    }))
    .filter((item) => item.poste && item.duree && item.description)

  const { error: deleteError } = await supabase
    .from('serveur_experiences')
    .delete()
    .eq('serveur_id', serveurId)

  if (deleteError) {
    console.log('replaceServeurExperiences delete error', deleteError)
    return { ok: false, error: deleteError.message }
  }

  if (sanitized.length === 0) {
    return { ok: true }
  }

  const payload = sanitized.map((item) => ({
    serveur_id: serveurId,
    poste: item.poste,
    duree: item.duree,
    description: item.description,
  }))

  const { error: insertError } = await supabase
    .from('serveur_experiences')
    .insert(payload)

  if (insertError) {
    console.log('replaceServeurExperiences insert error', insertError)
    return { ok: false, error: insertError.message }
  }

  return { ok: true }
}
