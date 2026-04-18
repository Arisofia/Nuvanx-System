import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  FunnelChart, Funnel, LabelList,
  ResponsiveContainer, Cell,
} from 'recharts';
import { Target, MessageCircle, Users, TrendingUp, Phone, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import api from '../config/api';

const fmt = (n) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n ?? 0);
const fmtEur = (n) => `€${fmt(n)}`;
const fmtPct = (n) => `${(+(n ?? 0)).toFixed(1)}%`;

const CAMPAIGN_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];

const FUNNEL_STAGES = [
  { key: 'total_leads',   label: 'Leads',     color: '#6366f1' },
  { key: 'contacted',     label: 'Contacted', color: '#8b5cf6' },
  { key: 'replied',       label: 'Replied',   color: '#06b6d4' },
  { key: 'booked',        label: 'Booked',    color: '#10b981' },
  { key: 'attended',      label: 'Attended',  color: '#f59e0b' },
  { key: 'closed_won',    label: 'Closed',    color: '#22c55e' },
];

function KpiCard({ label, value, sub, icon, accent = 'brand' }) {
  const Icon = icon;
  const accents = {
    brand:  'text-indigo-400 bg-indigo-500/10',
    green:  'text-emerald-400 bg-emerald-500/10',
    amber:  'text-amber-400 bg-amber-500/10',
    cyan:   'text-cyan-400 bg-cyan-500/10',
  };
  return (
    <div className="card py-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm text-gray-400">{label}</p>
        <span className={`p-2 rounded-lg ${accents[accent]}`}>
          <Icon size={16} className={accents[accent].split(' ')[0]} />
        </span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg p-3 shadow-xl text-xs">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="font-semibold" style={{ color: p.color }}>
          {p.dataKey.includes('revenue') ? fmtEur(p.value) : fmt(p.value)} {p.name}
        </p>
      ))}
    </div>
  );
};

