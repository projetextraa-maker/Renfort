import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import Stripe from 'npm:stripe@16.5.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { corsHeaders } from '../_shared/cors.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-06-20',
})

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function createAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
}

async function recordCompletedMissionFee(admin: ReturnType<typeof createAdminClient>, missionId: string, missionAmountCents: number) {
  try {
    const { data, error } = await admin.functions.invoke('stripe-record-completed-mission-fee', {
      body: { missionId, missionAmountCents },
    })

    if (error || data?.error) {
      console.error('stripe-capture-mission-payment-intent billing record error', {
        missionId,
        error: error?.message ?? data?.error ?? null,
      })
    }
  } catch (error: any) {
    console.error('stripe-capture-mission-payment-intent billing record unexpected error', {
      missionId,
      error: error?.message ?? String(error),
    })
  }
}

async function markMissionCaptureFailed(admin: ReturnType<typeof createAdminClient>, missionId: string) {
  const nowIso = new Date().toISOString()
  await admin
    .from('annonces')
    .update({
      payment_status: 'capture_failed',
      payment_blocked_at: nowIso,
    })
    .eq('id', missionId)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { missionId } = await req.json()
    if (!missionId) {
      return new Response(JSON.stringify({ error: 'Missing missionId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createAdminClient()
    const token = authHeader.replace('Bearer ', '')
    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token)

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: mission, error: missionError } = await admin
      .from('annonces')
      .select('id, patron_id, serveur_id, payment_intent_id, payment_status, check_out_confirmed_at, checked_out_at')
      .eq('id', missionId)
      .maybeSingle()

    if (missionError || !mission) {
      return new Response(JSON.stringify({ error: 'Mission not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (user.id !== mission.patron_id && user.id !== mission.serveur_id) {
      return new Response(JSON.stringify({ error: 'Unauthorized for this mission' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!mission.check_out_confirmed_at || !mission.checked_out_at) {
      return new Response(JSON.stringify({ error: 'Mission checkout not fully confirmed yet' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!mission.payment_intent_id) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'missing_payment_intent' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (mission.payment_status === 'captured') {
      return new Response(JSON.stringify({
        ok: true,
        alreadyCaptured: true,
        missionId: mission.id,
        paymentIntentId: mission.payment_intent_id,
        missionPaymentStatus: mission.payment_status,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(String(mission.payment_intent_id))

    if (paymentIntent.status === 'succeeded') {
      const nowIso = new Date().toISOString()
      await admin
        .from('annonces')
        .update({
          payment_status: 'captured',
          payment_released_at: nowIso,
        })
        .eq('id', mission.id)

      await recordCompletedMissionFee(admin, mission.id, Number(paymentIntent.amount ?? 0))

      return new Response(JSON.stringify({
        ok: true,
        alreadyCaptured: true,
        missionId: mission.id,
        paymentIntentId: paymentIntent.id,
        stripeStatus: paymentIntent.status,
        missionPaymentStatus: 'captured',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (paymentIntent.status !== 'requires_capture') {
      await markMissionCaptureFailed(admin, mission.id)
      return new Response(JSON.stringify({
        error: `PaymentIntent not capturable: ${paymentIntent.status}`,
        paymentIntentId: paymentIntent.id,
        stripeStatus: paymentIntent.status,
        missionPaymentStatus: 'capture_failed',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let capturedIntent: Stripe.PaymentIntent
    try {
      capturedIntent = await stripe.paymentIntents.capture(paymentIntent.id)
    } catch (error: any) {
      console.error('stripe-capture-mission-payment-intent capture error', {
        missionId: mission.id,
        paymentIntentId: paymentIntent.id,
        error: error?.message ?? String(error),
      })
      await markMissionCaptureFailed(admin, mission.id)
      return new Response(JSON.stringify({
        error: error?.message || 'Unable to capture payment intent',
        paymentIntentId: paymentIntent.id,
        missionPaymentStatus: 'capture_failed',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const nowIso = new Date().toISOString()

    const { error: updateError } = await admin
      .from('annonces')
      .update({
        payment_status: 'captured',
        payment_released_at: nowIso,
      })
      .eq('id', mission.id)

    if (updateError) {
      return new Response(JSON.stringify({
        error: updateError.message || 'Payment captured but mission update failed',
        paymentIntentId: capturedIntent.id,
        stripeStatus: capturedIntent.status,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await recordCompletedMissionFee(admin, mission.id, Number(capturedIntent.amount ?? 0))

    return new Response(JSON.stringify({
      ok: true,
      missionId: mission.id,
      paymentIntentId: capturedIntent.id,
      stripeStatus: capturedIntent.status,
      missionPaymentStatus: 'captured',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('stripe-capture-mission-payment-intent error', error)
    return new Response(
      JSON.stringify({
        error: error?.message || 'Unexpected mission payment capture error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
