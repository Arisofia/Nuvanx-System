import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, AlertCircle,
  Megaphone, Eye, MousePointer, DollarSign, BarChart2, Zap,
  Users, Target, Brain, ChevronDown, CheckCircle, Settings,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../config/api';

const PERIODS = [
  { label: '7 días', days: 7 },
  { label: '30 días', days: 30 },
  { label: '90 días', days: 90 },
];

function ChangeBadge({ value, inverse = false }) {
  if (value === null || value === undefined || isNaN(value)) {
    return <span className="text-xs text-gray-500">vs prev</span>;
  }
  const positive = inverse ? value < 0 : value > 0;
  const neutral = value === 0;
  if (neutral) return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
      <Minus size={10} />0%
    </span>
  );
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
      {positive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {positive ? '+' : ''}{value}%
    </span>
  );
}

function KpiCard({ label, value, unit = '', change, inverse = false, icon: Icon, color, bg }) {
  return (
    <div className="card flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className={`p-2 rounded-lg ${bg}`}>
          <Icon size={16} className={color} />
        </div>
        <ChangeBadge value={change} inverse={inverse} />
      </div>
      <div>
        <p className="text-2xl font-bold text-white tabular-nums">
          {unit === '€' && <span className="text-sm text-gray-400 mr-0.5">€</span>}
          {value}
          {unit && unit !== '€' && <span className="text-sm text-gray-400 ml-0.5">{unit}</span>}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

const STATUS_STYLES = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20',
  PAUSED: 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
  DELETED: 'bg-red-500/15 text-red-400 border border-red-500/20',
  ARCHIVED: 'bg-gray-500/15 text-gray-400 border border-gray-500/20',
};

function fmt(n, decimals = 0) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export default function MetaIntelligence() {
  const [days, setDays] = useState(30);
  const [insights, setInsights] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notConnected, setNotConnected] = useState(false);
  const [noAccountId, setNoAccountId] = useState(false);
  const [adAccountInput, setAdAccountInput] = useState('');
  const [savingAccount, setSavingAccount] = useState(false);

  // AI Analysis
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [analysisError, setAnalysisError] = useState('');

  const fetchData = useCallback(async (selectedDays = days) => {
    setLoading(true);
    setError(null);
    try {
      const [insRes, campRes] = await Promise.allSettled([
        api.get('/api/meta/insights', { params: { days: selectedDays } }),
        api.get('/api/meta/campaigns', { params: { days: selectedDays } }),
      ]);

      if (insRes.status === 'fulfilled') {
        const d = insRes.value.data;
        if (d.notConnected) { setNotConnected(true); return; }
        if (d.noAccountId) { setNoAccountId(true); return; }
        if (d.success) setInsights(d);
      } else {
        const msg = insRes.reason?.response?.data?.message;
        if (insRes.reason?.response?.data?.notConnected) { setNotConnected(true); return; }
        if (insRes.reason?.response?.data?.noAccountId) { setNoAccountId(true); return; }
        throw new Error(msg || 'Error fetching Meta insights');
      }

      if (campRes.status === 'fulfilled' && campRes.value.data?.success) {
        setCampaigns(campRes.value.data.campaigns ?? []);
      }
    } catch (err) {
      setError(err.message || 'Error connecting to Meta');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchData(days); }, [days]);

  const handleSaveAccountId = async () => {
    if (!adAccountInput.trim()) return;
    setSavingAccount(true);
    try {
      const id = adAccountInput.trim().replace(/^act_/, '');
      await api.patch('/api/integrations/meta', { metadata: { adAccountId: `act_${id}` } });
      toast.success('Ad Account ID saved');
      setNoAccountId(false);
      setAdAccountInput('');
      fetchData(days);
    } catch {
      toast.error('Could not save. Try again.');
    } finally {
      setSavingAccount(false);
    }
  };

  const handleAnalyze = async () => {
    if (!insights) return;
    setAnalyzing(true);
    setAnalysis('');
    setAnalysisError('');
    try {
      const payload = {
        data: {
          period: insights.period,
          summary: insights.summary,
          changes: insights.changes,
          campaigns: campaigns.map(c => ({
            name: c.name,
            status: c.status,
            objective: c.objective,
            insights: c.insights,
          })),
        },
        context: 'Clínica de medicina estética premium en Madrid. Objetivo: generar citas de consulta para tratamientos faciales, corporales y rejuvenecimiento.',
      };
      const res = await api.post('/api/ai/analyze', payload);
      if (res.data.success) {
        setAnalysis(res.data.analysis);
      } else {
        setAnalysisError(res.data.message || 'AI analysis unavailable');
      }
    } catch (err) {
      setAnalysisError(err.response?.data?.message || 'Error running AI analysis');
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Not connected state ──────────────────────────────────────────────────
  if (!loading && notConnected) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader days={days} setDays={setDays} onRefresh={() => fetchData(days)} loading={loading} />
        <div className="card border-amber-500/20 bg-amber-500/5">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-amber-500/10 shrink-0">
              <Megaphone size={24} className="text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Meta Ads not connected</h3>
              <p className="text-sm text-gray-300 mt-1">Add your Meta access token in the Integrations page to start seeing real campaign data.</p>
              <a href="/integrations" className="btn-primary inline-flex items-center gap-2 text-sm mt-3">
                <Settings size={14} /> Go to Integrations
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── No account ID state ──────────────────────────────────────────────────
  if (!loading && noAccountId) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <PageHeader days={days} setDays={setDays} onRefresh={() => fetchData(days)} loading={loading} />
        <div className="card border-brand-500/20 bg-brand-500/5">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-brand-500/10 shrink-0">
              <Target size={24} className="text-brand-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white">Enter your Meta Ad Account ID</h3>
              <p className="text-sm text-gray-300 mt-1">
                Found in Meta Business Manager → Ad Accounts. Format: <code className="text-brand-400">act_1234567890</code>
              </p>
              <div className="flex gap-3 mt-4">
                <input
                  value={adAccountInput}
                  onChange={e => setAdAccountInput(e.target.value)}
                  placeholder="act_1234567890 or just the number"
                  className="input flex-1 max-w-sm"
                  onKeyDown={e => e.key === 'Enter' && handleSaveAccountId()}
                />
                <button
                  onClick={handleSaveAccountId}
                  disabled={savingAccount || !adAccountInput.trim()}
                  className="btn-primary flex items-center gap-2"
                >
                  {savingAccount ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  Save & Load
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const s = insights?.summary;
  const ch = insights?.changes;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <PageHeader days={days} setDays={setDays} onRefresh={() => fetchData(days)} loading={loading} />

      {error && (
        <div className="card border-red-500/20 bg-red-500/5 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-300">{error}</p>
        </div>
      )}

      {/* KPI Grid */}
      {loading ? (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card h-24 animate-pulse bg-dark-700" />
          ))}
        </div>
      ) : s && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard label="Gasto Total" value={fmt(s.spend, 2)} unit="€" change={ch?.spend} inverse icon={DollarSign} color="text-amber-400" bg="bg-amber-500/10" />
            <KpiCard label="Impresiones" value={fmt(s.impressions)} change={ch?.impressions} icon={Eye} color="text-violet-400" bg="bg-violet-500/10" />
            <KpiCard label="Alcance" value={fmt(s.reach)} change={ch?.reach} icon={Users} color="text-blue-400" bg="bg-blue-500/10" />
            <KpiCard label="Clics" value={fmt(s.clicks)} change={ch?.clicks} icon={MousePointer} color="text-brand-400" bg="bg-brand-500/10" />
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard label="CTR" value={fmt(s.ctr, 2)} unit="%" change={ch?.impressions} icon={BarChart2} color="text-emerald-400" bg="bg-emerald-500/10" />
            <KpiCard label="CPC" value={fmt(s.cpc, 2)} unit="€" change={null} inverse icon={Target} color="text-pink-400" bg="bg-pink-500/10" />
            <KpiCard label="CPM" value={fmt(s.cpm, 2)} unit="€" change={null} inverse icon={Megaphone} color="text-orange-400" bg="bg-orange-500/10" />
            <KpiCard label="Conversiones" value={fmt(s.conversions)} change={ch?.conversions} icon={Zap} color="text-teal-400" bg="bg-teal-500/10" />
          </div>
        </>
      )}

      {/* Charts */}
      {!loading && insights?.daily?.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Spend trend */}
          <div className="card">
            <h3 className="font-semibold text-white mb-4">Gasto Diario (€)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={insights.daily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={d => d?.slice(5)} interval={Math.floor(insights.daily.length / 6)} />
                <YAxis stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={v => `€${v}`} />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#9ca3af', fontSize: 11 }}
                  formatter={v => [`€${Number(v).toFixed(2)}`, 'Gasto']}
                />
                <Area type="monotone" dataKey="spend" stroke="#f59e0b" strokeWidth={2} fill="url(#spendG)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Clicks + Impressions */}
          <div className="card">
            <h3 className="font-semibold text-white mb-4">Clics e Impresiones Diarias</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={insights.daily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={d => d?.slice(5)} interval={Math.floor(insights.daily.length / 6)} />
                <YAxis yAxisId="left" stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#9ca3af', fontSize: 11 }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                <Bar yAxisId="left" dataKey="clicks" name="Clics" fill="#0ea5e9" radius={[2, 2, 0, 0]} />
                <Bar yAxisId="right" dataKey="impressions" name="Impresiones" fill="#8b5cf6" opacity={0.5} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Campaign Table */}
      {!loading && campaigns.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="px-5 py-4 border-b border-dark-600 flex items-center justify-between">
            <h3 className="font-semibold text-white">Campañas ({campaigns.length})</h3>
            <span className="text-xs text-gray-500">Últimos {days} días</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-600 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left font-medium">Campaña</th>
                  <th className="px-4 py-3 text-left font-medium">Estado</th>
                  <th className="px-4 py-3 text-right font-medium">Gasto</th>
                  <th className="px-4 py-3 text-right font-medium">Impresiones</th>
                  <th className="px-4 py-3 text-right font-medium">Clics</th>
                  <th className="px-4 py-3 text-right font-medium">CTR</th>
                  <th className="px-4 py-3 text-right font-medium">CPC</th>
                  <th className="px-4 py-3 text-right font-medium">Conversiones</th>
                  <th className="px-4 py-3 text-right font-medium">CPL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {campaigns.map(c => (
                  <tr key={c.id} className="hover:bg-dark-700/40 transition-colors">
                    <td className="px-5 py-3.5">
                      <div>
                        <p className="text-white font-medium truncate max-w-xs">{c.name}</p>
                        <p className="text-xs text-gray-500 capitalize">{c.objective?.toLowerCase()}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[c.status] || STATUS_STYLES.ARCHIVED}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-sm text-white">€{fmt(c.insights?.spend, 2) ?? '—'}</td>
                    <td className="px-4 py-3.5 text-right text-gray-300">{fmt(c.insights?.impressions) ?? '—'}</td>
                    <td className="px-4 py-3.5 text-right text-gray-300">{fmt(c.insights?.clicks) ?? '—'}</td>
                    <td className="px-4 py-3.5 text-right text-gray-300">{c.insights?.ctr != null ? `${fmt(c.insights.ctr, 2)}%` : '—'}</td>
                    <td className="px-4 py-3.5 text-right text-gray-300">{c.insights?.cpc != null ? `€${fmt(c.insights.cpc, 2)}` : '—'}</td>
                    <td className="px-4 py-3.5 text-right text-gray-300">{fmt(c.insights?.conversions) ?? '—'}</td>
                    <td className="px-4 py-3.5 text-right text-gray-300">{c.insights?.cpp != null ? `€${fmt(c.insights.cpp, 2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
              {/* Totals row */}
              {campaigns.some(c => c.insights) && (() => {
                const withIns = campaigns.filter(c => c.insights);
                const totals = withIns.reduce((acc, c) => ({
                  spend: acc.spend + (c.insights?.spend || 0),
                  impressions: acc.impressions + (c.insights?.impressions || 0),
                  clicks: acc.clicks + (c.insights?.clicks || 0),
                  conversions: acc.conversions + (c.insights?.conversions || 0),
                }), { spend: 0, impressions: 0, clicks: 0, conversions: 0 });
                const totCtr = totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : '—';
                const totCpc = totals.clicks > 0 ? (totals.spend / totals.clicks).toFixed(2) : '—';
                const totCpl = totals.conversions > 0 ? (totals.spend / totals.conversions).toFixed(2) : '—';
                return (
                  <tfoot>
                    <tr className="border-t border-dark-500 bg-dark-700/50 text-xs font-semibold text-white">
                      <td className="px-5 py-3" colSpan={2}>TOTAL</td>
                      <td className="px-4 py-3 text-right">€{fmt(totals.spend, 2)}</td>
                      <td className="px-4 py-3 text-right">{fmt(totals.impressions)}</td>
                      <td className="px-4 py-3 text-right">{fmt(totals.clicks)}</td>
                      <td className="px-4 py-3 text-right">{typeof totCtr === 'string' && totCtr !== '—' ? `${totCtr}%` : totCtr}</td>
                      <td className="px-4 py-3 text-right">{typeof totCpc === 'string' && totCpc !== '—' ? `€${totCpc}` : totCpc}</td>
                      <td className="px-4 py-3 text-right">{fmt(totals.conversions)}</td>
                      <td className="px-4 py-3 text-right">{typeof totCpl === 'string' && totCpl !== '—' ? `€${totCpl}` : totCpl}</td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
        </div>
      )}

      {/* AI Analysis */}
      {!loading && insights && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-violet-500/10">
                <Brain size={20} className="text-violet-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Análisis Inteligente con IA</h3>
                <p className="text-xs text-gray-500 mt-0.5">Gemini / OpenAI analiza tus campañas y genera recomendaciones accionables</p>
              </div>
            </div>
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
              {analyzing ? 'Analizando…' : 'Analizar Ahora'}
            </button>
          </div>

          {analysisError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              {analysisError}
            </div>
          )}

          {analysis && (
            <div className="mt-2 p-4 rounded-xl bg-dark-800 border border-dark-600">
              <div className="prose prose-invert prose-sm max-w-none text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                {analysis}
              </div>
            </div>
          )}

          {!analysis && !analysisError && !analyzing && (
            <div className="text-center py-8 text-gray-500 text-sm">
              Haz clic en "Analizar Ahora" para obtener un análisis completo de tus campañas con recomendaciones para esta semana.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PageHeader({ days, setDays, onRefresh, loading }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h2 className="text-2xl font-bold text-white">Marketing Intelligence</h2>
        <p className="text-gray-400 mt-0.5">KPIs reales de Meta Ads · Campañas · Análisis IA</p>
      </div>
      <div className="flex items-center gap-3">
        {/* Period selector */}
        <div className="flex rounded-lg border border-dark-600 overflow-hidden">
          {PERIODS.map(p => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                days === p.days
                  ? 'bg-brand-500/20 text-brand-400'
                  : 'text-gray-400 hover:text-white hover:bg-dark-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Actualizar
        </button>
      </div>
    </div>
  );
}
