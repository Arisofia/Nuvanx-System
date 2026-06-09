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
/// <reference lib="deno.ns" />
import { createClient } from '@supabase/supabase-js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-hub-signature-256',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
/* global Deno */

const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VERIFY_TOKEN = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') ?? '';

// New environment variables for Meta Graph API access
const META_ACCESS_TOKEN = Deno.env.get('META_ACCESS_TOKEN') ?? '';
const META_GRAPH_VERSION = Deno.env.get('META_GRAPH_VERSION') ?? 'v22.0';

// Helper functions for normalization
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function normalizePhone(phone: string): string {
  // Remove spaces, dashes, parentheses, and any other non-numeric characters
  return phone.replace(/[\s-()]/g, '').trim();
}

// Helper to extract field from Meta's field_data array
interface MetaFieldData {
  name: string;
  values: string[];
}

function extractMetaField(fieldData: MetaFieldData[], fieldName: string): string | null {
  const field = fieldData.find(f => f.name === fieldName);
  return field?.values?.[0] ?? null;
}

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

        // Find the clinic/user to link the lead to
        // Default: link to the first clinic's admin user
        const { data: users } = await supabase
          .from('users')
          .select('id, clinic_id')
          .not('clinic_id', 'is', null)
          .limit(1);

        const userId   = users?.[0]?.id ?? null;

        if (!userId) {
          errors.push('No user with clinic_id found to link lead to');
          continue;
        }
        
        let metaLeadData: any = null;
        let resolutionStatus: string = 'resolved';
        let metaApiErrorMessage: string | null = null;

        // Fetch real lead data from Meta Graph API
        if (META_ACCESS_TOKEN) {
          try {
            const metaApiUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${leadgenId}?fields=id,created_time,field_data,ad_id,form_id,campaign_id,ad_name,form_name,campaign_name,adset_id,adset_name&access_token=${META_ACCESS_TOKEN}`;
            const metaApiResponse = await fetch(metaApiUrl);
            if (!metaApiResponse.ok) {
              const errorText = await metaApiResponse.text();
              throw new Error(`Meta API error: ${metaApiResponse.status} - ${errorText}`);
            }
            metaLeadData = await metaApiResponse.json();
            console.log('[meta-webhook] Fetched Meta Lead Data:', metaLeadData);

            // Extract field_data
            const fieldData: MetaFieldData[] = metaLeadData.field_data || [];
            const fullName = extractMetaField(fieldData, 'full_name');
            const firstName = extractMetaField(fieldData, 'first_name');
            const lastName = extractMetaField(fieldData, 'last_name');
            const email = extractMetaField(fieldData, 'email');
            const phone = extractMetaField(fieldData, 'phone_number'); // Common field name for phone
            const treatmentInterest = extractMetaField(fieldData, 'treatment_interest'); // Example custom field
            const locationPreference = extractMetaField(fieldData, 'location_preference'); // Example custom field

            metaLeadData.extracted_full_name = fullName;
            metaLeadData.extracted_first_name = firstName;
            metaLeadData.extracted_last_name = lastName;
            metaLeadData.extracted_email = email;
            metaLeadData.extracted_phone = phone;
            metaLeadData.normalized_email = email ? normalizeEmail(email) : null;
            metaLeadData.normalized_phone = phone ? normalizePhone(phone) : null;
            metaLeadData.treatment_interest = treatmentInterest;
            metaLeadData.location_preference = locationPreference;
            metaLeadData.raw_form_answers = fieldData; // Store raw field_data

          } catch (metaError: any) {
            console.error(`[meta-webhook] Error fetching leadgen_id ${leadgenId} from Meta Graph API:`, metaError.message);
            resolutionStatus = 'pending_meta_resolution';
            metaApiErrorMessage = metaError.message;
            // Keep original webhook payload data as fallback
            metaLeadData = {
              id: leadgenId,
              created_time: value?.created_time,
              ad_id: adId,
              form_id: formId,
              campaign_id: campaignId,
              adset_id: adgroupId, // adgroup_id from webhook maps to adset_id in Meta API
              raw_payload: body // Store the original webhook body if Meta API fails
            };
          }
        } else {
          console.warn('[meta-webhook] META_ACCESS_TOKEN not set. Cannot fetch detailed lead data from Meta Graph API.');
          resolutionStatus = 'pending_meta_resolution';
          metaApiErrorMessage = 'META_ACCESS_TOKEN not configured.';
          // Keep original webhook payload data as fallback
          metaLeadData = {
            id: leadgenId,
            created_time: value?.created_time,
            ad_id: adId,
            form_id: formId,
            campaign_id: campaignId,
            adset_id: adgroupId,
            raw_payload: body
          };
        }

        // Prepare data for lead_events and leads tables
        const leadFullName = metaLeadData?.extracted_full_name || metaLeadData?.extracted_first_name || `Meta Lead ${leadgenId.slice(-6)}`;
        const leadEmail = metaLeadData?.extracted_email || '';
        const leadPhone = metaLeadData?.extracted_phone || '';
        const normalizedEmail = metaLeadData?.normalized_email || (leadEmail ? normalizeEmail(leadEmail) : null);
        const normalizedPhone = metaLeadData?.normalized_phone || (leadPhone ? normalizePhone(leadPhone) : null);

        // --------------------------------------------------------------------
        // 2. Upsert into public.lead_events
        // --------------------------------------------------------------------
        const { data: leadEvent, error: leadEventError } = await supabase
          .from('lead_events')
          .upsert({
            meta_lead_id: leadgenId,
            source_channel: 'RRSS',
            channel_label: 'RRSS',
            source_platform: 'meta',
            event_type: 'meta_lead_form',
            attribution_locked: true,
            full_name: leadFullName,
            first_name: metaLeadData?.extracted_first_name,
            last_name: metaLeadData?.extracted_last_name,
            email: leadEmail,
            phone: leadPhone,
            normalized_email: normalizedEmail,
            normalized_phone: normalizedPhone,
            form_id: metaLeadData?.form_id || formId,
            form_name: metaLeadData?.form_name,
            ad_id: metaLeadData?.ad_id || adId,
            ad_name: metaLeadData?.ad_name,
            adset_id: metaLeadData?.adset_id || adgroupId,
            adset_name: metaLeadData?.adset_name,
            campaign_id: metaLeadData?.campaign_id || campaignId,
            campaign_name: metaLeadData?.campaign_name,
            event_created_at: metaLeadData?.created_time ? new Date(metaLeadData.created_time * 1000).toISOString() : createdAt,
            captured_at: createdAt,
            raw_payload: metaLeadData?.raw_payload || body, // Store full Meta API response or original webhook body
            resolution_status: resolutionStatus,
            error_message: metaApiErrorMessage,
            treatment_interest: metaLeadData?.treatment_interest,
            location_preference: metaLeadData?.location_preference,
            raw_form_answers: metaLeadData?.raw_form_answers,
          }, { onConflict: 'meta_lead_id', ignoreDuplicates: false }) // Use meta_lead_id as unique key
          .select()
          .single();

        if (leadEventError) {
          errors.push(`lead_events upsert error for leadgen_id ${leadgenId}: ${leadEventError.message}`);
          // Continue to leads table, but log the error
        }

        // --------------------------------------------------------------------
        // 3. Upsert into public.leads (for dashboard compatibility)
        // --------------------------------------------------------------------
        const { error: leadError } = await supabase
          .from('leads')
          .upsert({
            user_id:     userId,
            name:        leadFullName, // Use real name
            email:       leadEmail,    // Use real email
            phone:       leadPhone,    // Use real phone
            source:      'Meta Lead Form', // Specific source
            stage:       'lead',
            revenue:     0,
            external_id: leadgenId,
            campaign_id: metaLeadData?.campaign_id || campaignId,
            ad_id:       metaLeadData?.ad_id || adId,
            form_id:     metaLeadData?.form_id || formId,
            normalized_email: normalizedEmail,
            normalized_phone: normalizedPhone,
            meta_lead_id: leadgenId,
            meta_form_name: metaLeadData?.form_name,
            meta_ad_name: metaLeadData?.ad_name,
            meta_campaign_name: metaLeadData?.campaign_name,
            meta_adset_id: metaLeadData?.adset_id || adgroupId,
            meta_adset_name: metaLeadData?.adset_name,
          }, { onConflict: 'user_id, external_id', ignoreDuplicates: false })
          .select()
          .single();

        if (leadError) {
          errors.push(`leads upsert error: ${leadError.message}`);
        } else if (leadEvent) { // Only push to ingested if lead was successfully created/updated
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
