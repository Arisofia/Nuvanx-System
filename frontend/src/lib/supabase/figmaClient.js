/**
 * Supabase client for the Figma V.1 project (zpowfbeftxexzidlxndy).
 *
 * Used for features tied to Figma design-system data stored in this
 * separate Supabase project.
 *
 * Required environment variables (set in frontend/.env):
 *   VITE_SUPABASE_FIGMA_URL      — e.g. https://zpowfbeftxexzidlxndy.supabase.co
 *   VITE_SUPABASE_FIGMA_ANON_KEY — public anon key from Figma project → Settings → API
 */

import { createClient } from '@supabase/supabase-js';

const figmaUrl = import.meta.env.VITE_SUPABASE_FIGMA_URL;
const figmaAnonKey = import.meta.env.VITE_SUPABASE_FIGMA_ANON_KEY;

if (!figmaUrl || !figmaAnonKey) {
  console.warn(
    '[Supabase Figma] VITE_SUPABASE_FIGMA_URL or VITE_SUPABASE_FIGMA_ANON_KEY is not set. ' +
      'Figma project features will be disabled.',
  );
}

export const supabaseFigma =
  figmaUrl && figmaAnonKey
    ? createClient(figmaUrl, figmaAnonKey)
    : null;

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
  const { data, error } = await supabaseFigma
    .from('dashboard_metrics')
    .select('*')
    .eq('id', 'nuvanx-main')
    .single();
  if (error) {
    console.error('[Supabase Figma] loadDashboardMetrics error:', error.message);
    return null;
  }
  return data;
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
        if (payload.new) onUpdate(payload.new);
      },
    )
    .subscribe();

  return () => supabaseFigma.removeChannel(channel);
}

