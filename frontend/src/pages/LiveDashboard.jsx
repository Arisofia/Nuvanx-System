import { useState, useEffect, useRef } from 'react';
import { RefreshCw, Megaphone, MessageSquare, Calendar, TrendingUp, Circle } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

function generateHourlyData() {
  const now = new Date();
  return Array.from({ length: 24 }, (_, i) => {
    const h = new Date(now);
    h.setHours(now.getHours() - (23 - i), 0, 0, 0);
    const label = h.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return {
      time: label,
      leads: Math.floor(Math.random() * 18) + 2,
      messages: Math.floor(Math.random() * 35) + 5,
    };
  });
}

const MOCK_CAMPAIGNS = [
  { name: 'Spring Aesthetics — Meta Ads', status: 'active', impressions: '12,408', ctr: '3.2%' },
  { name: 'WhatsApp Nurture Sequence', status: 'active', impressions: '—', ctr: '—' },
  { name: 'Re-engagement — Dormant Q4', status: 'paused', impressions: '4,102', ctr: '1.8%' },
];

const INITIAL_FEED = [
  { id: 1, type: 'lead', msg: 'New lead received from Meta Ads — Sofia M.', time: '0m ago', color: 'text-blue-400' },
  { id: 2, type: 'message', msg: 'WhatsApp message sent to Carlos H.', time: '2m ago', color: 'text-emerald-400' },
  { id: 3, type: 'appointment', msg: 'Appointment booked — Camila L. at 3:00 PM', time: '5m ago', color: 'text-violet-400' },
  { id: 4, type: 'lead', msg: 'New lead received from Google Ads — Andrés G.', time: '8m ago', color: 'text-blue-400' },
  { id: 5, type: 'message', msg: 'Follow-up sent to Diego M. (day-7 sequence)', time: '12m ago', color: 'text-emerald-400' },
];

const REFRESH_INTERVAL = 30;

export default function LiveDashboard() {
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [metrics, setMetrics] = useState({ campaigns: 2, messages: 47, appointments: 8, conversion: 21.4 });
  const [chartData, setChartData] = useState(generateHourlyData);
  const [feed, setFeed] = useState(INITIAL_FEED);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const countdownRef = useRef(REFRESH_INTERVAL);

  function doRefresh() {
    setIsRefreshing(true);
    setTimeout(() => {
      setChartData(generateHourlyData());
      setMetrics(prev => ({
        campaigns: prev.campaigns,
        messages: prev.messages + Math.floor(Math.random() * 5),
        appointments: prev.appointments + (Math.random() > 0.7 ? 1 : 0),
        conversion: +(prev.conversion + (Math.random() * 0.4 - 0.2)).toFixed(1),
      }));
      const newEvents = [
        { id: Date.now(), type: 'lead', msg: 'New lead from Meta Ads campaign', time: 'just now', color: 'text-blue-400' },
        { id: Date.now() + 1, type: 'message', msg: 'Automated follow-up sent', time: 'just now', color: 'text-emerald-400' },
      ];
      setFeed(prev => [...newEvents, ...prev].slice(0, 10));
      setIsRefreshing(false);
      countdownRef.current = REFRESH_INTERVAL;
      setCountdown(REFRESH_INTERVAL);
    }, 600);
  }

  useEffect(() => {
    const tick = setInterval(() => {
      countdownRef.current -= 1;
      setCountdown(countdownRef.current);
      if (countdownRef.current <= 0) {
        doRefresh();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const progress = ((REFRESH_INTERVAL - countdown) / REFRESH_INTERVAL) * 100;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-white">Live Metrics</h2>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
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
            onClick={doRefresh}
            disabled={isRefreshing}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Live metrics */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Active Campaigns', value: metrics.campaigns, icon: Megaphone, color: 'text-brand-400', bg: 'bg-brand-500/10' },
          { label: 'Messages Today', value: metrics.messages, icon: MessageSquare, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Appointments Today', value: metrics.appointments, icon: Calendar, color: 'text-violet-400', bg: 'bg-violet-500/10' },
          { label: 'Live Conversion Rate', value: `${metrics.conversion}%`, icon: TrendingUp, color: 'text-amber-400', bg: 'bg-amber-500/10' },
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
              <p className="text-xs text-gray-500 mt-0.5">Leads & messages per hour</p>
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
                  <p className="text-xs text-gray-600 mt-0.5">{event.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Campaigns Status */}
      <div className="card">
        <h3 className="font-semibold text-white mb-4">Active Campaigns</h3>
        <div className="space-y-3">
          {MOCK_CAMPAIGNS.map(c => (
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
    </div>
  );
}
