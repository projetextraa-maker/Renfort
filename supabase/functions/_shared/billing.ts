export type PatronPlanKey = 'none' | 'pro' | 'pro_plus'

export function normalizePatronPlan(plan: string | null | undefined): PatronPlanKey {
  if (plan === 'pro') return 'pro'
  if (plan === 'pro_plus') return 'pro_plus'
  return 'none'
}

export function getPlanCommissionConfig(plan: string | null | undefined) {
  const normalizedPlan = normalizePatronPlan(plan)

  if (normalizedPlan === 'pro') {
    return { plan: normalizedPlan, flatMissionFeeCents: 0, commissionBps: 800 }
  }
  if (normalizedPlan === 'pro_plus') {
    return { plan: normalizedPlan, flatMissionFeeCents: 0, commissionBps: 500 }
  }

  return { plan: normalizedPlan, flatMissionFeeCents: 1000, commissionBps: 1000 }
}

export function computeMissionCommissionBreakdown(missionAmountCents: number, plan: string | null | undefined) {
  const config = getPlanCommissionConfig(plan)
  const safeAmount = Math.max(0, Math.round(missionAmountCents))
  const commissionAmountCents = Math.round((safeAmount * config.commissionBps) / 10_000)
  const totalPlatformFeeCents = config.flatMissionFeeCents + commissionAmountCents

  return {
    ...config,
    missionAmountCents: safeAmount,
    commissionAmountCents,
    totalPlatformFeeCents,
  }
}
