import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Hook for SEO metrics (replaces hardcoded ~25 DR, ~200 visitas/mes)
export function useSeoMetrics() {
  const [data, setData] = useState<{
    domain_rating: number;
    monthly_visits: number;
    top_10_keywords: number;
    top_30_keywords: number;
    last_updated: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: result, error: err } = await supabase
          .from('v_figma_seo_metrics')
          .select('*')
          .single();
        
        if (err) throw err;
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching SEO metrics');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
}

// Hook for competitive analysis (replaces hardcoded data in slides 24, 25, 26)
export function useCompetitiveAnalysis() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: result, error: err } = await supabase
          .from('v_figma_competitive_analysis')
          .select('*');
        
        if (err) throw err;
        setData(result || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching competitive analysis');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
}

// Hook for clinic scores (replaces tripled array in 21, 34, 00)
export function useClinicScores() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: result, error: err } = await supabase
          .from('v_figma_clinic_scores')
          .select('*');
        
        if (err) throw err;
        setData(result || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching clinic scores');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
}

// Hook for seasonality data (replaces hardcoded 12-month array in 61, 00)
export function useSeasonalityData() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: result, error: err } = await supabase
          .from('v_figma_seasonality_monthly')
          .select('*');
        
        if (err) throw err;
        setData(result || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching seasonality data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
}

// Hook for KPI fallback values (ensures "—" instead of 702, 124, 21)
export function useKpiCurrent() {
  const [data, setData] = useState<{
    total_leads_30d: number;
    booked_30d: number;
    closed_won_30d: number;
    revenue_30d: number;
    data_status: 'connected' | 'error';
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: result, error: err } = await supabase
          .from('v_figma_kpi_current')
          .select('*')
          .single();
        
        if (err) throw err;
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching KPI data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
}
