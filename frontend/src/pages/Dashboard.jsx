import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Brain,
  Circle,
  GitBranch,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import MetricCard from '../components/MetricCard';
import api from '../config/api';
import { normalizeDashboardMetrics } from '../lib/normalizeDashboardMetrics';

const REFRESH_SECONDS = 60;

function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

function formatCurrency(value) {
  const n = Number(value);
  return `€${Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0'}`;
}

function toPercent(value) {
  const n = Number(value);
  return `${Number.isFinite(n) ? n.toFixed(1) : '0.0'}%`;
}

function normalizeMetaSummary(summary) {
  const raw = summary?.thisWeek || {};
  return {
    impressions: Number(raw.impressions || 0),
    reach: Number(raw.reach || 0),
    clicks: Number(raw.clicks || 0),
    spend: Number(raw.spend || 0),
    conversions: Number(raw.conversions || 0),
    ctr: Number(raw.ctr || 0),
    cpc: Number(raw.cpc || 0),
    cpm: Number(raw.cpm || 0),
  };
}

function normalizeMetaAccountId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const unprefixed = value.replace(/^act_/i, '');
  const digits = unprefixed.replace(/\D/g, '');
  return digits ? `act_${digits}` : '';
}

function formatAgentType(agentType) {
  const map = {
    campaign_analyzer: 'AI campaign analysis generated',
    content_generator: 'AI content generated',
  };
  return map[agentType] || 'AI output generated';
}

function buildUnifiedActivity(figmaEvents, aiOutputs) {
  const normalizedFigma = (figmaEvents || []).map((event) => ({
    id: `figma-${event.id || `${event.type || 'event'}-${event.createdAt || ''}`}`,
    type: event.type || 'figma_sync',
    message: event.message || 'Figma event',
    createdAt: event.createdAt || event.created_at || null,
  }));

  const normalizedAi = (aiOutputs || []).map((output) => ({
    id: `ai-${output.id}`,
    type: 'ai_output',
    message: formatAgentType(output.agent_type),
    createdAt: output.created_at || null,
  }));

  return [...normalizedAi, ...normalizedFigma]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 16);
}

