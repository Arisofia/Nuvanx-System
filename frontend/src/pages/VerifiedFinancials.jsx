import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { DollarSign, TrendingUp, Clock, AlertTriangle, RefreshCw, Loader2, Users, CheckCircle } from 'lucide-react';
import api from '../config/api';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n ?? 0);
// GDPR: only show last 4 chars of DNI in dashboards
const maskDni = (dni) => dni ? ('***' + String(dni).slice(-4)) : '—';
const fmtEur = (n) => `€${fmt(n)}`;
const fmtPct = (n) => `${(n ?? 0).toFixed(1)}%`;

const TEMPLATE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
const DIAGNOSTIC_PRIORITY = {
  database_unavailable: 100,
  missing_clinic_mapping: 90,
  no_settlements: 80,
  no_patients: 70,
  ok: 0,
};

function pickMostActionableDiagnostics(candidates) {
  const valid = (candidates || []).filter(Boolean);
  if (valid.length === 0) return null;
  return valid.reduce((best, curr) => {
    const bestScore = DIAGNOSTIC_PRIORITY[best?.reason] ?? 10;
    const currScore = DIAGNOSTIC_PRIORITY[curr?.reason] ?? 10;
    return currScore > bestScore ? curr : best;
  }, valid[0]);
}

function KpiCard({ label, value, sub, icon: Icon, accent = 'brand' }) {
  const accents = {
    brand: 'text-brand-400 bg-brand-500/10',
    green: 'text-emerald-400 bg-emerald-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    red: 'text-red-400 bg-red-500/10',
  };
  return (
    <div className="card py-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm text-gray-400">{label}</p>
        {Icon && (
          <span className={`p-2 rounded-lg ${accents[accent]}`}>
            <Icon size={16} className={accents[accent].split(' ')[0]} />
          </span>
        )}
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
          {fmtEur(p.value)}
        </p>
      ))}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function VerifiedFinancials() {
  const [data, setData] = useState(null);
  const [settlements, setSettlements] = useState([]);
  const [patients, setPatients] = useState([]);
  const [diagnostics, setDiagnostics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview'); // 'overview' | 'settlements' | 'patients'
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, settleRes, patientsRes] = await Promise.all([
        api.get('/api/financials/summary'),
        api.get('/api/financials/settlements'),
        api.get('/api/financials/patients'),
      ]);
      setData(summaryRes.data);
      setSettlements(settleRes.data.settlements || []);
      setPatients(patientsRes.data.patients || []);
      setDiagnostics(pickMostActionableDiagnostics([
        summaryRes.data?.diagnostics,
        settleRes.data?.diagnostics,
        patientsRes.data?.diagnostics,
      ]));
    } catch (err) {
      const message = err.response?.data?.message
        || err.response?.data?.error
        || err.message
        || 'Failed to load financial data';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, refreshKey]);

  if (loading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">Verified Financials</h2>
            <p className="text-gray-500 text-sm mt-0.5">Source of truth: Doctoralia settled operations</p>
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
          <Loader2 size={32} className="animate-spin text-brand-400" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="card border-red-500/20 bg-red-500/5 flex items-start gap-3">
          <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="font-semibold text-white mb-1">Error Loading Financials</h3>
            <p className="text-sm text-gray-300 mb-3">{error}</p>
            <button onClick={() => setRefreshKey(k => k + 1)} className="btn-secondary text-sm">Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const s = data?.summary || {};
  const monthly = data?.monthly || [];
  const templateMix = data?.templateMix || [];
  const diagnosticsReason = diagnostics?.reason || null;

  const diagnosticsMessage = {
    database_unavailable: 'Database is unavailable. Configure DATABASE_URL/Supabase DB credentials in production.',
    missing_clinic_mapping: 'Your user is not linked to a clinic. Assign users.clinic_id to unlock financial data.',
    no_settlements: 'No settlement rows found for your clinic yet. Run the Doctoralia sync workflow/script and verify CLINIC_ID.',
    no_patients: 'No patient rows found for your clinic yet.',
  }[diagnosticsReason] || null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">Verified Financials</h2>
          <p className="text-gray-400 mt-0.5 text-sm">
            Source of truth: Doctoralia settled operations &mdash; overrides all estimated revenue
          </p>
        </div>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {diagnosticsMessage && diagnosticsReason !== 'ok' && (
        <div className="card border-amber-500/20 bg-amber-500/5 flex items-start gap-3">
          <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="font-semibold text-white mb-1">Data Diagnostics</h3>
            <p className="text-sm text-gray-300 mb-1">{diagnosticsMessage}</p>
            <p className="text-xs text-gray-500">
              reason: <span className="text-gray-400">{diagnosticsReason}</span>
              {diagnostics?.clinicId ? (
                <>
                  {' '}· clinic_id: <span className="text-gray-400">{diagnostics.clinicId}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Net Revenue (Verified)"
          value={fmtEur(s.totalNet)}
          sub={`${s.settledCount ?? 0} settled operations`}
          icon={DollarSign}
          accent="green"
        />
        <KpiCard
          label="Avg Ticket"
          value={fmtEur(s.avgTicket)}
          sub="per settled operation"
          icon={TrendingUp}
          accent="brand"
        />
        <KpiCard
          label="Avg Liquidation"
          value={`${s.avgLiquidationDays ?? 0}d`}
          sub="days from intake to settlement"
          icon={Clock}
          accent="amber"
        />
        <KpiCard
          label="Discount Rate"
          value={fmtPct(s.discountRate)}
          sub={`${fmtEur(s.totalDiscount)} total discounts`}
          icon={AlertTriangle}
          accent={s.discountRate > 10 ? 'red' : 'green'}
        />
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1.5 border-b border-dark-600 pb-0">
        {[['overview', 'Overview'], ['settlements', 'Settlements'], ['patients', 'Patients (LTV)']].map(([id, label]) => (
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

      {/* Overview Tab */}
      {tab === 'overview' && (
        <div className="space-y-5">
          {/* Monthly Revenue Chart */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Monthly Net Revenue (Doctoralia)</h3>
            {monthly.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-8">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={monthly} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="net" stroke="#10b981" strokeWidth={2} fill="url(#netGrad)" dot={{ fill: '#10b981', r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Template Mix */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Financing Template Mix</h3>
              {templateMix.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">No data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={templateMix} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={v => `€${(v/1000).toFixed(1)}k`} />
                    <YAxis type="category" dataKey="name" width={180} tick={{ fill: '#9ca3af', fontSize: 10 }} />
                    <Tooltip formatter={(v) => fmtEur(v)} />
                    <Bar dataKey="net" radius={[0, 4, 4, 0]}>
                      {templateMix.map((_, i) => (
                        <Cell key={i} fill={TEMPLATE_COLORS[i % TEMPLATE_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Template stats table */}
            <div className="card p-0 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-dark-600">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Template</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Count</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Net</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-600">
                  {templateMix.map((t, i) => (
                    <tr key={t.name} className="hover:bg-dark-800/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TEMPLATE_COLORS[i % TEMPLATE_COLORS.length] }} />
                          <span className="text-xs text-gray-300 truncate max-w-[160px]">{t.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-gray-400">{t.count}</td>
                      <td className="px-4 py-3 text-right text-xs font-semibold text-white">{fmtEur(t.net)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-400">{fmtPct(t.pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Settlements Tab */}
      {tab === 'settlements' && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-600">
                  {['Op ID', 'Patient', 'DNI', 'Template', 'Gross', 'Discount', 'Net', 'Settled', 'Lag'].map(h => (
                    <th key={h} className="text-left px-4 py-3.5 text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-600">
                {settlements.map(s => {
                  const lagDays = s.intake_at
                    ? Math.round((new Date(s.settled_at) - new Date(s.intake_at)) / 86400000)
                    : null;
                  return (
                    <tr key={s.id} className={`hover:bg-dark-800/50 ${s.cancelled_at ? 'opacity-40' : ''}`}>
                      <td className="px-4 py-3 text-xs font-mono text-gray-500">{s.id}</td>
                      <td className="px-4 py-3 text-xs text-white font-medium">{s.patient_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded" title="DNI masked per GDPR">{maskDni(s.patient_dni)}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 max-w-[160px] truncate">{s.template_name}</td>
                      <td className="px-4 py-3 text-xs text-gray-300">{fmtEur(s.amount_gross)}</td>
                      <td className="px-4 py-3 text-xs text-red-400">{s.amount_discount > 0 ? `-${fmtEur(s.amount_discount)}` : '—'}</td>
                      <td className="px-4 py-3 text-xs font-bold text-emerald-400">{fmtEur(s.amount_net)}</td>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {s.settled_at ? new Date(s.settled_at).toLocaleDateString('es-ES') : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {lagDays !== null
                          ? <span className={`${lagDays > 30 ? 'text-amber-400' : 'text-gray-400'}`}>{lagDays}d</span>
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {settlements.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <DollarSign size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No settlements ingested yet</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Patients LTV Tab */}
      {tab === 'patients' && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-600">
                  {['Patient', 'DNI', 'Phone', 'Email', 'Total LTV', 'Last Visit', 'Since'].map(h => (
                    <th key={h} className="text-left px-4 py-3.5 text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-600">
                {patients.map(p => (
                  <tr key={p.id} className="hover:bg-dark-800/50">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400/30 to-emerald-600/30 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {(p.name || '?')[0]}
                        </div>
                        <span className="text-sm text-white font-medium">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded" title="DNI masked per GDPR">{maskDni(p.dni)}</span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-400">{p.phone || '—'}</td>
                    <td className="px-4 py-3.5 text-xs text-gray-400">{p.email || '—'}</td>
                    <td className="px-4 py-3.5">
                      <span className="text-sm font-bold text-emerald-400">{fmtEur(p.total_ltv)}</span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-400">
                      {p.last_visit ? new Date(p.last_visit).toLocaleDateString('es-ES') : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-500">
                      {p.created_at ? new Date(p.created_at).toLocaleDateString('es-ES') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {patients.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <Users size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No patients yet — add DNIs to leads or ingest Doctoralia data</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Data Source Badge */}
      <div className="flex items-center gap-2 text-xs text-gray-600">
        <CheckCircle size={12} className="text-emerald-500" />
        Verified data sourced from Doctoralia settlement exports. Estimated revenue fields in the CRM are overridden by these values.
      </div>
    </div>
  );
}
