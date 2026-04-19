import { supabase } from './supabase'
import { computeServeurMissionStatsFromAnnonces, computeServeurMissionStatsMap } from './serveur-stats'

const REFERRAL_MILESTONES = [
  { milestone: 1, rewardAmount: 5 },
  { milestone: 3, rewardAmount: 5 },
  { milestone: 5, rewardAmount: 10 },
] as const

function sanitizeCodePart(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
}

export function normalizeReferralCode(code: string) {
  return sanitizeCodePart(code).slice(0, 16)
}

export function buildReferralCode(firstName: string, userId: string) {
  const base = sanitizeCodePart(firstName).slice(0, 6) || 'RENFORT'
  const suffix = sanitizeCodePart(userId).slice(-4) || '0000'
  return `${base}${suffix}`
}

export async function resolveReferrerIdFromCode(code: string) {
  const normalizedCode = normalizeReferralCode(code)
  if (!normalizedCode) return { referrerId: null, normalizedCode: '' }

  const { data, error } = await supabase
    .from('serveurs')
    .select('id, referral_code')
    .eq('referral_code', normalizedCode)
    .maybeSingle()

  if (error) {
    console.error('resolveReferrerIdFromCode error', error)
    return { referrerId: null, normalizedCode }
  }

  return { referrerId: data?.id ?? null, normalizedCode }
}

export async function syncReferralRewardsForReferredUser(referredUserId: string) {
  const { data: referredUser, error: referredError } = await supabase
    .from('serveurs')
    .select('id, referred_by')
    .eq('id', referredUserId)
    .maybeSingle()

  if (referredError) {
    console.error('syncReferralRewardsForReferredUser referred user error', referredError)
    return
  }

  if (!referredUser?.referred_by) return

  const { completedMissions } = await computeServeurMissionStatsFromAnnonces(referredUserId)

  const { data: existingRewards, error: rewardsError } = await supabase
    .from('referral_rewards')
    .select('milestone')
    .eq('referrer_user_id', referredUser.referred_by)
    .eq('referred_user_id', referredUserId)

  if (rewardsError) {
    console.error('syncReferralRewardsForReferredUser rewards fetch error', rewardsError)
    return
  }

  const existingMilestones = new Set((existingRewards ?? []).map((item: any) => Number(item.milestone)))

  for (const milestoneConfig of REFERRAL_MILESTONES) {
    if (completedMissions < milestoneConfig.milestone) continue
    if (existingMilestones.has(milestoneConfig.milestone)) continue

    const { error: insertError } = await supabase
      .from('referral_rewards')
      .upsert(
        {
          referrer_user_id: referredUser.referred_by,
          referred_user_id: referredUserId,
          milestone: milestoneConfig.milestone,
          reward_amount: milestoneConfig.rewardAmount,
        },
        {
          onConflict: 'referrer_user_id,referred_user_id,milestone',
          ignoreDuplicates: true,
        }
      )

    if (insertError) {
      console.error('syncReferralRewardsForReferredUser insert error', insertError)
    }
  }
}

export async function fetchReferralOverview(referrerUserId: string) {
  const { data: referredUsers, error: referredUsersError } = await supabase
    .from('serveurs')
    .select('id, prenom, nom, created_at')
    .eq('referred_by', referrerUserId)
    .order('created_at', { ascending: false })

  if (referredUsersError) {
    console.error('fetchReferralOverview referred users error', referredUsersError)
  }

  const { data: rewards, error: rewardsError } = await supabase
    .from('referral_rewards')
    .select('id, referred_user_id, milestone, reward_amount, rewarded_at')
    .eq('referrer_user_id', referrerUserId)
    .order('rewarded_at', { ascending: false })

  if (rewardsError) {
    console.error('fetchReferralOverview rewards error', rewardsError)
  }

  const rewardMap = new Map<string, { milestone: number; reward_amount: number; rewarded_at: string | null }[]>()

  ;(rewards ?? []).forEach((reward: any) => {
    const key = String(reward.referred_user_id)
    const current = rewardMap.get(key) ?? []
    current.push({
      milestone: Number(reward.milestone ?? 0),
      reward_amount: Number(reward.reward_amount ?? 0),
      rewarded_at: reward.rewarded_at ?? null,
    })
    rewardMap.set(key, current)
  })

  const statsMap = await computeServeurMissionStatsMap(
    (referredUsers ?? []).map((user: any) => String(user.id))
  )

  const filleuls = (referredUsers ?? []).map((user: any) => {
    const completed = statsMap[String(user.id)]?.completedMissions ?? 0
    const rewardsForUser = rewardMap.get(String(user.id)) ?? []
    const totalEarned = rewardsForUser.reduce((sum, item) => sum + item.reward_amount, 0)

    return {
      id: String(user.id),
      prenom: user.prenom ?? '',
      nom: user.nom ?? '',
      missionsRealisees: completed,
      progressLabel: `${Math.min(completed, 5)}/5`,
      totalEarned,
      rewards: rewardsForUser,
    }
  })

  const totalEarned = filleuls.reduce((sum, item) => sum + item.totalEarned, 0)

  return {
    filleuls,
    totalEarned,
    referredCount: filleuls.length,
    milestones: REFERRAL_MILESTONES,
  }
}
