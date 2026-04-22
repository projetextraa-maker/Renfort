import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { corsHeaders } from '../_shared/cors.ts'
import { computeMissionCommissionBreakdown } from '../_shared/billing.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function createAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
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
      .select('id, patron_id, statut')
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

    const { data: billingRecord, error: billingError } = await admin
      .from('mission_billing_records')
      .upsert({
        mission_id: mission.id,
        patron_id: mission.patron_id,
        plan_at_billing: breakdown.plan,
        mission_amount_cents: breakdown.missionAmountCents,
        flat_mission_fee_cents: breakdown.flatMissionFeeCents,
        commission_bps: breakdown.commissionBps,
        commission_amount_cents: breakdown.commissionAmountCents,
        total_platform_fee_cents: breakdown.totalPlatformFeeCents,
        status: 'pending',
      }, { onConflict: 'mission_id' })
      .select('*')
      .single()

    if (billingError) {
      return new Response(JSON.stringify({ error: 'Unable to record mission fee' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ billingRecord, breakdown }), {
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
