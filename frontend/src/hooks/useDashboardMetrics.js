/**
 * useDashboardMetrics — React hook for live KPI data from the Figma Supabase project.
 *
 * Loads dashboard_metrics on mount and subscribes to real-time UPDATE events so
 * the UI reflects changes instantly whenever the backend sync runs.
 *
 * Subscription channel: 'dashboard-metrics-changes'
 * Event type: postgres_changes / UPDATE on public.dashboard_metrics
 * Filter: id=eq.nuvanx-main
 *
 * Falls back gracefully when Supabase Figma is not configured.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  isFigmaSupabaseAvailable,
  loadDashboardMetrics,
  subscribeToDashboardMetrics,
} from '../lib/supabase/figmaClient';

const DEFAULT_METRICS = {
  id: 'nuvanx-main',
  label: 'Nuvanx KPIs',
  total_leads: 0,
  total_revenue: 0,
  connected_integrations: 0,
  total_integrations: 0,
  leads_lead: 0,
  leads_whatsapp: 0,
  leads_appointment: 0,
  leads_treatment: 0,
  leads_closed: 0,
  hubspot_status: 'disconnected',
  meta_status: 'disconnected',
  whatsapp_status: 'disconnected',
  github_status: 'disconnected',
  openai_status: 'disconnected',
  gemini_status: 'disconnected',
  last_sync: null,
  updated_at: null,
};

/**
 * Primary hook — returns live dashboard metrics with loading/error state.
 *
 * @returns {{ metrics: object, loading: boolean, error: string|null, reload: () => void }}
 */
export function useDashboardMetrics() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!isFigmaSupabaseAvailable()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const data = await loadDashboardMetrics();
    if (data) setMetrics(data);
    else setError('dashboard_metrics unavailable');
    setLoading(false);
  }, []);

  useEffect(() => {
    // load() is an async data-fetcher — setState calls inside it are intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const unsub = subscribeToDashboardMetrics((updated) => setMetrics(updated));
    return unsub;
  }, [load]);

  return { metrics, loading, error, reload: load };
}

/**
 * Convenience hook — always returns a metrics object (never null).
 * Uses DEFAULT_METRICS until the real data arrives.
 *
 * @returns {{ metrics: object, loading: boolean, isLive: boolean }}
 */
export function useMetricsWithDefaults() {
  const { metrics, loading, error } = useDashboardMetrics();
  return {
    metrics: metrics ?? DEFAULT_METRICS,
    loading,
    isLive: !!metrics && !error,
  };
}
