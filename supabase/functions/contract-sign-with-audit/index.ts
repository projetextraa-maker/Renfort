import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { corsHeaders } from '../_shared/cors.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function createAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
}

function getClientIp(req: Request): string | null {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || null
  }
  return req.headers.get('x-real-ip') ?? req.headers.get('cf-connecting-ip') ?? null
}

function normalizeContractStatus(value: string | null | undefined) {
  const normalized = String(value ?? '').toLowerCase()
  if (
    normalized === 'draft' ||
    normalized === 'pending_patron_signature' ||
    normalized === 'pending_worker_signature' ||
    normalized === 'signed' ||
    normalized === 'cancelled'
  ) {
    return normalized
  }
  return 'draft'
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

    const { engagementId, actor } = await req.json()
    if (!engagementId || (actor !== 'patron' && actor !== 'worker')) {
      return new Response(JSON.stringify({ error: 'Missing signing payload' }), {
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

    const { data: engagement, error: engagementError } = await admin
      .from('engagements')
      .select('id, mission_id, patron_id, serveur_id')
      .eq('id', engagementId)
      .maybeSingle()

    if (engagementError || !engagement) {
      return new Response(JSON.stringify({ error: 'Engagement not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if ((actor === 'patron' && user.id !== engagement.patron_id) || (actor === 'worker' && user.id !== engagement.serveur_id)) {
      return new Response(JSON.stringify({ error: 'Unauthorized for this signature role' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: contracts, error: contractError } = await admin
      .from('contracts')
      .select(`
        id,
        engagement_id,
        mission_id,
        patron_id,
        serveur_id,
        status,
        patron_signed_at,
        worker_signed_at,
        payload_snapshot
      `)
      .eq('engagement_id', engagementId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (contractError || !contracts?.length) {
      return new Response(JSON.stringify({ error: 'No contract found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const current = contracts[0] as any
    const currentStatus = normalizeContractStatus(current.status)

    if (currentStatus === 'cancelled') {
      return new Response(JSON.stringify({ error: 'Ce contrat est annulé.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!current.payload_snapshot) {
      return new Response(JSON.stringify({ error: 'Le contrat ne peut pas être signé sans snapshot métier.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (currentStatus === 'signed') {
      return new Response(JSON.stringify({ ok: true, changed: false, status: currentStatus }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (actor === 'patron' && current.patron_signed_at) {
      return new Response(JSON.stringify({ ok: true, changed: false, status: currentStatus }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (actor === 'worker' && current.worker_signed_at) {
      return new Response(JSON.stringify({ ok: true, changed: false, status: currentStatus }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const nowIso = new Date().toISOString()
    const nextPatronSignedAt = actor === 'patron' ? nowIso : current.patron_signed_at
    const nextWorkerSignedAt = actor === 'worker' ? nowIso : current.worker_signed_at
    let nextStatus = 'draft'

    if (nextPatronSignedAt && nextWorkerSignedAt) nextStatus = 'signed'
    else if (nextPatronSignedAt) nextStatus = 'pending_worker_signature'
    else if (nextWorkerSignedAt) nextStatus = 'pending_patron_signature'

    const patch: Record<string, unknown> = {
      status: nextStatus,
      patron_signed_at: nextPatronSignedAt,
      worker_signed_at: nextWorkerSignedAt,
    }

    const userAgent = req.headers.get('user-agent') ?? null
    const ipAddress = getClientIp(req)

    if (actor === 'patron') {
      patch.patron_signed_by_user_id = user.id
      patch.patron_sign_role = 'patron'
      patch.patron_signature_ip = ipAddress
      patch.patron_signature_user_agent = userAgent
    } else {
      patch.worker_signed_by_user_id = user.id
      patch.worker_sign_role = 'worker'
      patch.worker_signature_ip = ipAddress
      patch.worker_signature_user_agent = userAgent
    }

    const { error: updateError } = await admin
      .from('contracts')
      .update(patch)
      .eq('id', current.id)

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message || 'Unable to save signature' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({
      ok: true,
      changed: true,
      contractId: current.id,
      status: nextStatus,
      signedAt: nowIso,
      actor,
      ipAddress,
      userAgent,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('contract-sign-with-audit error', error)
    return new Response(JSON.stringify({
      error: error?.message || 'Unexpected contract signing error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
