/**
 * Meta Lead Form Webhook Receiver
 * 
 * Two modes:
 * 1. GET  /meta-webhook?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=CHALLENGE
 *    → Meta webhook verification handshake
 * 2. POST /meta-webhook
 *    → Receives real lead form submissions from Meta
 * 
 * Required Supabase Edge Function Secret:
 *   META_WEBHOOK_VERIFY_TOKEN — set in Supabase Dashboard → Edge Functions → Secrets
 *   (any random string you choose, same one you put in Meta Business Manager)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-hub-signature-256',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VERIFY_TOKEN = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') ?? '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = new URL(req.url);

  // ─────────────────────────────────────────────
  // GET: Meta webhook verification handshake
  // ─────────────────────────────────────────────
  if (req.method === 'GET') {
    const mode      = url.searchParams.get('hub.mode');
    const token     = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[meta-webhook] Verification handshake OK');
      return new Response(challenge ?? 'ok', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    return new Response('Verification failed', { status: 403, headers: cors });
  }

  // ─────────────────────────────────────────────
  // POST: Incoming Meta lead form data
  // ─────────────────────────────────────────────
  if (req.method === 'POST') {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Process each entry in the webhook payload
    const entries: any[] = body?.entry ?? [];
    const ingested: string[] = [];
    const errors: string[] = [];

    for (const entry of entries) {
      const pageId = entry?.id ?? null;
      const changes: any[] = entry?.changes ?? [];

      for (const change of changes) {
        if (change?.field !== 'leadgen') continue;
        const value = change?.value ?? {};

        const leadgenId  = value?.leadgen_id?.toString() ?? null;
        const formId     = value?.form_id?.toString() ?? null;
        const adId       = value?.ad_id?.toString() ?? null;
        const adgroupId  = value?.adgroup_id?.toString() ?? null;
        const campaignId = value?.campaign_id?.toString() ?? null;
        const createdAt  = value?.created_time ? new Date(value.created_time * 1000).toISOString() : new Date().toISOString();

        if (!leadgenId) continue;

        // Upsert into meta_attribution
        const { data: attr, error: attrError } = await supabase
          .from('meta_attribution')
          .upsert({
            leadgen_id:   leadgenId,
            page_id:      pageId,
            form_id:      formId,
            ad_id:        adId,
            adset_id:     adgroupId,
            campaign_id:  campaignId,
            captured_at:  createdAt
          }, { onConflict: 'leadgen_id' })
          .select()
          .single();

        if (attrError) {
          errors.push(`meta_attribution upsert error: ${attrError.message}`);
          continue;
        }

        // Find the clinic/user to link the lead to
        // Default: link to the first clinic's admin user
        const { data: users } = await supabase
          .from('users')
          .select('id, clinic_id')
          .not('clinic_id', 'is', null)
          .limit(1);

        const userId   = users?.[0]?.id ?? null;
        const clinicId = users?.[0]?.clinic_id ?? null;

        if (!userId) {
          errors.push('No user with clinic_id found to link lead to');
          continue;
        }

        // Create the lead record
        const { data: lead, error: leadError } = await supabase
          .from('leads')
          .upsert({
            user_id:     userId,
            name:        `Meta Lead ${leadgenId.slice(-6)}`,
            email:       '',
            phone:       '',
            source:      'Meta Ads',
            stage:       'lead',
            revenue:     0,
            external_id: leadgenId,
            campaign_id: campaignId,
            ad_id:       adId,
            form_id:     formId
          }, { onConflict: 'user_id, external_id', ignoreDuplicates: false })
          .select()
          .single();

        if (leadError) {
          errors.push(`leads upsert error: ${leadError.message}`);
        } else {
          // Link attribution to lead
          if (attr?.id && lead?.id) {
            await supabase
              .from('meta_attribution')
              .update({ lead_id: lead.id })
              .eq('id', attr.id);
          }
          ingested.push(leadgenId);
        }
      }
    }

    console.log(`[meta-webhook] Ingested: ${ingested.length}, Errors: ${errors.length}`);
    if (errors.length > 0) console.error('[meta-webhook] Errors:', errors);

    // Meta requires a 200 response quickly
    return new Response(JSON.stringify({ received: true, ingested: ingested.length }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }

  return new Response('Method not allowed', { status: 405, headers: cors });
});
