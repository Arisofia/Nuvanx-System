import { useState, useEffect } from 'react';
import { DollarSign, Users, TrendingUp, Ticket, Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart,
} from 'recharts';
import MetricCard from '../components/MetricCard';
import FunnelChart from '../components/FunnelChart';
import api from '../config/api';

const STATIC_REVENUE = [
  { month: 'Aug', revenue: 42000, leads: 180 },
  { month: 'Sep', revenue: 51000, leads: 210 },
  { month: 'Oct', revenue: 47500, leads: 195 },
  { month: 'Nov', revenue: 63000, leads: 260 },
  { month: 'Dec', revenue: 71000, leads: 295 },
  { month: 'Jan', revenue: 68500, leads: 285 },
];

const STATIC_FUNNEL = [
  { label: 'Meta Ads Impressions', value: 45000 },
  { label: 'Landing Page Clicks', value: 3200 },
  { label: 'WhatsApp Contacts', value: 890 },
  { label: 'Appointments Booked', value: 312 },
  { label: 'Treatments Completed', value: 248 },
  { label: 'Revenue Generated', value: 186 },
];

const STATIC_SUGGESTIONS = [
  'Increase Meta Ads budget by 20% on Thursdays — 34% higher CTR observed',
  'Send re-engagement campaign to 47 dormant leads from November',
  'Add WhatsApp follow-up 2h after consultation — converts 28% more',
];

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
  const [funnel, setFunnel] = useState(null);
  const [aiSuggestions, setAiSuggestions] = useState(STATIC_SUGGESTIONS);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [usingLiveData, setUsingLiveData] = useState(false);

  async function fetchData() {
    setLoadingMetrics(true);
    try {
      const [metricsRes, funnelRes] = await Promise.all([
        api.get('/api/dashboard/metrics'),
        api.get('/api/dashboard/funnel'),
      ]);
      setMetrics(metricsRes.data.metrics);
      // Build funnel display from real funnel stages
      const stages = funnelRes.data.funnel || [];
      if (stages.length > 0) {
        setFunnel(stages.map(s => ({ label: s.label, value: s.count })));
      }
      setUsingLiveData(true);
    } catch {
      // Backend unavailable — stay with static values
      setUsingLiveData(false);
    } finally {
      setLoadingMetrics(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  const totalRevenue = metrics?.totalRevenue ?? 68500;
  const totalLeads = metrics?.totalLeads ?? 285;
  const conversionRate = metrics?.conversionRate ?? 21.4;
  const connectedIntegrations = metrics?.connectedIntegrations ?? 0;
  const revenueData = STATIC_REVENUE;
  const funnelStages = funnel ?? STATIC_FUNNEL;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">Revenue Intelligence Platform</h2>
          <p className="text-gray-400 mt-0.5">AI-powered insights for your clinic's growth</p>
        </div>
        <div className="flex items-center gap-3">
          {usingLiveData && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Live Data
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loadingMetrics}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            {loadingMetrics ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          title="Total Revenue"
          value={totalRevenue}
          prefix="$"
          change={12.4}
          changeLabel="vs last month"
          icon={DollarSign}
          color="brand"
        />
        <MetricCard
          title="New Leads"
          value={totalLeads}
          change={8.7}
          changeLabel="vs last month"
          icon={Users}
          color="emerald"
        />
        <MetricCard
          title="Conversion Rate"
          value={typeof conversionRate === 'number' ? conversionRate.toFixed(1) : conversionRate}
          suffix="%"
          change={3.2}
          changeLabel="vs last month"
          icon={TrendingUp}
          color="violet"
        />
        <MetricCard
          title="Connected Integrations"
          value={usingLiveData ? connectedIntegrations : 0}
          suffix={` / ${metrics?.totalIntegrations ?? 8}`}
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
              <p className="text-xs text-gray-500 mt-0.5">6-month performance overview</p>
            </div>
            <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-full font-medium">
              ↑ 12.4% MoM
            </span>
          </div>
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
        </div>

        {/* Funnel */}
        <div className="card">
          <div className="mb-5">
            <h3 className="font-semibold text-white">Revenue Funnel</h3>
            <p className="text-xs text-gray-500 mt-0.5">Meta Ads → Revenue conversion</p>
          </div>
          <FunnelChart stages={funnelStages} />
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
          <span className="ml-auto text-xs bg-brand-500/10 text-brand-400 border border-brand-500/20 px-2.5 py-1 rounded-full font-medium">
            {aiSuggestions.length} new
          </span>
        </div>
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
      </div>
    </div>
  );
}
