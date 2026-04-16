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

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeMetrics(input) {
  const source = input && typeof input === 'object' ? input : {};

  return {
    ...DEFAULT_METRICS,
    ...source,
    total_leads: toNumber(source.total_leads, DEFAULT_METRICS.total_leads),
    total_revenue: toNumber(source.total_revenue, DEFAULT_METRICS.total_revenue),
    connected_integrations: toNumber(source.connected_integrations, DEFAULT_METRICS.connected_integrations),
    total_integrations: toNumber(source.total_integrations, DEFAULT_METRICS.total_integrations),
    leads_lead: toNumber(source.leads_lead, DEFAULT_METRICS.leads_lead),
    leads_whatsapp: toNumber(source.leads_whatsapp, DEFAULT_METRICS.leads_whatsapp),
    leads_appointment: toNumber(source.leads_appointment, DEFAULT_METRICS.leads_appointment),
    leads_treatment: toNumber(source.leads_treatment, DEFAULT_METRICS.leads_treatment),
    leads_closed: toNumber(source.leads_closed, DEFAULT_METRICS.leads_closed),
  };
}

/**
 * Primary hook — returns live dashboard metrics with loading/error state.
 *
 * @returns {{ metrics: object, loading: boolean, error: string|null, reload: () => void }}
 */
export function useDashboardMetrics() {
  const available = isFigmaSupabaseAvailable();
  const [metrics, setMetrics] = useState(DEFAULT_METRICS);
  const [loading, setLoading] = useState(available);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!isFigmaSupabaseAvailable()) return;
    setLoading(true);
    setError(null);
    const data = await loadDashboardMetrics();
    if (data) setMetrics(normalizeMetrics(data));
    else setError('dashboard_metrics unavailable');
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!available) return;

    let cancelled = false;

    (async () => {
      const data = await loadDashboardMetrics();
      if (cancelled) return;
      if (data) setMetrics(normalizeMetrics(data));
      else setError('dashboard_metrics unavailable');
      setLoading(false);
    })();

    const unsub = subscribeToDashboardMetrics((updated) => setMetrics(normalizeMetrics(updated)));

    return () => {
      cancelled = true;
      unsub();
    };
  }, [available]);

  return { metrics, loading, error, reload };
}

/**
 * Convenience hook — always returns a metrics object (never null).
 * Uses DEFAULT_METRICS until the real data arrives.
 *
 * @returns {{ metrics: object, loading: boolean, isLive: boolean }}
 */
export function useMetricsWithDefaults() {
  const { metrics, loading, error } = useDashboardMetrics();
  const safeMetrics = normalizeMetrics(metrics);
  return {
    metrics: safeMetrics,
    loading,
    isLive: !error,
  };
}
