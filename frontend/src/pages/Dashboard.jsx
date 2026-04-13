import { useState, useEffect } from 'react';
import { DollarSign, Users, TrendingUp, Ticket, Sparkles, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart,
} from 'recharts';
import MetricCard from '../components/MetricCard';
import FunnelChart from '../components/FunnelChart';
import api from '../config/api';

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
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [error, setError] = useState(null);

  async function fetchData() {
    setLoadingMetrics(true);
    setError(null);
    try {
      const [metricsRes, funnelRes] = await Promise.all([
        api.get('/api/dashboard/metrics'),
        api.get('/api/dashboard/funnel'),
      ]);
      setMetrics(metricsRes.data.metrics);

      // Build funnel display from real funnel stages
      const stages = funnelRes.data.funnel || [];
      setFunnel(stages.map(s => ({ label: s.label, value: s.count })));

      // TODO: Add revenue trend endpoint to backend - currently empty
      setRevenueData([]);

      // TODO: Add AI suggestions endpoint to backend - currently empty
      setAiSuggestions([]);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load dashboard data');
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoadingMetrics(false);
    }
  }

  useEffect(() => {
    fetchData();
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
          <h2 className="text-2xl font-bold text-white">Revenue Intelligence Platform</h2>
          <p className="text-gray-400 mt-0.5">AI-powered insights for your clinic's growth</p>
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

      {/* AI Suggestions */}
      <div className="card border-brand-500/20 bg-gradient-to-br from-brand-500/5 to-transparent">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-brand-500/20">
            <Sparkles size={18} className="text-brand-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">AI Optimization Suggestions</h3>
            <p className="text-xs text-gray-500">Generated from your campaign data</p>
          </div>
          {aiSuggestions.length > 0 && (
            <span className="ml-auto text-xs bg-brand-500/10 text-brand-400 border border-brand-500/20 px-2.5 py-1 rounded-full font-medium">
              {aiSuggestions.length} new
            </span>
          )}
        </div>
        {aiSuggestions.length > 0 ? (
          <div className="space-y-3">
            {aiSuggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-dark-800/60 border border-dark-600/50">
                <span className="w-6 h-6 rounded-full bg-brand-500/20 text-brand-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-gray-300">{s}</p>
                <button className="ml-auto shrink-0 text-xs text-brand-400 hover:text-brand-300 font-medium whitespace-nowrap">
                  Apply →
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Sparkles size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No AI suggestions yet</p>
            <p className="text-xs mt-1">Connect integrations and add campaign data to get AI-powered insights</p>
          </div>
        )}
      </div>
    </div>
  );
}
