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

    const { paymentMethodId, setupIntentId } = await req.json()

    if (!paymentMethodId || !setupIntentId) {
      return new Response(JSON.stringify({ error: 'Missing payment method payload' }), {
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

    const { data: billingProfile } = await admin
      .from('patron_billing_profiles')
      .select('stripe_customer_id, current_plan')
      .eq('patron_id', user.id)
      .maybeSingle()

    if (!billingProfile?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'No Stripe customer found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const setupIntent = await stripe.setupIntents.retrieve(String(setupIntentId))
    const setupIntentCustomerId =
      typeof setupIntent.customer === 'string' ? setupIntent.customer : null
    const setupIntentPaymentMethodId =
      typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id ?? null

    if (setupIntent.status !== 'succeeded') {
      return new Response(JSON.stringify({ error: 'SetupIntent not succeeded yet' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (setupIntentCustomerId !== billingProfile.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'SetupIntent customer mismatch' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (setupIntentPaymentMethodId !== paymentMethodId) {
      return new Response(JSON.stringify({ error: 'SetupIntent payment method mismatch' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const paymentMethod = await stripe.paymentMethods.retrieve(String(paymentMethodId))
    const paymentMethodCustomerId =
      typeof paymentMethod.customer === 'string' ? paymentMethod.customer : null

    if (!paymentMethodCustomerId) {
      await stripe.paymentMethods.attach(String(paymentMethodId), {
        customer: billingProfile.stripe_customer_id,
      })
    } else if (paymentMethodCustomerId !== billingProfile.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'Payment method belongs to another customer' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await stripe.customers.update(billingProfile.stripe_customer_id, {
      invoice_settings: {
        default_payment_method: String(paymentMethodId),
      },
    })

    const card = paymentMethod.type === 'card' ? paymentMethod.card : null

    await admin.from('patron_billing_profiles').upsert({
      patron_id: user.id,
      stripe_customer_id: billingProfile.stripe_customer_id,
      current_plan: billingProfile.current_plan ?? 'none',
      default_payment_method_id: String(paymentMethodId),
      default_payment_method_brand: card?.brand ?? null,
      default_payment_method_last4: card?.last4 ?? null,
      default_payment_method_exp_month: card?.exp_month ?? null,
      default_payment_method_exp_year: card?.exp_year ?? null,
    })

    return new Response(
      JSON.stringify({
        paymentMethod: {
          id: String(paymentMethodId),
          brand: card?.brand ?? null,
          last4: card?.last4 ?? null,
          expMonth: card?.exp_month ?? null,
          expYear: card?.exp_year ?? null,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('stripe-save-patron-payment-method error', error)
    return new Response(JSON.stringify({ error: 'Unable to save payment method' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