export default function Dashboard() {
  const { token, isAuthenticated } = useAuth();
  const [metrics, setMetrics] = useState(null);
  const [integrations, setIntegrations] = useState([]);
  const [aiStatus, setAiStatus] = useState({ available: false, provider: null });
  const [metaTrends, setMetaTrends] = useState(null);
  const [metaInsights, setMetaInsights] = useState(null);
  const [metaState, setMetaState] = useState('pending');
  const [metaError, setMetaError] = useState(null);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [activityEvents, setActivityEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [error, setError] = useState(null);
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);

  const fetchAiSuggestions = async () => {
    setLoadingSuggestions(true);
    try {
      const res = await api.post('/api/ai/suggestions', { provider: 'openai' });
      setAiSuggestions(res.data?.suggestions || []);
    } catch {
      setAiSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [metricsRes, integrationsRes, aiStatusRes] = await Promise.all([
        api.get('/api/dashboard/metrics'),
        api.get('/api/integrations'),
        api.get('/api/ai/status'),
      ]);

      const [eventsRes, aiOutputsRes] = await Promise.allSettled([
        api.get('/api/figma/events', { params: { limit: 12 } }),
        api.get('/api/ai/outputs', { params: { limit: 10 } }),
      ]);

      const parsedMetrics = normalizeDashboardMetrics(metricsRes.data);
      setMetrics(parsedMetrics);

      const integrationList = integrationsRes.data?.integrations || [];
      setIntegrations(integrationList);
      setAiStatus(aiStatusRes.data || { available: false, provider: null });

      const figmaEvents = eventsRes.status === 'fulfilled' ? (eventsRes.value.data?.events || []) : [];
      const aiOutputs = aiOutputsRes.status === 'fulfilled' ? (aiOutputsRes.value.data?.outputs || []) : [];
      setActivityEvents(buildUnifiedActivity(figmaEvents, aiOutputs));

      const metaIntegration = integrationList.find((i) => i.service === 'meta');
      const adAccountId = normalizeMetaAccountId(
        metaIntegration?.metadata?.adAccountId ?? metaIntegration?.metadata?.ad_account_id,
      );
      if (metaIntegration?.status === 'connected' && adAccountId) {
        try {
          const [trendsRes, insightsRes] = await Promise.all([
            api.get('/api/dashboard/meta-trends', { params: { adAccountId } }),
            api.get('/api/meta/insights', { params: { adAccountId, days: 30 } }),
          ]);
          setMetaTrends(trendsRes.data);
          setMetaInsights(insightsRes.data);

          if (trendsRes.data?.degraded || insightsRes.data?.degraded) {
            setMetaState('degraded');
            const lastSuccess = trendsRes.data?.last_success || insightsRes.data?.last_success;
            setMetaError(
              `Meta connection unstable. Showing data from ${
                lastSuccess ? new Date(lastSuccess).toLocaleString() : 'cache'
              }.`
            );
          } else {
            setMetaError(null);
            setMetaState('real');
          }
        } catch (metaErr) {
          setMetaTrends(null);
          setMetaInsights(null);
          setMetaError(metaErr.response?.data?.message || 'Unable to fetch Meta data');
          setMetaState('error');
        }
      } else if (metaIntegration?.status === 'connected') {
        setMetaTrends(null);
        setMetaInsights(null);
        setMetaState('missing-config');
      } else {
        setMetaTrends(null);
        setMetaInsights(null);
        setMetaState('not-connected');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load live dashboard');
    } finally {
      setLoading(false);
      setCountdown(REFRESH_SECONDS);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
      fetchAiSuggestions();
    }
  }, [isAuthenticated, token]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchData();
          return REFRESH_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const verifiedRevenue = metrics?.verifiedRevenue ?? 0;
  const totalRevenue = metrics?.totalRevenue ?? 0;
  const settledCount = metrics?.settledCount ?? 0;
  const totalLeads = metrics?.totalLeads ?? 0;
  const conversionRate = metrics?.conversionRate ?? 0;
  const connectedIntegrations = metrics?.connectedIntegrations ?? 0;
  const totalIntegrations = metrics?.totalIntegrations ?? 0;

  const metaSummary = normalizeMetaSummary({
    thisWeek: metaInsights?.summary || metaTrends?.summary?.thisWeek || {},
  });

  const agents = useMemo(() => {
    const github = integrations.find((i) => i.service === 'github');
    return [
      {
        name: 'GitHub Sync Agent',
        status: github?.status || 'disconnected',
        detail: github?.lastSync ? `Last sync: ${new Date(github.lastSync).toLocaleString()}` : 'No recent sync',
        icon: GitBranch,
      },
      {
        name: 'AI Analysis Agent',
        status: aiStatus?.available ? 'connected' : 'disconnected',
        detail: aiStatus?.provider ? `Provider: ${aiStatus.provider}` : 'No AI credentials',
        icon: Brain,
      },
      {
        name: 'Meta Observer Agent',
        status:
          metaState === 'real'
            ? 'connected'
            : metaState === 'degraded'
              ? 'degraded'
              : metaState === 'error'
                ? 'error'
                : 'pending',
        detail:
          metaState === 'real'
            ? 'Live Meta view active'
            : metaState === 'degraded'
              ? 'Running in degraded mode (cached)'
              : metaState === 'missing-config'
                ? 'Missing adAccountId in metadata'
                : 'Connect Meta to enable live view',
        icon: Zap,
      },
    ];
  }, [integrations, aiStatus, metaState]);

  const adaptivePlan = useMemo(() => {
    const rules = [];

    if (Number(conversionRate) < 20) {
      rules.push('Prioritize follow-up within the first 2 hours for new leads.');
    }

    if (metaSummary.spend > 0 && metaSummary.conversions === 0) {
      rules.push('Cut spend on ad sets with no conversions and shift to higher-CTR audiences.');
    }

    if (metaSummary.cpc > 2) {
      rules.push('Test new creatives to lower CPC while maintaining click volume.');
    }

    if ((metrics?.bySource?.meta || 0) > 0 && (metrics?.byStage?.appointment || 0) === 0) {
      rules.push('Set up WhatsApp automation to move Meta leads to appointment within 24h.');
    }

    const fromAi = aiSuggestions.slice(0, 4);
    const merged = [...fromAi, ...rules];
    if (merged.length === 0) {
      return ['No recommendations yet. Enable Meta + AI to generate a daily adaptive plan.'];
    }
    return merged.slice(0, 6);
  }, [aiSuggestions, conversionRate, metaSummary, metrics]);

  if (loading && !metrics) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
        <p className="text-gray-400 animate-pulse">Cargando inteligencia en tiempo real...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="card border-red-500/20 bg-red-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <h3 className="font-semibold text-white mb-1">Error loading dashboard</h3>
              <p className="text-sm text-gray-300 mb-3">{error}</p>
              <button onClick={fetchData} className="btn-secondary text-sm">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">Live Control</h2>
          <p className="text-gray-400 mt-0.5">Frontend governed by GitHub + Supabase with daily auto-refresh and live Meta view.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 tabular-nums">Refresh {countdown}s</span>
          <button
            onClick={() => {
              fetchData();
              fetchAiSuggestions();
            }}
            disabled={loading}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          title="Revenue"
          value={verifiedRevenue}
          prefix="€"
          icon={TrendingUp}
          color="brand"
          badge="Verificado"
          estimatedValue={totalRevenue}
          subtitle={settledCount > 0 ? `${settledCount} settled operations` : 'From Doctoralia settlements'}
        />
        <MetricCard
          title="Total Leads"
          value={totalLeads}
          icon={ShieldCheck}
          color="emerald"
        />
        <MetricCard
          title="Conversion"
          value={toPercent(conversionRate)}
          icon={Sparkles}
          color="violet"
        />
        <MetricCard
          title="Integraciones"
          value={connectedIntegrations}
          suffix={` / ${totalIntegrations}`}
          icon={Bot}
          color="metal"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card border-brand-500/20 bg-gradient-to-br from-brand-500/5 to-transparent">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-white">Adaptive Action Plan</h3>
              <p className="text-xs text-gray-500">Regenerates with fresh data from Meta, CRM, and AI. Not static.</p>
            </div>
            <button onClick={fetchAiSuggestions} className="btn-secondary text-xs" disabled={loadingSuggestions}>
              {loadingSuggestions ? <Loader2 size={12} className="animate-spin" /> : 'Regenerate'}
            </button>
          </div>
          <div className="space-y-3">
            {adaptivePlan.map((item, idx) => (
              <div key={`${item}-${idx}`} className="flex items-start gap-3 p-3 rounded-lg bg-dark-800/70 border border-dark-600/60">
                <span className="w-6 h-6 rounded-full bg-brand-500/20 text-brand-300 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <p className="text-sm text-gray-200">{item}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold text-white mb-4">Active Agents</h3>
          <div className="space-y-3">
            {agents.map((agent) => {
              const Icon = agent.icon;
              const statusTone =
                agent.status === 'connected'
                  ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                  : agent.status === 'degraded'
                    ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
                    : agent.status === 'error'
                      ? 'text-red-400 border-red-500/30 bg-red-500/10'
                      : 'text-gray-400 border-dark-500 bg-dark-800/80';
              return (
                <div key={agent.name} className="p-3 rounded-lg border border-dark-600/70 bg-dark-800/60">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon size={16} className="text-brand-300 shrink-0" />
                      <p className="text-sm font-medium text-white truncate">{agent.name}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full border ${statusTone}`}>
                      {agent.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">{agent.detail}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-white">Live Meta</h3>
            <p className="text-xs text-gray-500">No local history. Current operational snapshot from Meta API only.</p>
          </div>
          {metaState === 'real' ? (
            <span className="text-xs px-2 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              Connected
            </span>
          ) : metaState === 'degraded' ? (
            <span className="text-xs px-2 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400">
              Degraded Mode
            </span>
          ) : (
            <span className="text-xs px-2 py-1 rounded-full border border-dark-500 bg-dark-800 text-gray-400">
              {metaState}
            </span>
          )}
        </div>

        {metaState === 'real' || metaState === 'degraded' ? (
          <>
            {metaState === 'degraded' && (
              <div className="mb-4 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 flex items-start gap-3">
                <AlertCircle className="text-amber-400 shrink-0 mt-0.5" size={16} />
                <p className="text-xs text-amber-200/80">{metaError}</p>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
              {[
                { label: 'Impressions', value: formatNumber(metaSummary.impressions) },
                { label: 'Reach', value: formatNumber(metaSummary.reach) },
                { label: 'Clicks', value: formatNumber(metaSummary.clicks) },
                { label: 'Spend', value: formatCurrency(metaSummary.spend) },
                { label: 'Conversions', value: formatNumber(metaSummary.conversions) },
                { label: 'CTR', value: toPercent(metaSummary.ctr) },
                { label: 'CPC', value: formatCurrency(metaSummary.cpc) },
                { label: 'CPM', value: formatCurrency(metaSummary.cpm) },
              ].map((metric) => (
                <div key={metric.label} className="rounded-lg p-3 bg-dark-800/70 border border-dark-600/70">
                  <p className="text-xs text-gray-500 mb-1">{metric.label}</p>
                  <p className="text-lg font-semibold text-white">{metric.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2 flex-wrap text-xs">
              <span className="px-2 py-1 rounded-full bg-brand-500/10 text-brand-300 border border-brand-500/20">
                WoW impressions: {metaTrends?.wow?.impressions > 0 ? '+' : ''}{metaTrends?.wow?.impressions || 0}%
              </span>
              <span className="px-2 py-1 rounded-full bg-metal-300/10 text-metal-200 border border-metal-300/30">
                MoM spend: {metaTrends?.mom?.spend > 0 ? '+' : ''}{metaTrends?.mom?.spend || 0}%
              </span>
            </div>
          </>
        ) : (
          <div className="p-4 rounded-lg border border-dark-600/70 bg-dark-800/60 text-sm text-gray-300">
            {metaState === 'missing-config' && 'Meta connected, but adAccountId is missing in the integration metadata.'}
            {metaState === 'not-connected' && 'Meta is not connected. Enable it in Integrations to see live data.'}
            {metaState === 'error' && (metaError || 'Unable to fetch Meta data at this time.')}
            {metaState === 'pending' && 'Loading Meta status…'}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="font-semibold text-white mb-4">GitHub + Supabase Activity</h3>
        {activityEvents.length === 0 ? (
          <p className="text-sm text-gray-400">No recent events. Run a sync to populate the feed.</p>
        ) : (
          <div className="space-y-2">
            {activityEvents.slice(0, 8).map((event) => (
              <div key={event.id} className="flex items-start gap-3 p-3 rounded-lg bg-dark-800/70 border border-dark-600/60">
                <Circle size={8} className="text-brand-300 shrink-0 mt-1.5" fill="currentColor" />
                <div className="min-w-0">
                  <p className="text-sm text-gray-200 break-words">{event.message}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {event.type}
                    {event.createdAt ? ` · ${new Date(event.createdAt).toLocaleString()}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
