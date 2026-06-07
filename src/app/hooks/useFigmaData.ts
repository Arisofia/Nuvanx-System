import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ============================================================================
// TYPES
// ============================================================================

export interface ExecutiveSummary {
  leads_30d: number;
  conversions_30d: number;
  revenue_30d: number;
  active_channels: number;
  updated_at: string;
}

export interface CampaignPerformance {
  campaign_name: string;
  source: string;
  medium: string;
  total_leads: number;
  conversions: number;
  conversion_rate: number;
  total_revenue: number;
  last_activity: string;
}

export interface ChannelPerformance {
  channel: string;
  total_leads: number;
  conversions: number;
  conversion_rate: number;
  qualified_leads: number;
  last_activity: string;
}

export interface MonthlyTrend {
  month: string;
  leads: number;
  conversions: number;
  conversion_rate: number;
  revenue: number;
  active_channels: number;
}

export interface DataHealth {
  metric: string;
  total_records: number;
  records_7d: number;
  records_30d: number;
  last_update: string;
}

export interface DoctoraliPerformance {
  total_patients: number;
  new_patients_30d: number;
  new_patients_7d: number;
  months_active: number;
  last_patient_date: string;
}

export interface LeadSourceDistribution {
  source: string;
  total_leads: number;
  percentage: number;
  conversions: number;
  conversion_rate: number;
}

export interface ConversionFunnel {
  stage: string;
  count: number;
  percentage: number;
}

export interface MetaPerformance {
  date: string;
  leads: number;
  conversions: number;
  last_update: string;
}

export interface GoogleAdsPerformance {
  date: string;
  leads: number;
  conversions: number;
  last_update: string;
}

export interface HubSpotIntegration {
  total_forms_submitted: number;
  forms_7d: number;
  forms_30d: number;
  forms_converted: number;
  last_submission: string;
}

// ============================================================================
// CACHE CONFIGURATION
// ============================================================================

const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();

const getCachedData = <T>(key: string): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (Date.now() - entry.timestamp > CACHE_DURATION) {
    cache.delete(key);
    return null;
  }
  
  return entry.data;
};

const setCachedData = <T>(key: string, data: T): void => {
  cache.set(key, {
    data,
    timestamp: Date.now(),
  });
};

// ============================================================================
// EXECUTIVE SUMMARY HOOK
// ============================================================================

export const useExecutiveSummary = () => {
  const [data, setData] = useState<ExecutiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const cached = getCachedData<ExecutiveSummary>('executive_summary');
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }

        const { data: result, error: err } = await supabase
          .from('v_figma_executive_summary')
          .select('*')
          .single();

        if (err) throw err;

        const summary: ExecutiveSummary = {
          leads_30d: result.leads_30d || 0,
          conversions_30d: result.conversions_30d || 0,
          revenue_30d: result.revenue_30d || 0,
          active_channels: result.active_channels || 0,
          updated_at: new Date().toISOString(),
        };

        setCachedData('executive_summary', summary);
        setData(summary);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
};

// ============================================================================
// CAMPAIGN PERFORMANCE HOOK
// ============================================================================

export const useCampaignPerformance = () => {
  const [data, setData] = useState<CampaignPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const cached = getCachedData<CampaignPerformance[]>('campaign_performance');
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }

        const { data: result, error: err } = await supabase
          .from('v_figma_campaign_performance')
          .select('*')
          .order('total_leads', { ascending: false });

        if (err) throw err;

        setCachedData('campaign_performance', result || []);
        setData(result || []);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
};

// ============================================================================
// CHANNEL PERFORMANCE HOOK
// ============================================================================

export const useChannelPerformance = () => {
  const [data, setData] = useState<ChannelPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const cached = getCachedData<ChannelPerformance[]>('channel_performance');
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }

        const { data: result, error: err } = await supabase
          .from('v_figma_channel_performance')
          .select('*')
          .order('total_leads', { ascending: false });

        if (err) throw err;

        setCachedData('channel_performance', result || []);
        setData(result || []);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
};

// ============================================================================
// MONTHLY TREND HOOK
// ============================================================================

