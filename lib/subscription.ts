import { supabase } from './supabase'

export type PatronSubscriptionState = {
  abonnement: string | null
}

export function isActiveSubscription(abonnement: string | null | undefined) {
  return abonnement === 'pro' || abonnement === 'pro_plus'
}

export async function syncPatronSubscriptionCycle(patronId: string) {
  const { data, error } = await supabase
    .from('patrons')
    .select('abonnement')
    .eq('id', patronId)
    .single()

  if (error || !data) {
    return { data: null, error }
  }

  return { data, error: null }
}
