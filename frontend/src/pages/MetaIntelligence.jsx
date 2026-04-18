import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, AlertCircle,
  Megaphone, Eye, MousePointer, DollarSign, BarChart2, Zap,
  Users, Target, Brain, CheckCircle, Settings,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../config/api';

const PERIODS = [
  { label: '7 días', days: 7 },
  { label: '30 días', days: 30 },
  { label: '90 días', days: 90 },
];

const PLATFORMS = [
  { id: 'meta', label: 'Meta Ads', accent: '#1877f2' },
  { id: 'google', label: 'Google Ads', accent: '#34a853' },
];

const STATUS_STYLES = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20',
  ENABLED: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20',
  PAUSED: 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
  DELETED: 'bg-red-500/15 text-red-400 border border-red-500/20',
  ARCHIVED: 'bg-gray-500/15 text-gray-400 border border-gray-500/20',
  REMOVED: 'bg-gray-500/15 text-gray-400 border border-gray-500/20',
};

function fmt(n, d = 0) {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function ChangeBadge({ value, inverse = false }) {
  if (value === null || value === undefined || isNaN(value)) {
    return <span className="text-xs text-gray-500">vs ant.</span>;
  }
  const positive = inverse ? value < 0 : value > 0;
  if (value === 0) return (
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
          {Icon ? <Icon size={16} className={color} /> : null}
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

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card h-24 animate-pulse bg-dark-700" />
      ))}
    </div>
  );
}

function NotConnectedState({ platform }) {
  return (
    <div className="card border-amber-500/20 bg-amber-500/5">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-amber-500/10 shrink-0">
          <Megaphone size={24} className="text-amber-400" />
        </div>
        <div>
          <h3 className="font-semibold text-white">
            {platform === 'google' ? 'Google Ads' : 'Meta Ads'} no conectado
          </h3>
          <p className="text-sm text-gray-300 mt-1">
            {platform === 'google'
              ? 'Añade tu Developer Token de Google Ads en Integraciones.'
              : 'Añade tu token de acceso de Meta en Integraciones.'}
          </p>
          <a href="/integrations" className="btn-primary inline-flex items-center gap-2 text-sm mt-3">
            <Settings size={14} /> Ir a Integraciones
          </a>
        </div>
      </div>
    </div>
  );
}

