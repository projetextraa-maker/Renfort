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

    const { data: patron, error: patronError } = await admin
      .from('patrons')
      .select('id, email, prenom')
      .eq('id', user.id)
      .single()

    if (patronError || !patron) {
      return new Response(JSON.stringify({ error: 'Patron not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: billingProfile } = await admin
      .from('patron_billing_profiles')
      .select('stripe_customer_id, current_plan')
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
        current_plan: billingProfile?.current_plan ?? 'none',
      })
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: {
        patron_id: user.id,
      },
    })

    return new Response(
      JSON.stringify({
        clientSecret: setupIntent.client_secret,
        customerId,
        setupIntentId: setupIntent.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('stripe-create-patron-setup-intent error', error)
    return new Response(JSON.stringify({ error: 'Unable to create setup intent' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
