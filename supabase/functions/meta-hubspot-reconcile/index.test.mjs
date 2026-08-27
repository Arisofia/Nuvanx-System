import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/meta-hubspot-reconcile/index.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260827203500_meta_hubspot_commercial_reconciliation.sql', 'utf8');

describe('Meta → HubSpot commercial reconciliation', () => {
  it('accepts only service-role calls and keeps PII out of the response summary', () => {
    expect(source).toContain('requireServiceRole(req)');
    expect(source).toContain('return json(403');
    expect(source).toContain('processed: results.length');
    expect(source).not.toContain('results,\n  });');
  });

  it('requires canonical Facebook Lead Ads lineage before creating a projection', () => {
    expect(source).toContain('hs_object_source_label');
    expect(source).toContain('PAID_SOCIAL');
    expect(source).toContain('hs_analytics_source_data_1');
    expect(source).toContain('facebook');
    expect(source).toContain('HubSpot contact is not canonical Facebook Lead Ads lineage');
  });

  it('suppresses QA/test contacts and bounds unmatched retries', () => {
    expect(source).toContain('nvx_is_test_lead');
    expect(source).toContain('test@meta.com');
    expect(source).toContain('dummy data');
    expect(source).toContain('const MAX_ATTEMPTS = 6');
    expect(source).toContain('unmatched_terminal');
    expect(source).toContain('failed_terminal');
  });

  it('maps only explicit interest data and never turns an ad angle into treatment', () => {
    expect(source).toContain('interes_principal_del_tratamiento');
    expect(source).toContain('metaInterest(lead.raw_field_data)');
    expect(source).toContain('treatment_name');
    expect(source).not.toContain('meta_ad_name');
    expect(source).not.toContain('campaign_name');
  });

  it('suppresses repeat-contact opportunities instead of creating duplicate Deals', () => {
    expect(source).toContain('existingLeadForContact');
    expect(source).toContain('status: "duplicate_suppressed"');
    expect(source).toContain('duplicate_of_lead_id: duplicateLeadId');
    expect(source).toContain('duplicates_suppressed: results.filter');
    expect(migration).toContain("'duplicate_suppressed'");
    expect(migration).toContain('duplicate_of_lead_id uuid references public.leads(id)');
  });

  it('uses the existing governed owner and idempotent deal projection key', () => {
    expect(source).toContain('HUBSPOT_DEFAULT_DEAL_OWNER_ID');
    expect(source).toContain('hubspot_deal_projections');
    expect(source).toContain('{ onConflict: "lead_id" }');
    expect(source).toContain('projection_status: "pending"');
  });

  it('uses immediate nonblocking wakeups plus an idle-aware 3x/day fallback', () => {
    expect(migration).toContain("nvx_try_dispatch_revops_worker('meta-hubspot-reconcile', 25, null)");
    expect(migration).toContain("'0 4,12,20 * * *'");
    expect(migration).toContain("where status in ('pending', 'unmatched', 'failed')");
    expect(migration).toContain('and attempt_count < 6');
  });

  it('keeps acquisition wakeups narrow while re-queuing existing Deals on real commercial changes', () => {
    expect(migration).toContain('after insert or update of email, phone, source, deleted_at');
    expect(migration).not.toContain('after insert or update of email, phone, hubspot_contact_id');
    expect(migration).toContain('create or replace function public.nvx_requeue_deal_on_commercial_change()');
    expect(migration).toContain('lead_commercial_change_requeue_deal');
    expect(migration).toContain("set projection_status = 'pending'");
    expect(migration).toContain('first_response_at, first_outbound_at, first_inbound_at');
    expect(migration).toContain('verified_revenue, revenue, lost_reason, stage_canonical');
  });

  it('persists an append-only non-PII commercial event ledger and service-role funnel views', () => {
    expect(migration).toContain('create table if not exists public.lead_commercial_events');
    expect(migration).toContain('event_key text not null unique');
    expect(migration).toContain('grant select, insert on table public.lead_commercial_events to service_role');
    expect(migration).not.toContain('grant select, insert, update, delete on table public.lead_commercial_events');
    expect(migration).toContain('public.vw_meta_commercial_funnel');
    expect(migration).toContain('public.vw_meta_commercial_funnel_metrics');
    expect(migration).toContain("'synced'");
    expect(migration).toContain("'routed'");
    expect(migration).toContain("'deal_created'");
    expect(migration).toContain("'valuation_scheduled'");
    expect(migration).toContain("'valuation_attended'");
  });

  it('uses the existing per-lead response SLA for routing observability instead of inventing another SLA', () => {
    expect(migration).toContain('coalesce(l.first_response_sla_minutes, 30) as routing_sla_minutes');
    expect(migration).toContain('routing_sla_breached');
    expect(migration).toContain('routing_latency_minutes');
  });
});
