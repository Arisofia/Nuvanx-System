import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Megaphone, MessageSquare, Calendar, TrendingUp, Circle, Loader2, GitBranch, Radio } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../config/api';
import { normalizeDashboardMetrics } from '../lib/normalizeDashboardMetrics';
import { supabase, isSupabaseAvailable } from '../lib/supabase/client';

const REFRESH_INTERVAL = 30;

/** Build a 24-slot hourly series from an array of leads (each with createdAt). */
function buildHourlyFromLeads(leads) {
  const now = new Date();
  const slots = Array.from({ length: 24 }, (_, i) => {
    const h = new Date(now);
    h.setHours(now.getHours() - (23 - i), 0, 0, 0);
    const label = h.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return { time: label, hour: h.getHours(), leads: 0 };
  });

  const today = now.toISOString().split('T')[0];
  for (const lead of leads) {
    const created = lead.createdAt || lead.created_at || '';
    if (!created || !created.startsWith(today)) continue;
    const h = new Date(created).getHours();
    const slot = slots.find((s) => s.hour === h);
    if (slot) slot.leads += 1;
  }

  return slots;
}

const EVENT_COLORS = {
  github_sync: 'text-violet-400',
  figma_sync: 'text-brand-400',
  lead_created: 'text-emerald-400',
  integration_connected: 'text-amber-400',
  default: 'text-gray-400',
};

function eventColor(type) {
  return EVENT_COLORS[type] || EVENT_COLORS.default;
}

function timeAgo(isoString) {
  if (!isoString) return '';
  const now = Date.now();
  const diff = Math.max(0, Math.floor((now - new Date(isoString).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function LiveDashboard() {
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [metrics, setMetrics] = useState(null);
  const [chartData, setChartData] = useState(() => buildHourlyFromLeads([]));
  const [feed, setFeed] = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [usingApiData, setUsingApiData] = useState(false);
  const [isRealtime, setIsRealtime] = useState(false);
  const countdownRef = useRef(REFRESH_INTERVAL);

  const fetchEvents = useCallback(async () => {
    setFeedLoading(true);
    try {
      const res = await api.get('/api/figma/events', { params: { limit: 30 } });
      setFeed(res.data?.events || []);
    } catch {
      // Figma Supabase may not be configured — silent degradation
    } finally {
      setFeedLoading(false);
    }
  }, []);

  const fetchMetrics = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [metricsRes, leadsRes] = await Promise.allSettled([
        api.get('/api/dashboard/metrics'),
        api.get('/api/leads'),
      ]);

      if (metricsRes.status === 'fulfilled') {
        const m = normalizeDashboardMetrics(metricsRes.value.data);
        if (m) {
          setMetrics(m);
          setUsingApiData(true);
        }
      }

      if (leadsRes.status === 'fulfilled') {
        const leads = leadsRes.value.data?.leads || [];
        setChartData(buildHourlyFromLeads(leads));
      }
    } catch {
      // Backend not available — keep previous values
    } finally {
      setIsRefreshing(false);
      countdownRef.current = REFRESH_INTERVAL;
      setCountdown(REFRESH_INTERVAL);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchMetrics();
    fetchEvents();
  }, [fetchMetrics, fetchEvents]);

  // Countdown ticker — triggers real API refresh
  useEffect(() => {
    const tick = setInterval(() => {
      const next = Math.max(countdownRef.current - 1, 0);
      countdownRef.current = next;
      setCountdown(next);
      if (next <= 0) {
        countdownRef.current = REFRESH_INTERVAL;
        fetchMetrics();
        fetchEvents();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [fetchMetrics, fetchEvents]);

  // Supabase Realtime — subscribe to leads INSERT for instant chart updates
  useEffect(() => {
    if (!isSupabaseAvailable()) return;

    const channel = supabase
      .channel('live-dashboard-leads')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'leads' },
        () => { fetchMetrics(); },
      )
      .subscribe((status) => {
        setIsRealtime(status === 'SUBSCRIBED');
      });

    return () => { supabase.removeChannel(channel); };
  }, [fetchMetrics]);

  const progress = ((REFRESH_INTERVAL - countdown) / REFRESH_INTERVAL) * 100;

  const activeCampaigns = metrics?.connectedIntegrations ?? '—';
  const messagesToday = metrics?.totalLeads ?? '—';
  const appointmentsToday = metrics?.byStage?.appointment ?? '—';
  const conversionRate = metrics?.conversionRate != null ? `${metrics.conversionRate}%` : '—';

  const hasChartData = chartData.some((d) => d.leads > 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-white">Live</h2>
            {isRealtime ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                <Radio size={10} className="animate-pulse" />
                Realtime
              </span>
            ) : usingApiData ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                API Data
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-gray-500/10 text-gray-400 border border-gray-500/20">
                Waiting for API
              </span>
            )}
          </div>
          <p className="text-gray-400 mt-0.5">Metrics and activity feed refresh every 30s from backend APIs.</p>
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
            onClick={() => { fetchMetrics(); fetchEvents(); }}
            disabled={isRefreshing}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            {isRefreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </div>

      {/* API metrics */}
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
                {hasChartData ? 'Hourly lead activity for today.' : 'No lead activity recorded today yet.'}
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
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="time" stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }} interval={3} />
              <YAxis stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                labelStyle={{ color: '#9ca3af', fontSize: 11 }}
                itemStyle={{ fontSize: 12 }}
              />
              <Area type="monotone" dataKey="leads" stroke="#0ea5e9" strokeWidth={2} fill="url(#leadsG)" name="Leads" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Activity Feed */}
        <div className="card flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Activity Feed</h3>
            {feedLoading && <Loader2 size={14} className="animate-spin text-gray-500" />}
          </div>
          <div className="space-y-3 flex-1 overflow-y-auto max-h-64 xl:max-h-none">
            {feed.length === 0 && !feedLoading ? (
              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-dark-800/60 border border-dark-600/40">
                <Circle size={8} className="text-gray-500 shrink-0 mt-1.5" fill="currentColor" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-400 leading-relaxed">
                    No events yet. Run a Figma sync or GitHub sync to populate the feed.
                  </p>
                </div>
              </div>
            ) : (
              feed.map(event => (
                <div key={event.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-dark-800/60 border border-dark-600/40">
                  {event.type === 'github_sync' ? (
                    <GitBranch size={12} className="text-violet-400 shrink-0 mt-1" />
                  ) : (
                    <Circle size={8} className={`${eventColor(event.type)} shrink-0 mt-1.5`} fill="currentColor" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-300 leading-relaxed truncate">{event.message}</p>
                    {event.createdAt && (
                      <p className="text-xs text-gray-600 mt-0.5">{timeAgo(event.createdAt)}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
