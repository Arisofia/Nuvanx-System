/**
 * Supabase client for Figma design-system data (dashboard_metrics, figma_tokens).
 *
 * Reads from nuvanx-prod (ssvvuuysgxyqvmovrlvk) — the single source of truth.
 * VITE_SUPABASE_FIGMA_URL / VITE_SUPABASE_FIGMA_ANON_KEY are kept for back-compat
 * but fall back to the main VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY so the
 * frontend works out of the box without a separate Figma Supabase project.
 */

import { createClient } from '@supabase/supabase-js';

const figmaUrl =
  import.meta.env.VITE_SUPABASE_FIGMA_URL ||
  import.meta.env.VITE_SUPABASE_URL;
const figmaAnonKey =
  import.meta.env.VITE_SUPABASE_FIGMA_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!figmaUrl || !figmaAnonKey) {
  console.warn(
    '[Supabase Figma] No Supabase URL/key configured. ' +
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env.',
  );
}

export const supabaseFigma =
  figmaUrl && figmaAnonKey
    ? createClient(figmaUrl, figmaAnonKey)
    : null;

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value, fallback = 'disconnected') {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function normalizeMetricsRow(row) {
  if (!row || typeof row !== 'object') return null;

  return {
    ...row,
    id: row.id || 'nuvanx-main',
    total_leads: asNumber(row.total_leads),
    total_revenue: asNumber(row.total_revenue),
    connected_integrations: asNumber(row.connected_integrations),
    total_integrations: asNumber(row.total_integrations),
    leads_lead: asNumber(row.leads_lead),
    leads_whatsapp: asNumber(row.leads_whatsapp),
    leads_appointment: asNumber(row.leads_appointment),
    leads_treatment: asNumber(row.leads_treatment),
    leads_closed: asNumber(row.leads_closed),
    hubspot_status: asString(row.hubspot_status),
    meta_status: asString(row.meta_status),
    whatsapp_status: asString(row.whatsapp_status),
    github_status: asString(row.github_status),
    openai_status: asString(row.openai_status),
    gemini_status: asString(row.gemini_status),
  };
}

/** Returns true when the Figma Supabase project is configured and available. */
export function isFigmaSupabaseAvailable() {
  return supabaseFigma !== null;
}

/**
 * Fetch the current dashboard_metrics row (id = 'nuvanx-main').
 * Falls back to null if the table is unavailable.
 *
 * @returns {Promise<object|null>}
 */
export async function loadDashboardMetrics() {
  if (!supabaseFigma) return null;

  // 1. Try the flat dashboard_metrics row (preferred — single read, realtime-subscribed)
  const { data, error } = await supabaseFigma
    .from('dashboard_metrics')
    .select('*')
    .eq('id', 'nuvanx-main')
    .single();
  if (!error && data) return normalizeMetricsRow(data);

  // 2. Fallback: assemble from figma_tokens KV pairs (always up-to-date via figmaSync)
  //    This path is used when dashboard_metrics hasn't been created yet in the Figma project.
  const tokens = await loadKPITokens();
  if (!tokens || Object.keys(tokens).length === 0) return null;

  const int = (k, d = 0) => parseInt(tokens[k] ?? String(d), 10);
  const flt = (k, d = 0) => parseFloat(tokens[k] ?? String(d));
  const str = (k, d = 'disconnected') => tokens[k] ?? d;

  return {
    id: 'nuvanx-main',
    label: 'Nuvanx KPIs',
    total_leads: int('total_leads'),
    total_revenue: flt('total_revenue'),
    connected_integrations: int('connected_integrations'),
    total_integrations: int('total_integrations'),
    leads_lead: int('leads_lead'),
    leads_whatsapp: int('leads_whatsapp'),
    leads_appointment: int('leads_appointment'),
    leads_treatment: int('leads_treatment'),
    leads_closed: int('leads_closed'),
    hubspot_status: str('hubspot_status'),
    meta_status: str('meta_status'),
    whatsapp_status: str('whatsapp_status'),
    github_status: str('github_status'),
    openai_status: str('openai_status'),
    gemini_status: str('gemini_status'),
    last_sync: null,
    updated_at: null,
  };
}

/**
 * Fetch all KPI tokens from figma_tokens (token_type = 'kpi').
 * Returns an object keyed by token name, e.g. { total_leads: '8', ... }
 *
 * @returns {Promise<Record<string,string>>}
 */
export async function loadKPITokens() {
  if (!supabaseFigma) return {};
  const { data, error } = await supabaseFigma
    .from('figma_tokens')
    .select('name, value')
    .eq('token_type', 'kpi');
  if (error) {
    console.error('[Supabase Figma] loadKPITokens error:', error.message);
    return {};
  }
  return Object.fromEntries((data || []).map((r) => [r.name, r.value]));
}

/**
 * Subscribe to live updates on the dashboard_metrics table.
 * Uses postgres_changes so any UPDATE to the nuvanx-main row fires the callback.
 *
 * @param {(metrics: object) => void} onUpdate  Called with the new row on every UPDATE.
 * @returns {() => void}  Call to unsubscribe (remove the channel).
 *
 * @example
 *   const unsub = subscribeToDashboardMetrics((m) => setMetrics(m));
 *   // later:
 *   unsub();
 */
export function subscribeToDashboardMetrics(onUpdate) {
  if (!supabaseFigma) return () => {};

  const channel = supabaseFigma
    .channel('dashboard-metrics-changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'dashboard_metrics',
        filter: 'id=eq.nuvanx-main',
      },
      (payload) => {
        const normalized = normalizeMetricsRow(payload.new);
        if (normalized) onUpdate(normalized);
      },
    )
    .subscribe();

  return () => supabaseFigma.removeChannel(channel);
}