export const useMonthlyTrend = () => {
  const [data, setData] = useState<MonthlyTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const cached = getCachedData<MonthlyTrend[]>('monthly_trend');
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }

        const { data: result, error: err } = await supabase
          .from('v_figma_monthly_trend')
          .select('*')
          .order('month', { ascending: false });

        if (err) throw err;

        setCachedData('monthly_trend', result || []);
        setData(result || []);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
};

// ============================================================================
// DATA HEALTH HOOK
// ============================================================================

export const useDataHealth = () => {
  const [data, setData] = useState<DataHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const cached = getCachedData<DataHealth[]>('data_health');
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }

        const { data: result, error: err } = await supabase
          .from('v_figma_data_health')
          .select('*');

        if (err) throw err;

        setCachedData('data_health', result || []);
        setData(result || []);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
};

// ============================================================================
// DOCTORALIA PERFORMANCE HOOK
// ============================================================================

export const useDoctoraliPerformance = () => {
  const [data, setData] = useState<DoctoraliPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const cached = getCachedData<DoctoraliPerformance>('doctoralia_performance');
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }

        const { data: result, error: err } = await supabase
          .from('v_figma_doctoralia_performance')
          .select('*')
          .single();

        if (err) throw err;

        setCachedData('doctoralia_performance', result);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
};

// ============================================================================
// LEAD SOURCE DISTRIBUTION HOOK
// ============================================================================

export const useLeadSourceDistribution = () => {
  const [data, setData] = useState<LeadSourceDistribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const cached = getCachedData<LeadSourceDistribution[]>('lead_source_distribution');
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }

        const { data: result, error: err } = await supabase
          .from('v_figma_lead_source_distribution')
          .select('*')
          .order('total_leads', { ascending: false });

        if (err) throw err;

        setCachedData('lead_source_distribution', result || []);
        setData(result || []);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
};

// ============================================================================
// CONVERSION FUNNEL HOOK
// ============================================================================

export const useConversionFunnel = () => {
  const [data, setData] = useState<ConversionFunnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const cached = getCachedData<ConversionFunnel[]>('conversion_funnel');
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }

        const { data: result, error: err } = await supabase
          .from('v_figma_conversion_funnel')
          .select('*');

        if (err) throw err;

        setCachedData('conversion_funnel', result || []);
        setData(result || []);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
};

// ============================================================================
// META PERFORMANCE HOOK
// ============================================================================

export const useMetaPerformance = () => {
  const [data, setData] = useState<MetaPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const cached = getCachedData<MetaPerformance[]>('meta_performance');
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }

        const { data: result, error: err } = await supabase
          .from('v_figma_meta_performance')
          .select('*')
          .order('date', { ascending: false })
          .limit(30);

        if (err) throw err;

        setCachedData('meta_performance', result || []);
        setData(result || []);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
};

// ============================================================================
// GOOGLE ADS PERFORMANCE HOOK
// ============================================================================

export const useGoogleAdsPerformance = () => {
  const [data, setData] = useState<GoogleAdsPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const cached = getCachedData<GoogleAdsPerformance[]>('google_ads_performance');
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }

        const { data: result, error: err } = await supabase
          .from('v_figma_google_ads_performance')
          .select('*')
          .order('date', { ascending: false })
          .limit(30);

        if (err) throw err;

        setCachedData('google_ads_performance', result || []);
        setData(result || []);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
};

// ============================================================================
// HUBSPOT INTEGRATION HOOK
// ============================================================================

export const useHubSpotIntegration = () => {
  const [data, setData] = useState<HubSpotIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const cached = getCachedData<HubSpotIntegration>('hubspot_integration');
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }

        const { data: result, error: err } = await supabase
          .from('v_figma_hubspot_integration')
          .select('*')
          .single();

        if (err) throw err;

        setCachedData('hubspot_integration', result);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return { data, loading, error };
};

// ============================================================================
// CLEAR CACHE FUNCTION
// ============================================================================

export const clearFigmaDataCache = (): void => {
  cache.clear();
};

// ============================================================================
// REFRESH ALL DATA FUNCTION
// ============================================================================

export const refreshAllFigmaData = async (): Promise<void> => {
  clearFigmaDataCache();
  // Force re-fetch by clearing cache
  // Components using hooks will automatically re-fetch on next render
};
