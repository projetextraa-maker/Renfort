import { supabase } from './supabase'

export type SaveEvaluationInput = {
  serveurId: string
  missionId: string
  patronId: string
  note: number
  commentaire: string | null
}

export type EvaluationRecente = {
  id: string
  mission_id: string
  patron_id?: string
  note: number
  commentaire: string
  created_at: string
  mission_poste?: string
  mission_date?: string
}

export type MissionEvaluationStatus = {
  status: 'pending' | 'rated'
  note: number | null
  evaluationId: string | null
  createdAt: string | null
}

function buildAvisKey(item: { mission_id?: string | null; patron_id?: string | null; id?: string | null }): string {
  return `${item.mission_id ?? item.id ?? 'unknown'}::${item.patron_id ?? 'unknown'}`
}

export async function syncServeurRatingFromAvis(serveurId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('avis')
    .select('id, mission_id, patron_id, note, created_at')
    .eq('serveur_id', serveurId)

  if (error) {
    console.log('syncServeurRatingFromAvis full error', error)
    throw error
  }

  const latestAvisByKey = new Map<string, any>()
  ;(data ?? []).forEach((item: any) => {
    const key = buildAvisKey(item)
    const existing = latestAvisByKey.get(key)
    if (!existing) {
      latestAvisByKey.set(key, item)
      return
    }

    const existingDate = new Date(existing.created_at ?? 0).getTime()
    const currentDate = new Date(item.created_at ?? 0).getTime()
    if (currentDate >= existingDate) {
      latestAvisByKey.set(key, item)
    }
  })

  const notes = Array.from(latestAvisByKey.values())
    .map((item: any) => Number(item.note))
    .filter((note: number) => Number.isFinite(note))

  const moyenne = notes.length > 0
    ? Math.round((notes.reduce((sum, note) => sum + note, 0) / notes.length) * 10) / 10
    : null

  const { error: updateError } = await supabase
    .from('serveurs')
    .update({ score: moyenne })
    .eq('id', serveurId)

  if (updateError) {
    console.log('syncServeurRatingFromAvis update error', updateError)
    throw updateError
  }

  return moyenne
}

export async function saveEvaluation({
  serveurId,
  missionId,
  patronId,
  note,
  commentaire,
}: SaveEvaluationInput): Promise<void> {
  const payload = {
    note,
    commentaire: commentaire?.trim() || null,
    serveur_id: serveurId,
    patron_id: patronId,
    mission_id: missionId,
  }

  console.log('saveEvaluation payload', payload)

  const { data: existingRows, error: existingError } = await supabase
    .from('avis')
    .select('id, created_at')
    .eq('serveur_id', serveurId)
    .eq('patron_id', patronId)
    .eq('mission_id', missionId)
    .order('created_at', { ascending: false })

  if (existingError) {
    console.log('saveEvaluation existing lookup error', existingError)
    throw existingError
  }

  if ((existingRows?.length ?? 0) > 1) {
    console.log('saveEvaluation duplicate rows detected', existingRows)
  }

  const existing = existingRows?.[0]

  if (existing?.id) {
    const { error } = await supabase
      .from('avis')
      .update({
        note: payload.note,
        commentaire: payload.commentaire,
      })
      .eq('id', existing.id)

    if (error) {
      console.log('saveEvaluation full error', error)
      throw error
    }

    await syncServeurRatingFromAvis(serveurId)
    return
  }

  const { error } = await supabase
    .from('avis')
    .insert(payload)

  if (error) {
    console.log('saveEvaluation full error', error)
    throw error
  }

  await syncServeurRatingFromAvis(serveurId)
}

export async function fetchRecentEvaluations(
  serveurId: string,
  limit: number = 5
): Promise<EvaluationRecente[]> {
  const { data, error } = await supabase
    .from('avis')
    .select('id, mission_id, patron_id, note, commentaire, created_at')
    .eq('serveur_id', serveurId)
    .not('commentaire', 'is', null)
    .neq('commentaire', '')
    .order('created_at', { ascending: false })
    .limit(limit * 3)

  if (error || !data?.length) {
    if (error) {
      console.log('fetchRecentEvaluations full error', error)
    }
    return []
  }

  const dedupedDataMap = new Map<string, any>()
  ;(data ?? []).forEach((item: any) => {
    const key = buildAvisKey(item)
    if (!dedupedDataMap.has(key)) {
      dedupedDataMap.set(key, item)
    }
  })

  const dedupedData = Array.from(dedupedDataMap.values()).slice(0, limit)
  const missionIds = [...new Set(dedupedData.map((item: any) => item.mission_id).filter(Boolean))]
  let missionMap: Record<string, { poste?: string; date?: string }> = {}

  if (missionIds.length > 0) {
    const { data: missions } = await supabase
      .from('annonces')
      .select('id, poste, date')
      .in('id', missionIds)

    missionMap = Object.fromEntries(
      (missions ?? []).map((mission: any) => [
        mission.id,
        { poste: mission.poste, date: mission.date },
      ])
    )
  }

  return dedupedData.map((item: any) => ({
    id: item.id,
    mission_id: item.mission_id,
    patron_id: item.patron_id,
    note: item.note,
    commentaire: item.commentaire,
    created_at: item.created_at,
    mission_poste: missionMap[item.mission_id]?.poste,
    mission_date: missionMap[item.mission_id]?.date,
  }))
}

export async function fetchPatronMissionEvaluationMap(
  patronId: string,
  missionIds: string[]
): Promise<Record<string, MissionEvaluationStatus>> {
  const uniqueMissionIds = [...new Set(missionIds.filter(Boolean))]
  if (!patronId || uniqueMissionIds.length === 0) return {}

  const { data, error } = await supabase
    .from('avis')
    .select('id, mission_id, patron_id, note, created_at')
    .eq('patron_id', patronId)
    .in('mission_id', uniqueMissionIds)
    .order('created_at', { ascending: false })

  if (error) {
    console.log('fetchPatronMissionEvaluationMap error', error)
    return {}
  }

  const latestByMission = new Map<string, any>()
  ;(data ?? []).forEach((item: any) => {
    const missionId = String(item.mission_id ?? '')
    if (!missionId || latestByMission.has(missionId)) return
    latestByMission.set(missionId, item)
  })

  const map: Record<string, MissionEvaluationStatus> = {}
  uniqueMissionIds.forEach((missionId) => {
    const existing = latestByMission.get(missionId)
    map[missionId] = existing
      ? {
          status: 'rated',
          note: Number.isFinite(Number(existing.note)) ? Number(existing.note) : null,
          evaluationId: existing.id ? String(existing.id) : null,
          createdAt: existing.created_at ?? null,
        }
      : {
          status: 'pending',
          note: null,
          evaluationId: null,
          createdAt: null,
        }
  })

  return map
}
