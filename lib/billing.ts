import { EURO } from './currency'

export type PatronPlanKey = 'none' | 'pro' | 'pro_plus'
export type PatronBillingCycle = 'monthly' | 'semiannual' | 'annual'

export type PatronPlanOffer = {
  key: PatronPlanKey
  title: string
  priceLabel: string
  commissionLabel: string
  ctaLabel: string
  contextLabel?: string
  recommended?: boolean
  monthlyPriceCents: number
  semiannualPriceCents?: number
  annualPriceCents?: number
  flatMissionFeeCents: number
  commissionBps: number
}

export type PatronPlanDisplay = {
  title: string
  priceLabel: string
  commissionLabel: string
  ctaLabel: string
  contextLabel?: string
  badgeLabel?: string
}

export const PATRON_PLAN_OFFERS: Record<PatronPlanKey, PatronPlanOffer> = {
  none: {
    key: 'none',
    title: 'Sans abonnement',
    priceLabel: `10${EURO} / mission`,
    commissionLabel: 'Commission de 10% sur chaque mission réalisée',
    ctaLabel: 'Continuer sans abonnement',
    contextLabel: 'Adapté à un usage ponctuel',
    monthlyPriceCents: 0,
    flatMissionFeeCents: 1_000,
    commissionBps: 1_000,
  },
  pro: {
    key: 'pro',
    title: 'Pro',
    priceLabel: `59${EURO} / mois`,
    commissionLabel: 'Commission de 8% sur chaque mission réalisée',
    ctaLabel: 'Choisir Pro',
    contextLabel: 'Idéal pour gérer vos missions au quotidien',
    recommended: true,
    monthlyPriceCents: 5_900,
    semiannualPriceCents: 29_500,
    annualPriceCents: 59_000,
    flatMissionFeeCents: 0,
    commissionBps: 800,
  },
  pro_plus: {
    key: 'pro_plus',
    title: 'Pro+',
    priceLabel: `119${EURO} / mois`,
    commissionLabel: 'Commission de 5% sur chaque mission réalisée',
    ctaLabel: 'Choisir Pro+',
    contextLabel: 'Le meilleur choix pour les établissements à fort volume',
    monthlyPriceCents: 11_900,
    semiannualPriceCents: 59_500,
    annualPriceCents: 119_000,
    flatMissionFeeCents: 0,
    commissionBps: 500,
  },
}

export function normalizePatronPlan(plan: string | null | undefined): PatronPlanKey {
  if (plan === 'pro') return 'pro'
  if (plan === 'pro_plus') return 'pro_plus'
  return 'none'
}

export function normalizePatronBillingCycle(cycle: string | null | undefined): PatronBillingCycle {
  if (cycle === 'semiannual') return 'semiannual'
  if (cycle === 'annual') return 'annual'
  return 'monthly'
}

export function getPatronPlanOffer(plan: string | null | undefined): PatronPlanOffer {
  return PATRON_PLAN_OFFERS[normalizePatronPlan(plan)]
}

export function formatCentsToEuroLabel(amountCents: number, suffix: string): string {
  const euros = amountCents / 100
  const normalized = Number.isInteger(euros) ? String(euros) : euros.toFixed(2).replace('.', ',')
  return `${normalized}${EURO} / ${suffix}`
}

export function getPatronPlanDisplay(
  plan: string | null | undefined,
  cycle: PatronBillingCycle = 'monthly'
): PatronPlanDisplay {
  const offer = getPatronPlanOffer(plan)

  if (offer.key === 'none') {
    return {
      title: offer.title,
      priceLabel: offer.priceLabel,
      commissionLabel: offer.commissionLabel,
      ctaLabel: offer.ctaLabel,
      contextLabel: offer.contextLabel,
    }
  }

  if (cycle === 'semiannual') {
    return {
      title: offer.title,
      priceLabel: formatCentsToEuroLabel(offer.semiannualPriceCents ?? offer.monthlyPriceCents * 5, '6 mois'),
      commissionLabel: offer.commissionLabel,
      ctaLabel: offer.ctaLabel,
      contextLabel: offer.contextLabel,
      badgeLabel: '1 mois offert',
    }
  }

  if (cycle === 'annual') {
    return {
      title: offer.title,
      priceLabel: formatCentsToEuroLabel(offer.annualPriceCents ?? offer.monthlyPriceCents * 10, 'an'),
      commissionLabel: offer.commissionLabel,
      ctaLabel: offer.ctaLabel,
      contextLabel: offer.contextLabel,
      badgeLabel: '2 mois offert',
    }
  }

  return {
    title: offer.title,
    priceLabel: offer.priceLabel,
    commissionLabel: offer.commissionLabel,
    ctaLabel: offer.ctaLabel,
    contextLabel: offer.contextLabel,
  }
}

export function getPatronPlanLabel(plan: string | null | undefined): string {
  return getPatronPlanOffer(plan).title
}

export type MissionCommissionBreakdown = {
  plan: PatronPlanKey
  missionAmountCents: number
  flatMissionFeeCents: number
  commissionBps: number
  commissionAmountCents: number
  totalPlatformFeeCents: number
}

export function computeMissionCommissionBreakdown(
  missionAmountCents: number,
  plan: string | null | undefined
): MissionCommissionBreakdown {
  const normalizedPlan = normalizePatronPlan(plan)
  const offer = getPatronPlanOffer(normalizedPlan)
  const safeAmount = Math.max(0, Math.round(missionAmountCents))
  const commissionAmountCents = Math.round((safeAmount * offer.commissionBps) / 10_000)
  const totalPlatformFeeCents = offer.flatMissionFeeCents + commissionAmountCents

  return {
    plan: normalizedPlan,
    missionAmountCents: safeAmount,
    flatMissionFeeCents: offer.flatMissionFeeCents,
    commissionBps: offer.commissionBps,
    commissionAmountCents,
    totalPlatformFeeCents,
  }
}
