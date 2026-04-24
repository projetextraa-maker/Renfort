import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import Stripe from 'npm:stripe@16.5.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { corsHeaders } from '../_shared/cors.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-06-20',
})

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TEST_CURRENCY = 'eur'

function createAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
}

function mapStripeIntentStatusToMissionPaymentStatus(status: Stripe.PaymentIntent.Status) {
  switch (status) {
    case 'requires_capture':
      return 'authorized_hold'
    case 'succeeded':
      return 'released'
    case 'canceled':
      return 'blocked'
    default:
      return 'not_authorized'
  }
}

function parseTimeToMinutes(value: string | null | undefined): number | null {
  const raw = String(value ?? '').trim()
  const match = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

function computeMissionDurationHours(start: string | null | undefined, end: string | null | undefined): number | null {
  const startMinutes = parseTimeToMinutes(start)
  const endMinutes = parseTimeToMinutes(end)
  if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) return null
  return (endMinutes - startMinutes) / 60
}

function computeAmountCents(input: {
  agreedHourlyRate: number | null
  missionHourlyRate: number | null
  startTime: string | null | undefined
  endTime: string | null | undefined
}): number | null {
  const hourlyRate = input.agreedHourlyRate ?? input.missionHourlyRate
  const durationHours = computeMissionDurationHours(input.startTime, input.endTime)
  if (hourlyRate == null || !Number.isFinite(hourlyRate) || hourlyRate <= 0 || durationHours == null) {
    return null
  }
  const amount = Math.round(hourlyRate * durationHours * 100)
  return amount > 0 ? amount : null
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
      .select('id, patron_id, statut, payment_intent_id, payment_status, salaire, heure_debut, heure_fin')
      .eq('id', missionId)
      .eq('patron_id', user.id)
      .maybeSingle()

    if (missionError || !mission) {
      return new Response(JSON.stringify({ error: 'Mission not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (mission.payment_intent_id) {
      return new Response(
        JSON.stringify({
          ok: true,
          alreadyExists: true,
          missionId: mission.id,
          paymentIntentId: mission.payment_intent_id,
          paymentStatus: mission.payment_status ?? null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    const { data: billingProfile } = await admin
      .from('patron_billing_profiles')
      .select('stripe_customer_id, default_payment_method_id')
      .eq('patron_id', user.id)
      .maybeSingle()

    if (!billingProfile?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'No Stripe customer found for patron' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!billingProfile?.default_payment_method_id) {
      return new Response(JSON.stringify({ error: 'No default payment method found for patron' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: engagement } = await admin
      .from('engagements')
      .select('id, agreed_hourly_rate, status')
      .eq('mission_id', mission.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const amountCents = computeAmountCents({
      agreedHourlyRate:
        engagement?.agreed_hourly_rate != null && Number.isFinite(Number(engagement.agreed_hourly_rate))
          ? Number(engagement.agreed_hourly_rate)
          : null,
      missionHourlyRate:
        mission.salaire != null && Number.isFinite(Number(mission.salaire))
          ? Number(mission.salaire)
          : null,
      startTime: mission.heure_debut,
      endTime: mission.heure_fin,
    })

    if (!amountCents) {
      return new Response(JSON.stringify({ error: 'Unable to compute mission payment amount from final hourly rate' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let paymentIntent: Stripe.PaymentIntent
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: TEST_CURRENCY,
        customer: billingProfile.stripe_customer_id,
        payment_method: billingProfile.default_payment_method_id,
        confirm: true,
        off_session: true,
        capture_method: 'manual',
        description: `Mission ${mission.id}`,
        metadata: {
          mission_id: mission.id,
          patron_id: user.id,
          engagement_id: engagement?.id ? String(engagement.id) : '',
          hourly_rate_brut: String(engagement?.agreed_hourly_rate ?? mission.salaire ?? ''),
          mvp: 'mission_runtime_amount',
        },
      })
    } catch (error: any) {
      const message =
        error?.message ||
        error?.raw?.message ||
        'Unable to create mission payment intent'

      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const nowIso = new Date().toISOString()
    const mappedPaymentStatus = mapStripeIntentStatusToMissionPaymentStatus(paymentIntent.status)

    const annoncePatch: Record<string, unknown> = {
      payment_intent_id: paymentIntent.id,
      payment_status: mappedPaymentStatus,
    }

    if (paymentIntent.status === 'requires_capture' || paymentIntent.status === 'succeeded') {
      annoncePatch.payment_authorized_at = nowIso
    }

    if (paymentIntent.status === 'succeeded') {
      annoncePatch.payment_released_at = nowIso
    }

    if (paymentIntent.status === 'canceled') {
      annoncePatch.payment_blocked_at = nowIso
    }

    const { error: updateError } = await admin
      .from('annonces')
      .update(annoncePatch)
      .eq('id', mission.id)
      .eq('patron_id', user.id)

    if (updateError) {
      return new Response(
        JSON.stringify({
          error: updateError.message || 'PaymentIntent created but mission update failed',
          paymentIntentId: paymentIntent.id,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    return new Response(
      JSON.stringify({
        ok: true,
        missionId: mission.id,
        amountCents,
        currency: TEST_CURRENCY,
        paymentIntentId: paymentIntent.id,
        stripeStatus: paymentIntent.status,
        missionPaymentStatus: mappedPaymentStatus,
        captureMethod: paymentIntent.capture_method,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    console.error('stripe-create-mission-payment-intent error', error)
    return new Response(
      JSON.stringify({
        error: error?.message || 'Unexpected mission payment intent error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
