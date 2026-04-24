import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { corsHeaders } from '../_shared/cors.ts'
import { computeMissionCommissionBreakdown } from '../_shared/billing.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function createAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
}

async function isLaunchOfferEligible(admin: ReturnType<typeof createAdminClient>, patronId: string, missionId: string) {
  const { data: patron, error: patronError } = await admin
    .from('patrons')
    .select('id, launch_offer_used_at')
    .eq('id', patronId)
    .maybeSingle()

  if (patronError || !patron) {
    console.error('launch-offer:patron error', patronError)
    return false
  }

  if (patron.launch_offer_used_at) return false

  const { data: existingMission } = await admin
    .from('annonces')
    .select('id, launch_offer_applied')
    .eq('id', missionId)
    .maybeSingle()

  if (existingMission?.launch_offer_applied === true) return true

  const { count: usedOffersCount, error: usedOffersCountError } = await admin
    .from('patrons')
    .select('id', { count: 'exact', head: true })
    .not('launch_offer_used_at', 'is', null)

  if (usedOffersCountError) {
    console.error('launch-offer:used-count error', usedOffersCountError)
    return false
  }

  if ((usedOffersCount ?? 0) >= 30) return false

  return true
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { missionId, missionAmountCents } = await req.json()
    if (!missionId || !Number.isFinite(Number(missionAmountCents))) {
      return new Response(JSON.stringify({ error: 'Missing mission billing payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createAdminClient()
    const { data: mission, error: missionError } = await admin
      .from('annonces')
      .select('id, patron_id, statut, launch_offer_applied')
      .eq('id', missionId)
      .single()

    if (missionError || !mission) {
      return new Response(JSON.stringify({ error: 'Mission not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!['completed', 'terminee'].includes(String(mission.statut))) {
      return new Response(JSON.stringify({ error: 'Mission not completed yet' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: billingProfile } = await admin
      .from('patron_billing_profiles')
      .select('current_plan')
      .eq('patron_id', mission.patron_id)
      .maybeSingle()

    const breakdown = computeMissionCommissionBreakdown(
      Number(missionAmountCents),
      billingProfile?.current_plan ?? 'none'
    )

    const launchOfferEligible = await isLaunchOfferEligible(admin, mission.patron_id, mission.id)
    const finalBreakdown = launchOfferEligible
      ? {
          ...breakdown,
          flatMissionFeeCents: 0,
          commissionAmountCents: 0,
          totalPlatformFeeCents: 0,
        }
      : breakdown

    const { error: missionUpdateError } = await admin
      .from('annonces')
      .update({
        launch_offer_applied: launchOfferEligible ? true : mission.launch_offer_applied ?? false,
      })
      .eq('id', mission.id)

    if (missionUpdateError) {
      return new Response(JSON.stringify({ error: 'Unable to record mission launch offer state' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (launchOfferEligible) {
      const nowIso = new Date().toISOString()
      const { error: patronUpdateError } = await admin
        .from('patrons')
        .update({ launch_offer_used_at: nowIso })
        .eq('id', mission.patron_id)
        .is('launch_offer_used_at', null)

      if (patronUpdateError) {
        console.error('launch-offer:mark-used error', patronUpdateError)
      }
    }

    return new Response(JSON.stringify({ missionId: mission.id, breakdown: finalBreakdown, launchOfferApplied: launchOfferEligible }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('stripe-record-completed-mission-fee error', error)
    return new Response(JSON.stringify({ error: 'Unexpected mission billing error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
