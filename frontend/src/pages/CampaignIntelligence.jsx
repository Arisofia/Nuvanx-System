import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import {
  RefreshCw, TrendingUp, Users, MessageSquare, Target,
  CheckCircle, AlertTriangle, XCircle, Lock,
} from 'lucide-react';
import api from '../config/api';

// ─── helpers ─────────────────────────────────────────────────────────────────
const fmt    = (n) => (n == null ? '—' : Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtN   = (n) => (n == null ? '—' : Number(n).toFixed(1));
const fmtPct = (n) => (n == null ? '—' : `${fmtN(n)}%`);
const fmtEur = (n) => (n == null ? '—' : `€${fmt(n)}`);
const MONTH_LABEL = (iso) => {
  if (!iso) return '?';
  return new Date(iso).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
};
const COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#818cf8'];

function KpiCard({ title, value, sub, icon, color = 'purple', blocked = false }) {
  const Icon = icon;
  const border = {
    purple: 'border-purple-700/30 from-purple-600/20 to-purple-800/10',
    blue:   'border-blue-700/30   from-blue-600/20   to-blue-800/10',
    green:  'border-emerald-700/30 from-emerald-600/20 to-emerald-800/10',
    amber:  'border-amber-700/30  from-amber-600/20  to-amber-800/10',
    red:    'border-red-700/30    from-red-600/20    to-red-800/10',
  };
  return (
    <div className={`bg-gradient-to-br ${border[color]} border rounded-xl p-4 flex flex-col gap-1`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 uppercase tracking-wide">{title}</span>
        {blocked ? <Lock size={12} className="text-gray-600" /> : <Icon size={14} className="text-gray-400" />}
      </div>
      <div className={`text-2xl font-bold ${blocked ? 'text-gray-600' : 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

function BlockedBadge({ reason, field }) {
  return (
    <div className="flex items-start gap-2 bg-gray-800/40 border border-gray-700/40 rounded-lg p-3 text-xs">
      <Lock size={12} className="mt-0.5 text-gray-500 shrink-0" />
      <div>
        <span className="text-gray-400">{reason}</span>
        {field && <div className="text-gray-600 mt-0.5">Requires: {field}</div>}
      </div>
    </div>
  );
}

const TABS = [
  { id: 'doctoralia',   label: 'Doctoralia Financials' },
  { id: 'campaigns',    label: 'Campaign Performance' },
  { id: 'funnel',       label: 'WhatsApp Funnel' },
  { id: 'traceability', label: 'Lead Traceability' },
];

export default function CampaignIntelligence() {
  const [tab,          setTab]          = useState('doctoralia');
  const [refreshKey,   setRefreshKey]   = useState(0);
  const [kpis,         setKpis]         = useState(null);
  const [docFin,       setDocFin]       = useState(null);
  const [campaigns,    setCampaigns]    = useState([]);
  const [funnelData,   setFunnelData]   = useState([]);
  const [traceability, setTraceability] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [kpiR, docR, campR, funnelR, traceR] = await Promise.allSettled([
        api.get('/api/kpis'),
        api.get('/api/reports/doctoralia-financials'),
        api.get('/api/reports/campaign-performance'),
        api.get('/api/traceability/funnel'),
        api.get('/api/traceability/leads'),
      ]);
      if (kpiR.status    === 'fulfilled') setKpis(kpiR.value.data);
      if (docR.status    === 'fulfilled') setDocFin(docR.value.data);
      if (campR.status   === 'fulfilled') setCampaigns(campR.value.data?.campaigns || []);
      if (funnelR.status === 'fulfilled') setFunnelData(funnelR.value.data?.funnel || []);
      if (traceR.status  === 'fulfilled') setTraceability(traceR.value.data?.leads || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, refreshKey]);

  const doc     = kpis?.doctoralia ?? {};
  const acq     = kpis?.acquisition ?? {};
  const blocked = kpis?.blocked ?? [];
  const byMonth         = docFin?.byMonth         ?? [];
  const templateSummary = docFin?.templateSummary ?? [];

  return (
    <div className="p-6 space-y-6 text-white min-h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Revenue Intelligence</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Doctoralia-verified settlements · Meta attribution · WhatsApp funnel
          </p>
        </div>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm"
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-sm text-red-300">{error}</div>
      )}

      {/* Doctoralia KPIs — always real */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard icon={TrendingUp}    color="purple" title="Verified Net"      value={fmtEur(doc.totalNet)}        sub="Doctoralia settled" />
        <KpiCard icon={TrendingUp}    color="blue"   title="Avg Ticket"        value={fmtEur(doc.avgTicket)}       sub="per settled op" />
        <KpiCard icon={CheckCircle}   color="green"  title="Settled Ops"       value={doc.settledCount ?? '—'}     sub="non-cancelled" />
        <KpiCard icon={XCircle}       color="amber"  title="Cancelled Ops"     value={doc.cancelledCount ?? '—'}   sub="excluded from net" />
        <KpiCard icon={Target}        color="purple" title="Discount Rate"     value={fmtPct(doc.discountRate)}    sub="vs gross" />
        <KpiCard icon={AlertTriangle} color="amber"  title="Liquidation Lag"   value={doc.avgLiquidationDays != null ? `${fmtN(doc.avgLiquidationDays)}d` : '—'} sub="intake → settled" />
      </div>

      {/* Acquisition KPIs — blocked until leads exist */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard icon={Users}         color="blue"   title="Total Leads"  value={acq.totalLeads || '—'} blocked={!acq.totalLeads} sub="Meta + manual" />
        <KpiCard icon={MessageSquare} color="green"  title="Contacted"    value={acq.contacted  || '—'} blocked={!acq.totalLeads} sub="first outbound" />
        <KpiCard icon={MessageSquare} color="green"  title="Replied"      value={acq.replied    || '—'} blocked={!acq.totalLeads} sub="first inbound" />
        <KpiCard icon={TrendingUp}    color="purple" title="Reply Rate"
          value={acq.replyRate != null ? fmtPct(acq.replyRate) : '—'}
          blocked={!acq.totalLeads} sub="replied / contacted" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors
              ${tab === t.id ? 'bg-gray-800 text-white border-b-2 border-purple-500' : 'text-gray-400 hover:text-gray-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Doctoralia Financials ──────────────────────────────────────────── */}
      {tab === 'doctoralia' && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Net Settled Revenue by Month</h3>
            {byMonth.length === 0 ? (
              <div className="text-gray-500 text-sm text-center py-8">No settlement data.</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byMonth.map(r => ({ month: MONTH_LABEL(r.settled_month), net: Number(r.total_net) }))}>
                  <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false}
                    tickFormatter={v => `€${(v / 1000).toFixed(1)}k`} />
                  <Tooltip formatter={(v) => [`€${fmt(v)}`, 'Net']}
                    contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                    labelStyle={{ color: '#d1d5db' }} />
                  <Bar dataKey="net" fill="#a78bfa" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="net" position="top" formatter={v => `€${fmt(v)}`}
                      style={{ fill: '#c4b5fd', fontSize: 10 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Template Mix</h3>
            {templateSummary.length === 0 ? (
              <div className="text-gray-500 text-sm">No templates.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {templateSummary.map((t, i) => (
                  <div key={t.template_id} className="bg-gray-800/60 border border-gray-700/40 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-xs font-medium text-white truncate" title={t.template_name}>{t.template_name}</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>Ops: <strong className="text-white">{t.operations_count}</strong></span>
                      <span>Net: <strong className="text-purple-300">{fmtEur(t.total_net)}</strong></span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>Avg ticket: <strong className="text-white">{fmtEur(t.avg_ticket)}</strong></span>
                      <span>Share: <strong className="text-white">{fmtPct(t.revenue_share_pct)}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <h3 className="text-sm font-semibold text-gray-300">Template × Month Detail</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-800/60 text-gray-400 text-left">
                    {['Month','Template','Ops','Gross','Discount','Net','Avg Ticket','Discount %','Cancel %','Lag (d)'].map(h => (
                      <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {(docFin?.byTemplate ?? []).map((row, i) => (
                    <tr key={i} className="hover:bg-gray-800/30 text-gray-300">
                      <td className="px-3 py-2 whitespace-nowrap">{MONTH_LABEL(row.settled_month)}</td>
                      <td className="px-3 py-2 max-w-[180px] truncate" title={row.template_name}>{row.template_name}</td>
                      <td className="px-3 py-2">{row.operations_count}</td>
                      <td className="px-3 py-2">{fmtEur(row.total_gross)}</td>
                      <td className="px-3 py-2">{fmtEur(row.total_discount)}</td>
                      <td className="px-3 py-2 font-semibold text-purple-300">{fmtEur(row.total_net)}</td>
                      <td className="px-3 py-2">{fmtEur(row.avg_ticket_net)}</td>
                      <td className="px-3 py-2">{fmtPct(row.discount_rate_pct)}</td>
                      <td className="px-3 py-2">{fmtPct(row.cancellation_rate_pct)}</td>
                      <td className="px-3 py-2">{row.avg_liquidation_lag_days != null ? `${row.avg_liquidation_lag_days}d` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-gray-600">
            Source: Doctoralia financing export. Net = Gross − Discount. Cancelled ops excluded.
            Liquidation lag = days from intake to settlement. Data as at last CSV upload.
          </p>
        </div>
      )}

      {/* ── Campaign Performance ───────────────────────────────────────────── */}
      {tab === 'campaigns' && (
        <div className="space-y-4">
          {campaigns.length === 0 ? (
            <div className="space-y-3">
              <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 text-sm text-amber-300">
                No campaign data yet. This view populates automatically when Meta Ads leads arrive via webhook.
              </div>
              {blocked.filter(b => ['acquisition','conversion'].includes(b.kpi_group)).map(b => (
                <BlockedBadge key={b.kpi_name} reason={b.blocked_reason} field={b.required_field} />
              ))}
            </div>
          ) : (
            <>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Leads by Campaign</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={campaigns.slice(0, 10).map(c => ({ name: (c.campaign_name || 'Unknown').slice(0, 22), leads: c.total_leads }))}>
                    <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                    <Bar dataKey="leads" radius={[4, 4, 0, 0]}>
                      {campaigns.slice(0, 10).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-800/60 text-gray-400 text-left">
                        {['Campaign','Leads','Contacted','Replied','Booked','Attended','No Shows','Closed','Reply %','Close %','Avg Reply (min)'].map(h => (
                          <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {campaigns.map((c, i) => (
                        <tr key={i} className="hover:bg-gray-800/30 text-gray-300">
                          <td className="px-3 py-2 max-w-[200px] truncate" title={c.campaign_name}>{c.campaign_name}</td>
                          <td className="px-3 py-2 font-semibold">{c.total_leads}</td>
                          <td className="px-3 py-2">{c.contacted}</td>
                          <td className="px-3 py-2">{c.replied}</td>
                          <td className="px-3 py-2">{c.booked}</td>
                          <td className="px-3 py-2">{c.attended}</td>
                          <td className="px-3 py-2 text-red-400">{c.no_shows}</td>
                          <td className="px-3 py-2">{c.closed}</td>
                          <td className="px-3 py-2">{fmtPct(c.reply_rate_pct)}</td>
                          <td className="px-3 py-2">{fmtPct(c.lead_to_close_rate_pct)}</td>
                          <td className="px-3 py-2">{c.avg_reply_delay_min ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── WhatsApp Funnel ────────────────────────────────────────────────── */}
      {tab === 'funnel' && (
        <div className="space-y-4">
          {funnelData.length === 0 ? (
            <div className="space-y-3">
              <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 text-sm text-amber-300">
                No funnel data yet. Populates when leads are contacted via WhatsApp.
              </div>
              {blocked.filter(b => b.kpi_group === 'whatsapp').map(b => (
                <BlockedBadge key={b.kpi_name} reason={b.blocked_reason} field={b.required_field} />
              ))}
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-800/60 text-gray-400 text-left">
                      {['Source','Leads','Contacted','Replied','Attended','No Shows','Closed','Avg Reply (min)'].map(h => (
                        <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {funnelData.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-800/30 text-gray-300">
                        <td className="px-3 py-2 font-medium capitalize">{row.source}</td>
                        <td className="px-3 py-2 font-semibold">{row.total_leads}</td>
                        <td className="px-3 py-2">{row.contacted}</td>
                        <td className="px-3 py-2">{row.replied}</td>
                        <td className="px-3 py-2">{row.attended}</td>
                        <td className="px-3 py-2 text-red-400">{row.no_shows}</td>
                        <td className="px-3 py-2">{row.closed_won}</td>
                        <td className="px-3 py-2">{row.avg_reply_min ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Lead Traceability ─────────────────────────────────────────────── */}
      {tab === 'traceability' && (
        <div className="space-y-4">
          {traceability.length === 0 ? (
            <div className="space-y-3">
              <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4 text-sm text-amber-300">
                No lead traceability data yet. Full source-to-cash rows appear once Meta leads are ingested.
              </div>
              {blocked.filter(b => b.kpi_group === 'acquisition').slice(0, 2).map(b => (
                <BlockedBadge key={b.kpi_name} reason={b.blocked_reason} field={b.required_field} />
              ))}
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-800/60 text-gray-400 text-left">
                      {['Lead','Source','Campaign','Stage','Outreach','Reply','Appt','Est. Revenue','Doc. Net','Settlement'].map(h => (
                        <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {traceability.slice(0, 200).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-800/30 text-gray-300">
                        <td className="px-3 py-2 max-w-[130px] truncate">{row.lead_name || row.phone_normalized || '—'}</td>
                        <td className="px-3 py-2 capitalize">{row.source}</td>
                        <td className="px-3 py-2 max-w-[140px] truncate" title={row.campaign_name}>{row.campaign_name || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            row.stage === 'closed' ? 'bg-green-900/50 text-green-300' :
                            row.stage === 'lost'   ? 'bg-red-900/50 text-red-300' :
                            'bg-gray-700/50 text-gray-300'
                          }`}>{row.stage}</span>
                        </td>
                        <td className="px-3 py-2">{row.first_outbound_at ? '✓' : '—'}</td>
                        <td className="px-3 py-2">{row.first_inbound_at  ? '✓' : '—'}</td>
                        <td className="px-3 py-2">{row.appointment_status || '—'}</td>
                        <td className="px-3 py-2">{row.estimated_revenue ? fmtEur(row.estimated_revenue) : '—'}</td>
                        <td className="px-3 py-2 text-purple-300">{row.doctoralia_net ? fmtEur(row.doctoralia_net) : '—'}</td>
                        <td className="px-3 py-2">{row.settlement_date ? new Date(row.settlement_date).toLocaleDateString('es-ES') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Blocked KPI catalogue — shown on non-Doctoralia tabs */}
      {blocked.length > 0 && tab !== 'doctoralia' && (
        <div className="border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
            <Lock size={12} />
            Blocked KPIs — {blocked.length} pending data ingestion
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {blocked
              .filter(b => {
                if (tab === 'campaigns') return ['acquisition', 'conversion', 'revenue'].includes(b.kpi_group);
                if (tab === 'funnel') return b.kpi_group === 'whatsapp';
                return tab === 'traceability';
              })
              .map(b => <BlockedBadge key={b.kpi_name} reason={b.blocked_reason} field={b.required_field} />)
            }
          </div>
        </div>
      )}
    </div>
  );
}
