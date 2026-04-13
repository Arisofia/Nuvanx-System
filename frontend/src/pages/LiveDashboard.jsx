import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Megaphone, MessageSquare, Calendar, TrendingUp, Circle, Loader2 } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../config/api';

// Static hourly skeleton shown while/if the backend has no real time-series
function generateHourlyData() {
  const now = new Date();
  return Array.from({ length: 24 }, (_, i) => {
    const h = new Date(now);
    h.setHours(now.getHours() - (23 - i), 0, 0, 0);
    const label = h.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return { time: label, leads: 0, messages: 0 };
  });
}

const INITIAL_FEED = [
  { id: 1, type: 'lead', msg: 'Waiting for real activity data…', time: '', color: 'text-gray-500' },
];

const REFRESH_INTERVAL = 30;

export default function LiveDashboard() {
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [metrics, setMetrics] = useState(null);
  const [chartData] = useState(generateHourlyData);
  const [feed] = useState(INITIAL_FEED);
  const [campaigns] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [usingLiveData, setUsingLiveData] = useState(false);
  const countdownRef = useRef(REFRESH_INTERVAL);

  const fetchMetrics = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await api.get('/api/dashboard/metrics');
      const m = res.data?.metrics;
      if (m) {
        setMetrics(m);
        setUsingLiveData(true);
      }
    } catch {
      // Backend not available — keep previous or null values
    } finally {
      setIsRefreshing(false);
      countdownRef.current = REFRESH_INTERVAL;
      setCountdown(REFRESH_INTERVAL);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Countdown ticker — triggers real API refresh (no mock mutation)
  useEffect(() => {
    const tick = setInterval(() => {
      const next = Math.max(countdownRef.current - 1, 0);
      countdownRef.current = next;
      setCountdown(next);
      if (next <= 0) {
        fetchMetrics();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [fetchMetrics]);

  const progress = ((REFRESH_INTERVAL - countdown) / REFRESH_INTERVAL) * 100;

  // Map backend metrics to display values
  const activeCampaigns = metrics?.connectedIntegrations ?? '—';
  const messagesToday = metrics?.totalLeads ?? '—';
  const appointmentsToday = metrics?.byStage?.appointment ?? '—';
  const conversionRate = metrics?.conversionRate != null ? `${metrics.conversionRate}%` : '—';

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-white">Live Metrics</h2>
            {usingLiveData ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-gray-500/10 text-gray-400 border border-gray-500/20">
                Connecting…
              </span>
            )}
          </div>
          <p className="text-gray-400 mt-0.5">Real-time clinic performance data</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <div className="w-20 h-1.5 bg-dark-600 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-500 rounded-full transition-all duration-1000"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="tabular-nums">{countdown}s</span>
          </div>
          <button
            onClick={fetchMetrics}
            disabled={isRefreshing}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            {isRefreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </div>

      {/* Live metrics */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Connected Services', value: activeCampaigns, icon: Megaphone, color: 'text-brand-400', bg: 'bg-brand-500/10' },
          { label: 'Total Leads', value: messagesToday, icon: MessageSquare, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'In Appointment Stage', value: appointmentsToday, icon: Calendar, color: 'text-violet-400', bg: 'bg-violet-500/10' },
          { label: 'Conversion Rate', value: conversionRate, icon: TrendingUp, color: 'text-amber-400', bg: 'bg-amber-500/10' },
        ].map(m => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="card flex items-center gap-4">
              <div className={`p-3 rounded-xl ${m.bg}`}>
                <Icon size={20} className={m.color} />
              </div>
              <div>
                <p className="text-xs text-gray-500">{m.label}</p>
                <p className="text-2xl font-bold text-white tabular-nums">{m.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Chart + Feed */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* 24h chart */}
        <div className="card xl:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-semibold text-white">Lead Flow — Last 24 Hours</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Hourly time-series will appear once real leads are recorded
              </p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="leadsG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="msgG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="time" stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }} interval={3} />
              <YAxis stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                labelStyle={{ color: '#9ca3af', fontSize: 11 }}
                itemStyle={{ fontSize: 12 }}
              />
              <Area type="monotone" dataKey="leads" stroke="#0ea5e9" strokeWidth={2} fill="url(#leadsG)" name="Leads" dot={false} />
              <Area type="monotone" dataKey="messages" stroke="#10b981" strokeWidth={2} fill="url(#msgG)" name="Messages" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Activity Feed */}
        <div className="card flex flex-col">
          <h3 className="font-semibold text-white mb-4">Activity Feed</h3>
          <div className="space-y-3 flex-1 overflow-y-auto max-h-64 xl:max-h-none">
            {feed.map(event => (
              <div key={event.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-dark-800/60 border border-dark-600/40">
                <Circle size={8} className={`${event.color} shrink-0 mt-1.5`} fill="currentColor" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-300 leading-relaxed">{event.msg}</p>
                  {event.time && <p className="text-xs text-gray-600 mt-0.5">{event.time}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Campaigns / Connected integrations */}
      {campaigns.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-white mb-4">Active Campaigns</h3>
          <div className="space-y-3">
            {campaigns.map(c => (
              <div key={c.name} className="flex items-center justify-between gap-4 p-3 rounded-lg bg-dark-800/60 border border-dark-600/40">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${c.status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                  <p className="text-sm text-gray-300 truncate">{c.name}</p>
                </div>
                <div className="flex items-center gap-6 shrink-0 text-xs text-gray-500">
                  <span>Impressions: <span className="text-gray-300">{c.impressions}</span></span>
                  <span>CTR: <span className="text-gray-300">{c.ctr}</span></span>
                  <span className={`font-medium ${c.status === 'active' ? 'text-emerald-400' : 'text-gray-500'}`}>
                    {c.status === 'active' ? '● Active' : '⏸ Paused'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
