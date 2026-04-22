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

function getPriceId(plan: string, cycle: string) {
  if (plan === 'pro') {
    if (cycle === 'semiannual') return Deno.env.get('STRIPE_PRICE_PRO_SEMIANNUAL') ?? ''
    if (cycle === 'annual') return Deno.env.get('STRIPE_PRICE_PRO_ANNUAL') ?? ''
    return Deno.env.get('STRIPE_PRICE_PRO_MONTHLY') ?? ''
  }

  if (plan === 'pro_plus') {
    if (cycle === 'semiannual') return Deno.env.get('STRIPE_PRICE_PRO_PLUS_SEMIANNUAL') ?? ''
    if (cycle === 'annual') return Deno.env.get('STRIPE_PRICE_PRO_PLUS_ANNUAL') ?? ''
    return Deno.env.get('STRIPE_PRICE_PRO_PLUS_MONTHLY') ?? ''
  }

  return ''
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

    const { plan, cycle } = await req.json()
    if (plan !== 'pro' && plan !== 'pro_plus') {
      return new Response(JSON.stringify({ error: 'Invalid plan' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const normalizedCycle = cycle === 'semiannual' || cycle === 'annual' ? cycle : 'monthly'
    const priceId = getPriceId(plan, normalizedCycle)
    if (!priceId) {
      return new Response(JSON.stringify({ error: 'Missing Stripe price id' }), {
        status: 500,
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

    const { data: patron } = await admin
      .from('patrons')
      .select('id, email, prenom')
      .eq('id', user.id)
      .single()

    if (!patron) {
      return new Response(JSON.stringify({ error: 'Patron not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: billingProfile } = await admin
      .from('patron_billing_profiles')
      .select('stripe_customer_id')
      .eq('patron_id', user.id)
      .maybeSingle()

    let customerId = billingProfile?.stripe_customer_id ?? null

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: patron.email ?? user.email ?? undefined,
        name: patron.prenom ?? undefined,
        metadata: {
          patron_id: user.id,
        },
      })
      customerId = customer.id

      await admin.from('patron_billing_profiles').upsert({
        patron_id: user.id,
        stripe_customer_id: customerId,
        current_plan: 'none',
      })
    }

    const successUrl = Deno.env.get('STRIPE_CHECKOUT_SUCCESS_URL') ?? 'renfort://billing-success'
    const cancelUrl = Deno.env.get('STRIPE_CHECKOUT_CANCEL_URL') ?? 'renfort://abonnement'

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      client_reference_id: user.id,
      metadata: {
        patron_id: user.id,
        plan,
        cycle: normalizedCycle,
      },
      subscription_data: {
        metadata: {
          patron_id: user.id,
          plan,
          cycle: normalizedCycle,
        },
      },
    })

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('stripe-create-checkout-session error', error)
    return new Response(JSON.stringify({ error: 'Unable to create checkout session' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
