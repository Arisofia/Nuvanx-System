import { useState, useEffect } from 'react';
import { DollarSign, Users, TrendingUp, Ticket, Sparkles, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart,
} from 'recharts';
import MetricCard from '../components/MetricCard';
import FunnelChart from '../components/FunnelChart';
import api from '../config/api';
import { normalizeDashboardMetrics } from '../lib/normalizeDashboardMetrics';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-dark-700 border border-dark-600 rounded-lg p-3 shadow-lg">
        <p className="text-gray-400 text-xs mb-2">{label}</p>
        {payload.map((p) => (
          <p key={p.name} className="text-sm font-medium" style={{ color: p.color }}>
            {p.name === 'revenue' ? `$${p.value.toLocaleString()}` : p.value} {p.name}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function Dashboard() {
  const [metrics, setMetrics] = useState(null);
  const [funnel, setFunnel] = useState([]);
  const [revenueData, setRevenueData] = useState([]);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [metaTrends, setMetaTrends] = useState(null);
  const [hubspotTrends, setHubspotTrends] = useState(null);
  const [metaTrendsState, setMetaTrendsState] = useState('pending');
  const [hubspotTrendsState, setHubspotTrendsState] = useState('pending');
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoadingMetrics(true);
    setError(null);
    try {
      const [metricsRes, funnelRes, revenueRes, integrationsRes] = await Promise.all([
        api.get('/api/dashboard/metrics'),
        api.get('/api/dashboard/funnel'),
        api.get('/api/dashboard/revenue-trend'),
        api.get('/api/integrations'),
      ]);
      setMetrics(normalizeDashboardMetrics(metricsRes.data));

      // Build funnel display from real funnel stages
      const stages = funnelRes.data.funnel || [];
      setFunnel(stages.map(s => ({ label: s.label, value: s.count })));

      // Set revenue trend data
      setRevenueData(revenueRes.data.trend || []);

      const integrations = integrationsRes.data?.integrations || [];
      const metaIntegration = integrations.find((i) => i.service === 'meta');
      const hubspotIntegration = integrations.find((i) => i.service === 'hubspot');

      // Fetch Meta trends only when adAccountId is provided in saved metadata.
      const adAccountId = metaIntegration?.metadata?.adAccountId;
      if (metaIntegration?.status === 'connected' && adAccountId) {
        try {
          const metaRes = await api.get('/api/dashboard/meta-trends', { params: { adAccountId } });
          setMetaTrends(metaRes.data);
          setMetaTrendsState('real');
        } catch (err) {
          setMetaTrends(null);
          setMetaTrendsState('error');
          console.log('Meta trends not available:', err.response?.data?.message);
        }
      } else if (metaIntegration?.status === 'connected') {
        setMetaTrends(null);
        setMetaTrendsState('missing-config');
      } else {
        setMetaTrends(null);
        setMetaTrendsState('not-connected');
      }

      // Fetch HubSpot trends only when integration is connected.
      if (hubspotIntegration?.status === 'connected') {
        try {
          const hubspotRes = await api.get('/api/dashboard/hubspot-trends');
          setHubspotTrends(hubspotRes.data);
          setHubspotTrendsState('real');
        } catch (err) {
          setHubspotTrends(null);
          setHubspotTrendsState('error');
          console.log('HubSpot trends not available:', err.response?.data?.message);
        }
      } else {
        setHubspotTrends(null);
        setHubspotTrendsState('not-connected');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load dashboard data');
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoadingMetrics(false);
    }
  };

  const fetchAiSuggestions = async () => {
    setLoadingSuggestions(true);
    try {
      const res = await api.post('/api/ai/suggestions', { provider: 'openai' });
      setAiSuggestions(res.data.suggestions || []);
    } catch (err) {
      console.error('AI suggestions error:', err);
      // Don't set error state for suggestions - it's optional
    } finally {
      setLoadingSuggestions(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchAiSuggestions();
  }, []);

  const totalRevenue = metrics?.totalRevenue ?? 0;
  const totalLeads = metrics?.totalLeads ?? 0;
  const conversionRate = metrics?.conversionRate ?? 0;
  const connectedIntegrations = metrics?.connectedIntegrations ?? 0;
  const totalIntegrations = metrics?.totalIntegrations ?? 0;

  if (error) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="card border-red-500/20 bg-red-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <h3 className="font-semibold text-white mb-1">Error Loading Dashboard</h3>
              <p className="text-sm text-gray-300 mb-3">{error}</p>
              <button onClick={fetchData} className="btn-secondary text-sm">
                <RefreshCw size={14} /> Try Again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
          <p className="text-gray-400 mt-0.5">Primary cards and charts are sourced from backend dashboard APIs.</p>
          <p className="text-xs text-gray-500 mt-1">Data truth mode: API-backed sections are shown as real; missing sections are labeled as pending.</p>
        </div>
        <button
          onClick={fetchData}
          disabled={loadingMetrics}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          {loadingMetrics ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          title="Total Revenue"
          value={totalRevenue}
          prefix="$"
          change={null}
          icon={DollarSign}
          color="brand"
        />
        <MetricCard
          title="New Leads"
          value={totalLeads}
          change={null}
          icon={Users}
          color="emerald"
        />
        <MetricCard
          title="Conversion Rate"
          value={typeof conversionRate === 'number' ? conversionRate.toFixed(1) : conversionRate}
          suffix="%"
          change={null}
          icon={TrendingUp}
          color="violet"
        />
        <MetricCard
          title="Connected Integrations"
          value={connectedIntegrations}
          suffix={` / ${totalIntegrations}`}
          change={null}
          changeLabel="services active"
          icon={Ticket}
          color="amber"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <div className="card xl:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-semibold text-white">Revenue Trend</h3>
              <p className="text-xs text-gray-500 mt-0.5">Historical performance data</p>
            </div>
          </div>
          {revenueData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={revenueData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="revenue" stroke="#0ea5e9" strokeWidth={2} fill="url(#revenueGrad)" dot={{ fill: '#0ea5e9', r: 4 }} activeDot={{ r: 6 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-60 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <AlertCircle size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No revenue trend data available</p>
                <p className="text-xs mt-1">Add leads with revenue to see the trend</p>
              </div>
            </div>
          )}
        </div>

        {/* Funnel */}
        <div className="card">
          <div className="mb-5">
            <h3 className="font-semibold text-white">Revenue Funnel</h3>
            <p className="text-xs text-gray-500 mt-0.5">Lead → Revenue conversion</p>
          </div>
          {funnel.length > 0 ? (
            <FunnelChart stages={funnel} />
          ) : (
            <div className="h-60 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <AlertCircle size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No funnel data available</p>
                <p className="text-xs mt-1">Add leads to see the funnel</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Meta Trends Section */}
      {metaTrends && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Meta Marketing Metrics</h3>
            <div className="flex gap-2 text-xs">
              <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                WoW: {metaTrends.wow.impressions > 0 ? '+' : ''}{metaTrends.wow.impressions}%
              </span>
              <span className="px-2 py-1 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                MoM: {metaTrends.mom.impressions > 0 ? '+' : ''}{metaTrends.mom.impressions}%
              </span>
            </div>
          </div>

          {/* Meta Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {[
              { label: 'Impressions', value: metaTrends.summary.thisWeek.impressions, change: metaTrends.wow.impressions },
              { label: 'Reach', value: metaTrends.summary.thisWeek.reach, change: metaTrends.wow.reach },
              { label: 'Clicks', value: metaTrends.summary.thisWeek.clicks, change: metaTrends.wow.clicks },
              { label: 'Spend', value: `$${metaTrends.summary.thisWeek.spend.toFixed(2)}`, change: metaTrends.wow.spend },
              { label: 'Conversions', value: metaTrends.summary.thisWeek.conversions, change: metaTrends.wow.conversions },
            ].map(metric => (
              <div key={metric.label} className="card p-4">
                <p className="text-xs text-gray-500 mb-1">{metric.label}</p>
                <p className="text-xl font-bold text-white mb-1">{metric.value.toLocaleString()}</p>
                <p className={`text-xs font-medium ${metric.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {metric.change > 0 ? '+' : ''}{metric.change}% WoW
                </p>
              </div>
            ))}
          </div>

          {/* Meta Trends Chart */}
          {metaTrends.trends.length > 0 && (
            <div className="card">
              <div className="mb-6">
                <h3 className="font-semibold text-white">Meta Performance Trend</h3>
                <p className="text-xs text-gray-500 mt-0.5">Daily breakdown of key metrics</p>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={metaTrends.trends} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="impressionsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="clicksGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="date"
                    stroke="#6b7280"
                    tick={{ fill: '#9ca3af', fontSize: 11 }}
                    tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="impressions"
                    stroke="#0ea5e9"
                    strokeWidth={2}
                    fill="url(#impressionsGrad)"
                    name="Impressions"
                  />
                  <Area
                    type="monotone"
                    dataKey="clicks"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    fill="url(#clicksGrad)"
                    name="Clicks"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {metaTrendsState === 'missing-config' && (
        <div className="card border-amber-500/20 bg-amber-500/5">
          <h3 className="font-semibold text-white">Meta Trends</h3>
          <p className="text-xs text-amber-200/90 mt-1">
            Pending backend support: connect Meta with a stored adAccountId in integration metadata to enable this section.
          </p>
        </div>
      )}

      {metaTrendsState === 'not-connected' && (
        <div className="card border-dark-600">
          <h3 className="font-semibold text-white">Meta Trends</h3>
          <p className="text-xs text-gray-400 mt-1">Not connected. Connect Meta in Integrations to load API data.</p>
        </div>
      )}

      {/* HubSpot Trends Section */}
      {hubspotTrends && hubspotTrends.trends.length > 0 && (
        <div className="card">
          <div className="mb-6">
            <h3 className="font-semibold text-white">HubSpot CRM Trends</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {hubspotTrends.totalContacts} contacts, {hubspotTrends.totalDeals} deals, $
              {hubspotTrends.totalRevenue.toLocaleString()} revenue
            </p>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={hubspotTrends.trends} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="contactsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="date"
                stroke="#6b7280"
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              />
              <YAxis stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="contacts"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#contactsGrad)"
                name="Contacts"
              />
              <Area
                type="monotone"
                dataKey="deals"
                stroke="#f59e0b"
                strokeWidth={2}
                fill="none"
                name="Deals"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {hubspotTrendsState === 'not-connected' && (
        <div className="card border-dark-600">
          <h3 className="font-semibold text-white">HubSpot CRM Trends</h3>
          <p className="text-xs text-gray-400 mt-1">Not connected. Connect HubSpot in Integrations to load API data.</p>
        </div>
      )}

      {/* AI Suggestions */}
      <div className="card border-brand-500/20 bg-gradient-to-br from-brand-500/5 to-transparent">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-brand-500/20">
            <Sparkles size={18} className="text-brand-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-white">AI Optimization Suggestions</h3>
            <p className="text-xs text-gray-500">Generated by /api/ai/suggestions when AI credentials are configured.</p>
          </div>
          {aiSuggestions.length > 0 && (
            <span className="ml-auto text-xs bg-brand-500/10 text-brand-400 border border-brand-500/20 px-2.5 py-1 rounded-full font-medium">
              {aiSuggestions.length} new
            </span>
          )}
          {!loadingSuggestions && aiSuggestions.length === 0 && (
            <button
              onClick={fetchAiSuggestions}
              className="btn-secondary text-xs"
            >
              Generate Suggestions
            </button>
          )}
        </div>
        {loadingSuggestions ? (
          <div className="text-center py-8 text-gray-500">
            <Loader2 size={32} className="mx-auto mb-2 opacity-50 animate-spin" />
            <p className="text-sm">Analyzing your data...</p>
          </div>
        ) : aiSuggestions.length > 0 ? (
          <div className="space-y-3">
            {aiSuggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-dark-800/60 border border-dark-600/50">
                <span className="w-6 h-6 rounded-full bg-brand-500/20 text-brand-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-gray-300">{s}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Sparkles size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No AI suggestions yet</p>
            <p className="text-xs mt-1">No placeholder suggestions are shown. Configure AI credentials to load real suggestions.</p>
          </div>
        )}
      </div>
    </div>
  );
}
