import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import Stripe from 'npm:stripe@16.5.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { corsHeaders } from '../_shared/cors.ts'
import { normalizePatronPlan } from '../_shared/billing.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-06-20',
})

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function createAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
}

function resolvePlanFromPrice(priceId: string | null | undefined) {
  if (!priceId) return 'none'
  if (priceId === (Deno.env.get('STRIPE_PRICE_PRO_MONTHLY') ?? '')) return 'pro'
  if (priceId === (Deno.env.get('STRIPE_PRICE_PRO_SEMIANNUAL') ?? '')) return 'pro'
  if (priceId === (Deno.env.get('STRIPE_PRICE_PRO_ANNUAL') ?? '')) return 'pro'
  if (priceId === (Deno.env.get('STRIPE_PRICE_PRO_PLUS_MONTHLY') ?? '')) return 'pro_plus'
  if (priceId === (Deno.env.get('STRIPE_PRICE_PRO_PLUS_SEMIANNUAL') ?? '')) return 'pro_plus'
  if (priceId === (Deno.env.get('STRIPE_PRICE_PRO_PLUS_ANNUAL') ?? '')) return 'pro_plus'
  return 'none'
}

async function upsertBillingState(admin: ReturnType<typeof createAdminClient>, params: {
  patronId: string
  customerId?: string | null
  subscriptionId?: string | null
  priceId?: string | null
  status?: string | null
  cancelAtPeriodEnd?: boolean | null
  currentPeriodEnd?: number | null
}) {
  const plan = normalizePatronPlan(resolvePlanFromPrice(params.priceId))
  const subscriptionActive = params.status === 'active' || params.status === 'trialing'

  await admin.from('patron_billing_profiles').upsert({
    patron_id: params.patronId,
    stripe_customer_id: params.customerId ?? null,
    stripe_subscription_id: params.subscriptionId ?? null,
    stripe_price_id: params.priceId ?? null,
    stripe_status: params.status ?? null,
    cancel_at_period_end: Boolean(params.cancelAtPeriodEnd),
    current_plan: subscriptionActive ? plan : 'none',
    current_period_end: params.currentPeriodEnd ? new Date(params.currentPeriodEnd * 1000).toISOString() : null,
  })

  await admin
    .from('patrons')
    .update({
      abonnement: subscriptionActive ? plan : null,
      cancel_at_period_end: Boolean(params.cancelAtPeriodEnd),
      current_period_end: params.currentPeriodEnd ? new Date(params.currentPeriodEnd * 1000).toISOString() : null,
    })
    .eq('id', params.patronId)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const signature = req.headers.get('stripe-signature')
    if (!signature || !webhookSecret) {
      return new Response('Missing Stripe signature', { status: 400, headers: corsHeaders })
    }

    const body = await req.text()
    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret)
    const admin = createAdminClient()

    const { data: existingEvent } = await admin
      .from('stripe_webhook_events')
      .select('stripe_event_id')
      .eq('stripe_event_id', event.id)
      .maybeSingle()

    if (existingEvent) {
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await admin.from('stripe_webhook_events').insert({
      stripe_event_id: event.id,
      event_type: event.type,
      payload: event,
    })

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const patronId = String(session.metadata?.patron_id ?? session.client_reference_id ?? '').trim()
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null

      if (patronId && subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const item = subscription.items.data[0]
        await upsertBillingState(admin, {
          patronId,
          customerId: typeof subscription.customer === 'string' ? subscription.customer : null,
          subscriptionId: subscription.id,
          priceId: item?.price?.id ?? null,
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          currentPeriodEnd: subscription.current_period_end,
        })
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
      const subscription = event.data.object as Stripe.Subscription
      const patronId = String(subscription.metadata?.patron_id ?? '').trim()
      const item = subscription.items.data[0]
      if (patronId) {
        await upsertBillingState(admin, {
          patronId,
          customerId: typeof subscription.customer === 'string' ? subscription.customer : null,
          subscriptionId: subscription.id,
          priceId: item?.price?.id ?? null,
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          currentPeriodEnd: subscription.current_period_end,
        })
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription
      const patronId = String(subscription.metadata?.patron_id ?? '').trim()
      if (patronId) {
        await upsertBillingState(admin, {
          patronId,
          customerId: typeof subscription.customer === 'string' ? subscription.customer : null,
          subscriptionId: subscription.id,
          priceId: null,
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          currentPeriodEnd: null,
        })
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('stripe-webhook error', error)
    return new Response('Webhook error', { status: 400, headers: corsHeaders })
  }
})