export default function CampaignIntelligence() {
  const [campaigns, setCampaigns] = useState([]);
  const [funnel, setFunnel]       = useState([]);
  const [convs, setConvs]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [tab, setTab]             = useState('campaigns'); // 'campaigns' | 'funnel' | 'conversations'
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [campRes, funnelRes, convsRes] = await Promise.all([
        api.get('/api/traceability/campaigns'),
        api.get('/api/traceability/funnel'),
        api.get('/api/conversations'),
      ]);
      setCampaigns(campRes.data.campaigns || []);
      setFunnel(funnelRes.data.funnel || []);
      setConvs(convsRes.data.conversations || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load intelligence data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, refreshKey]);

  // Aggregate funnel totals across all sources
  const totalFunnel = FUNNEL_STAGES.map(stage => ({
    name:  stage.label,
    value: funnel.reduce((sum, row) => sum + (Number(row[stage.key]) || 0), 0),
    fill:  stage.color,
  }));

  // KPI rollups from campaigns view
  const totalLeads    = campaigns.reduce((s, c) => s + Number(c.total_leads || 0), 0);
  const totalContacted= campaigns.reduce((s, c) => s + Number(c.contacted || 0), 0);
  const totalReplied  = campaigns.reduce((s, c) => s + Number(c.replied || 0), 0);
  const totalRevenue  = campaigns.reduce((s, c) => s + Number(c.verified_revenue || 0), 0);
  const replyRate     = totalContacted > 0 ? (totalReplied / totalContacted * 100).toFixed(1) : '—';
  const convRate      = totalLeads > 0 ? (campaigns.reduce((s, c) => s + Number(c.closed_won || 0), 0) / totalLeads * 100).toFixed(1) : '—';

  if (loading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">Campaign Intelligence</h2>
            <p className="text-gray-500 text-sm mt-0.5">Meta lead attribution → WhatsApp funnel → Verified revenue</p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card py-5 animate-pulse">
              <div className="h-4 bg-dark-600 rounded w-2/3 mb-3" />
              <div className="h-8 bg-dark-600 rounded w-1/2" />
            </div>
          ))}
        </div>
        <div className="card py-12 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-indigo-400" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <h2 className="text-2xl font-bold text-white">Campaign Intelligence</h2>
        <div className="card flex items-center gap-3 text-red-400">
          <AlertCircle size={20} />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Campaign Intelligence</h2>
          <p className="text-gray-500 text-sm mt-0.5">Meta lead attribution → WhatsApp funnel → Verified revenue</p>
        </div>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          className="btn-secondary flex items-center gap-1.5 text-sm"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Leads" value={fmt(totalLeads)} sub={`${totalContacted} contacted`} icon={Users} accent="brand" />
        <KpiCard label="Reply Rate" value={`${replyRate}%`} sub={`${totalReplied} replied`} icon={MessageCircle} accent="cyan" />
        <KpiCard label="Conversion Rate" value={`${convRate}%`} sub="Leads → closed won" icon={TrendingUp} accent="green" />
        <KpiCard label="Verified Revenue" value={fmtEur(totalRevenue)} sub="from closed-won leads" icon={Target} accent="amber" />
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1.5 border-b border-dark-600 pb-0">
        {[['campaigns', 'Campaigns'], ['funnel', 'WhatsApp Funnel'], ['conversations', 'Conversations']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === id
                ? 'bg-dark-700 text-white border border-dark-600 border-b-dark-700 -mb-px'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Campaigns Tab */}
      {tab === 'campaigns' && (
        <div className="space-y-5">
          {/* Revenue by campaign chart */}
          {campaigns.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Verified Revenue by Campaign</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={campaigns.slice(0, 10)} margin={{ top: 4, right: 4, left: -10, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="campaign_name"
                    tick={{ fill: '#9ca3af', fontSize: 10 }}
                    angle={-30}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="verified_revenue" name="Revenue" radius={[4, 4, 0, 0]}>
                    {campaigns.slice(0, 10).map((_, i) => (
                      <Cell key={i} fill={CAMPAIGN_COLORS[i % CAMPAIGN_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Campaigns table */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-dark-600">
                    {['Campaign', 'Leads', 'Contacted', 'Replied', 'Booked', 'Attended', 'Closed', 'Revenue', 'Reply %', 'Avg Reply (min)'].map(h => (
                      <th key={h} className="text-left px-4 py-3.5 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-600">
                  {campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-12 text-center text-gray-500 text-sm">
                        No campaign data yet. Meta leads will be attributed once they arrive through the webhook.
                      </td>
                    </tr>
                  ) : campaigns.map((c, i) => (
                    <tr key={c.campaign_id || i} className="hover:bg-dark-800/50">
                      <td className="px-4 py-3 text-sm text-white font-medium max-w-[200px]">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CAMPAIGN_COLORS[i % CAMPAIGN_COLORS.length] }} />
                          <span className="truncate">{c.campaign_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">{fmt(c.total_leads)}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{fmt(c.contacted)}</td>
                      <td className="px-4 py-3 text-sm text-cyan-400">{fmt(c.replied)}</td>
                      <td className="px-4 py-3 text-sm text-violet-400">{fmt(c.booked)}</td>
                      <td className="px-4 py-3 text-sm text-amber-400">{fmt(c.attended)}</td>
                      <td className="px-4 py-3 text-sm text-emerald-400 font-semibold">{fmt(c.closed_won)}</td>
                      <td className="px-4 py-3 text-sm font-bold text-white">{fmtEur(c.verified_revenue)}</td>
                      <td className="px-4 py-3 text-sm text-gray-400">{c.reply_rate_pct != null ? fmtPct(c.reply_rate_pct) : '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-400">{c.avg_reply_delay_min != null ? `${c.avg_reply_delay_min}m` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Funnel Tab */}
      {tab === 'funnel' && (
        <div className="space-y-5">
          {/* Funnel chart */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Lead-to-Revenue Funnel (all sources)</h3>
            {totalFunnel[0]?.value === 0 ? (
              <p className="text-gray-500 text-sm text-center py-8">No funnel data yet. Stages will populate as leads progress through the pipeline.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={totalFunnel} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Bar dataKey="value" name="Count" radius={[4, 4, 0, 0]}>
                    {totalFunnel.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Funnel by source table */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-dark-600">
                    {['Source', 'Leads', 'Contacted', 'Replied', 'Attended', 'No-shows', 'Closed', 'Revenue', 'Avg Reply (min)'].map(h => (
                      <th key={h} className="text-left px-4 py-3.5 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-600">
                  {funnel.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-gray-500 text-sm">
                        No funnel data yet.
                      </td>
                    </tr>
                  ) : funnel.map((row) => (
                    <tr key={row.source} className="hover:bg-dark-800/50">
                      <td className="px-4 py-3 text-sm text-white font-medium">{row.source || 'Unknown'}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{fmt(row.total_leads)}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{fmt(row.contacted)}</td>
                      <td className="px-4 py-3 text-sm text-cyan-400">{fmt(row.replied)}</td>
                      <td className="px-4 py-3 text-sm text-amber-400">{fmt(row.attended)}</td>
                      <td className="px-4 py-3 text-sm text-red-400">{fmt(row.no_shows)}</td>
                      <td className="px-4 py-3 text-sm text-emerald-400 font-semibold">{fmt(row.closed_won)}</td>
                      <td className="px-4 py-3 text-sm font-bold text-white">{fmtEur(row.verified_revenue)}</td>
                      <td className="px-4 py-3 text-sm text-gray-400">{row.avg_reply_min != null ? `${row.avg_reply_min}m` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Conversations Tab */}
      {tab === 'conversations' && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-600">
                  {['Phone', 'Direction', 'Type', 'Preview', 'Sent', 'Replied'].map(h => (
                    <th key={h} className="text-left px-4 py-3.5 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-600">
                {convs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-500 text-sm">
                      No WhatsApp conversations recorded yet. Conversations will appear here once messages are sent via the CRM.
                    </td>
                  </tr>
                ) : convs.map((c) => (
                  <tr key={c.id} className="hover:bg-dark-800/50">
                    <td className="px-4 py-3 text-xs font-mono text-gray-300">{c.phone}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.direction === 'outbound'
                          ? 'bg-indigo-500/10 text-indigo-400'
                          : 'bg-emerald-500/10 text-emerald-400'
                      }`}>
                        {c.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{c.message_type}</td>
                    <td className="px-4 py-3 text-xs text-gray-300 max-w-[280px] truncate">{c.message_preview || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {c.sent_at ? new Date(c.sent_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {c.replied_at ? new Date(c.replied_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Attribution note */}
      <div className="text-center text-xs text-gray-600 pb-2">
        Campaign attribution captured at Meta webhook ingestion ·
        WhatsApp funnel populated from send events ·
        Revenue verified against Doctoralia settlements only
      </div>
    </div>
  );
}