function NoAccountIdState({ platform, onSave }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const isGoogle = platform === 'google';

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      const service = isGoogle ? 'google_ads' : 'meta';
      const key = isGoogle ? 'customerId' : 'adAccountId';
      const raw = value.trim().replace(/-/g, '');
      const val = isGoogle ? raw : `act_${raw.replace(/^act_/, '')}`;
      await api.patch(`/api/integrations/${service}`, { metadata: { [key]: val } });
      toast.success('ID guardado');
      onSave(val);
    } catch {
      toast.error('No se pudo guardar. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card border-brand-500/20 bg-brand-500/5">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-brand-500/10 shrink-0">
          <Target size={24} className="text-brand-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-white">
            {isGoogle ? 'ID de Cliente de Google Ads' : 'ID de Cuenta Publicitaria de Meta'}
          </h3>
          <p className="text-sm text-gray-300 mt-1">
            {isGoogle
              ? 'Formato: 123-456-7890 (encuéntralo en Google Ads → Admin → Información)'
              : 'Formato: act_1234567890 (Meta Business Manager → Cuentas publicitarias)'}
          </p>
          <div className="flex gap-3 mt-4">
            <input
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={isGoogle ? '1234567890' : 'act_1234567890'}
              className="input flex-1 max-w-sm"
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
            <button
              onClick={handleSave}
              disabled={saving || !value.trim()}
              className="btn-primary flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DailyCharts({ daily, accentColor }) {
  if (!daily?.length) return null;
  const interval = Math.max(0, Math.floor(daily.length / 6));
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className="card">
        <h3 className="font-semibold text-white mb-4">Gasto Diario (€)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={daily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="spendG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={accentColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={accentColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }}
              tickFormatter={d => d?.slice(5)} interval={interval} />
            <YAxis stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }}
              tickFormatter={v => `€${v}`} />
            <Tooltip
              contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
              labelStyle={{ color: '#9ca3af', fontSize: 11 }}
              formatter={v => [`€${Number(v).toFixed(2)}`, 'Gasto']}
            />
            <Area type="monotone" dataKey="spend" stroke={accentColor} strokeWidth={2}
              fill="url(#spendG)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="card">
        <h3 className="font-semibold text-white mb-4">Clics e Impresiones Diarias</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={daily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }}
              tickFormatter={d => d?.slice(5)} interval={interval} />
            <YAxis yAxisId="left" stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 10 }} />
            <YAxis yAxisId="right" orientation="right" stroke="#6b7280"
              tick={{ fill: '#9ca3af', fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
              labelStyle={{ color: '#9ca3af', fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
            <Bar yAxisId="left" dataKey="clicks" name="Clics" fill="#0ea5e9" radius={[2, 2, 0, 0]} />
            <Bar yAxisId="right" dataKey="impressions" name="Impresiones" fill="#8b5cf6"
              opacity={0.5} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CampaignTable({ campaigns, days }) {
  if (!campaigns?.length) return null;
  const withIns = campaigns.filter(c => c.insights);
  const tot = withIns.reduce(
    (a, c) => ({
      spend: a.spend + (c.insights?.spend || 0),
      impressions: a.impressions + (c.insights?.impressions || 0),
      clicks: a.clicks + (c.insights?.clicks || 0),
      conversions: a.conversions + (c.insights?.conversions || 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
  );
  const tCtr = tot.impressions > 0 ? ((tot.clicks / tot.impressions) * 100).toFixed(2) : null;
  const tCpc = tot.clicks > 0 ? (tot.spend / tot.clicks).toFixed(2) : null;
  const tCpl = tot.conversions > 0 ? (tot.spend / tot.conversions).toFixed(2) : null;

  return (
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
              <th className="px-4 py-3 text-right font-medium">Impr.</th>
              <th className="px-4 py-3 text-right font-medium">Clics</th>
              <th className="px-4 py-3 text-right font-medium">CTR</th>
              <th className="px-4 py-3 text-right font-medium">CPC</th>
              <th className="px-4 py-3 text-right font-medium">Conv.</th>
              <th className="px-4 py-3 text-right font-medium">CPL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-700">
            {campaigns.map(c => (
              <tr key={c.id} className="hover:bg-dark-700/40 transition-colors">
                <td className="px-5 py-3.5">
                  <p className="text-white font-medium truncate max-w-xs">{c.name}</p>
                  <p className="text-xs text-gray-500 capitalize">
                    {(c.objective ?? c.type ?? '').toLowerCase()}
                  </p>
                </td>
                <td className="px-4 py-3.5">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[c.status] || STATUS_STYLES.REMOVED}`}>
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-right font-mono text-sm text-white">
                  €{fmt(c.insights?.spend, 2)}
                </td>
                <td className="px-4 py-3.5 text-right text-gray-300">{fmt(c.insights?.impressions)}</td>
                <td className="px-4 py-3.5 text-right text-gray-300">{fmt(c.insights?.clicks)}</td>
                <td className="px-4 py-3.5 text-right text-gray-300">
                  {c.insights?.ctr != null ? `${fmt(c.insights.ctr, 2)}%` : '—'}
                </td>
                <td className="px-4 py-3.5 text-right text-gray-300">
                  {c.insights?.cpc != null ? `€${fmt(c.insights.cpc, 2)}` : '—'}
                </td>
                <td className="px-4 py-3.5 text-right text-gray-300">{fmt(c.insights?.conversions)}</td>
                <td className="px-4 py-3.5 text-right text-gray-300">
                  {c.insights?.cpp != null ? `€${fmt(c.insights.cpp, 2)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          {withIns.length > 0 && (
            <tfoot>
              <tr className="border-t border-dark-500 bg-dark-700/50 text-xs font-semibold text-white">
                <td className="px-5 py-3" colSpan={2}>TOTAL</td>
                <td className="px-4 py-3 text-right">€{fmt(tot.spend, 2)}</td>
                <td className="px-4 py-3 text-right">{fmt(tot.impressions)}</td>
                <td className="px-4 py-3 text-right">{fmt(tot.clicks)}</td>
                <td className="px-4 py-3 text-right">{tCtr ? `${tCtr}%` : '—'}</td>
                <td className="px-4 py-3 text-right">{tCpc ? `€${tCpc}` : '—'}</td>
                <td className="px-4 py-3 text-right">{fmt(tot.conversions)}</td>
                <td className="px-4 py-3 text-right">{tCpl ? `€${tCpl}` : '—'}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function AIAnalysisPanel({ insights, campaigns, platform }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [err, setErr] = useState('');

  const handle = async () => {
    if (!insights) return;
    setAnalyzing(true); setAnalysis(''); setErr('');
    try {
      const res = await api.post('/api/ai/analyze-campaign', {
        campaignData: JSON.stringify({
          platform: platform === 'google' ? 'Google Ads' : 'Meta Ads',
          period: insights.period,
          summary: insights.summary,
          changes: insights.changes,
          campaigns: (campaigns ?? []).map(c => ({
            name: c.name, status: c.status,
            objective: c.objective ?? c.type,
            insights: c.insights,
          })),
          context: 'Clínica de medicina estética premium en Madrid. Objetivo: citas para tratamientos faciales, corporales y rejuvenecimiento.',
        }),
      });
      if (res.data.success) setAnalysis(res.data.analysis);
      else setErr(res.data.message || 'Análisis IA no disponible');
    } catch (e) {
      setErr(e.response?.data?.message || 'Error al ejecutar análisis IA');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-violet-500/10">
            <Brain size={20} className="text-violet-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">Análisis Inteligente con IA</h3>
            <p className="text-xs text-gray-500 mt-0.5">Gemini / OpenAI — recomendaciones accionables</p>
          </div>
        </div>
        <button
          onClick={handle}
          disabled={analyzing || !insights}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
          {analyzing ? 'Analizando…' : 'Analizar Ahora'}
        </button>
      </div>
      {err && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />{err}
        </div>
      )}
      {analysis && (
        <div className="mt-2 p-4 rounded-xl bg-dark-800 border border-dark-600 text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
          {analysis}
        </div>
      )}
      {!analysis && !err && !analyzing && (
        <div className="text-center py-8 text-gray-500 text-sm">
          Haz clic en "Analizar Ahora" para obtener un análisis completo con recomendaciones.
        </div>
      )}
    </div>
  );
}

function PlatformPanel({ platform, days }) {
  const isGoogle = platform === 'google';
  const [insights, setInsights] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notConnected, setNotConnected] = useState(false);
  const [noAccountId, setNoAccountId] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null); setNotConnected(false); setNoAccountId(false);
    setInsights(null); setCampaigns([]);
    const base = isGoogle ? '/api/google-ads' : '/api/meta';
    try {
      const [insRes, campRes] = await Promise.allSettled([
        api.get(`${base}/insights`, { params: { days } }),
        api.get(`${base}/campaigns`, { params: { days } }),
      ]);
      if (insRes.status === 'fulfilled') {
        const d = insRes.value.data;
        if (d.notConnected) { setNotConnected(true); return; }
        if (d.noAccountId || d.noServiceAccount) { setNoAccountId(true); return; }
        if (d.success) setInsights(d); else setError(d.message || 'Error');
      } else {
        const d = insRes.reason?.response?.data;
        if (d?.notConnected) { setNotConnected(true); return; }
        if (d?.noAccountId || d?.noServiceAccount) { setNoAccountId(true); return; }
        throw new Error(d?.message || 'Error al cargar datos');
      }
      if (campRes.status === 'fulfilled' && campRes.value.data?.success) {
        setCampaigns(campRes.value.data.campaigns ?? []);
      }
    } catch (e) {
      setError(e.message || 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [days, isGoogle]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (!loading && notConnected) return <NotConnectedState platform={platform} />;
  if (!loading && noAccountId) return <NoAccountIdState platform={platform} onSave={() => fetchData()} />;

  const s = insights?.summary;
  const ch = insights?.changes;
  const accent = isGoogle ? '#34a853' : '#1877f2';

  return (
    <div className="space-y-6">
      {error && (
        <div className="card border-red-500/20 bg-red-500/5 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-300">{error}</p>
        </div>
      )}
      {loading ? <SkeletonGrid /> : s && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard label="Gasto Total" value={fmt(s.spend, 2)} unit="€"
              change={ch?.spend} inverse icon={DollarSign} color="text-amber-400" bg="bg-amber-500/10" />
            <KpiCard label="Impresiones" value={fmt(s.impressions)} change={ch?.impressions}
              icon={Eye} color="text-violet-400" bg="bg-violet-500/10" />
            <KpiCard label={isGoogle ? 'Impr. (único)' : 'Alcance'}
              value={fmt(s.reach ?? s.impressions)} change={ch?.reach ?? ch?.impressions}
              icon={Users} color="text-blue-400" bg="bg-blue-500/10" />
            <KpiCard label="Clics" value={fmt(s.clicks)} change={ch?.clicks}
              icon={MousePointer} color="text-brand-400" bg="bg-brand-500/10" />
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard label="CTR" value={fmt(s.ctr, 2)} unit="%"
              icon={BarChart2} color="text-emerald-400" bg="bg-emerald-500/10" />
            <KpiCard label="CPC" value={fmt(s.cpc, 2)} unit="€"
              icon={Target} color="text-pink-400" bg="bg-pink-500/10" />
            <KpiCard label="CPM" value={fmt(s.cpm, 2)} unit="€"
              icon={Megaphone} color="text-orange-400" bg="bg-orange-500/10" />
            <KpiCard label="Conversiones" value={fmt(s.conversions)} change={ch?.conversions}
              icon={Zap} color="text-teal-400" bg="bg-teal-500/10" />
          </div>
        </>
      )}
      {!loading && <DailyCharts daily={insights?.daily} accentColor={accent} />}
      {!loading && <CampaignTable campaigns={campaigns} days={days} />}
      {!loading && <AIAnalysisPanel insights={insights} campaigns={campaigns} platform={platform} />}
    </div>
  );
}

export default function MetaIntelligence() {
  const [days, setDays] = useState(30);
  const [platform, setPlatform] = useState('meta');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">Marketing Intelligence</h2>
          <p className="text-gray-400 mt-0.5">KPIs reales · Campañas · Análisis IA</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-lg border border-dark-600 overflow-hidden">
            {PLATFORMS.map(p => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id)}
                className={`px-4 py-1.5 text-xs font-medium transition-colors flex items-center gap-2 ${
                  platform === p.id
                    ? 'bg-dark-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-dark-700'
                }`}
              >
                {p.id === 'meta' ? (
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5"
                    fill={platform === 'meta' ? '#1877f2' : 'currentColor'}>
                    <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 008.44-9.9c0-5.53-4.5-10.02-10-10.02z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                )}
                {p.label}
              </button>
            ))}
          </div>

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
            onClick={() => setRefreshKey(k => k + 1)}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <RefreshCw size={14} /> Actualizar
          </button>
        </div>
      </div>

      <PlatformPanel
        key={`${platform}-${days}-${refreshKey}`}
        platform={platform}
        days={days}
      />
    </div>
  );
}
