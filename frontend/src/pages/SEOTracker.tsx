import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Star,
  MapPin,
  Smartphone,
  Monitor,
  Brain,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import { Button } from '../components/ui/button'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface WeeklyKPI {
  label: string
  current: number | string
  target: number | string
  unit?: string
  delta?: number
  status: 'on-track' | 'behind' | 'achieved' | 'tracking'
  icon: typeof TrendingUp
  color: string
}

interface RoadmapItem {
  week: string
  label: string
  actions: string[]
  status: 'done' | 'in-progress' | 'pending'
}

interface FrontItem {
  front: string
  label: string
  priority: string
  week: string
  description: string
  status: 'done' | 'in-progress' | 'pending'
  impact: 'high' | 'medium'
  color: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Static data (updated manually each week)
// ─────────────────────────────────────────────────────────────────────────────

const LAST_UPDATED = '2026-08-31'

const kpis: WeeklyKPI[] = [
  {
    label: 'Performance Mobile',
    current: 68,
    target: 90,
    unit: 'pts',
    delta: 0,
    status: 'in-progress' as never,
    icon: Smartphone,
    color: '#84643B',
  },
  {
    label: 'Review Velocity',
    current: 0,
    target: 8,
    unit: '/mes',
    delta: 0,
    status: 'behind',
    icon: Star,
    color: '#C9963F',
  },
  {
    label: 'Local Pack Position',
    current: '—',
    target: 'Top 5',
    status: 'tracking',
    icon: MapPin,
    color: '#5B8A6E',
  },
  {
    label: 'Citaciones IA',
    current: '—',
    target: 'Tracking',
    status: 'tracking',
    icon: Brain,
    color: '#6B5EA8',
  },
]

const roadmap: RoadmapItem[] = [
  {
    week: 'Semana 1–2',
    label: 'Frente Técnico + GBP',
    status: 'in-progress',
    actions: [
      'PHP Performance deploy (LCP preload ✅)',
      'Cloudflare APO activar',
      'Auditoría GBP Goya + Chamberí',
      'Sistema de reseñas activo',
    ],
  },
  {
    week: 'Semana 3–4',
    label: 'Imágenes + Citations + Contenido IA',
    status: 'pending',
    actions: [
      'WebP + hero image sizes (regenerate thumbnails)',
      'Citations en 25+ directorios médicos',
      'llms.txt live en raíz',
      'Rewrite contenido AI-ready (4–6 páginas)',
    ],
  },
  {
    week: 'Mes 2',
    label: 'Autoridad + Posts GBP',
    status: 'pending',
    actions: [
      'Posts GBP semanales con keywords procedurales',
      'Outreach medios salud (WebConsultas, Menssana)',
      'Backlinks DA40+',
      'Re-auditoría PageSpeed',
    ],
  },
  {
    week: 'Mes 3',
    label: 'Medición + Ajuste',
    status: 'pending',
    actions: [
      'Monitorizar Local Pack con Local Falcon',
      'Medir citaciones IA (Otterly.ai / Semrush AI)',
      'Freshness updates en páginas clave',
      'Ajustar por datos reales',
    ],
  },
]

const fronts: FrontItem[] = [
  {
    front: 'Frente 1',
    label: 'Preload LCP + WebP hero images',
    priority: 'Semana 1',
    week: 'semana-1',
    description:
      'PHP generado y desplegado. Preload + fetchpriority=high. Regenerar thumbnails para hero-mobile/tablet/desktop. Cloudflare APO: TTFB –60%.',
    status: 'in-progress',
    impact: 'high',
    color: '#84643B',
  },
  {
    front: 'Frente 2',
    label: 'Auditar GBP ambas sedes',
    priority: 'Semana 1 · urgente',
    week: 'semana-1',
    description:
      'Categoría primaria: "Clínica de medicina estética". Servicios, fotos procedimiento, horarios. Ficha completa genera 7× más clics.',
    status: 'pending',
    impact: 'high',
    color: '#C9963F',
  },
  {
    front: 'Frente 2',
    label: 'Sistema de review velocity: 8–12 reseñas/mes',
    priority: 'Semana 1–2 · continuo',
    week: 'semana-1',
    description:
      'Competidores en Salamanca/Chamberí reciben 10–15/mes. Flujo post-consulta automatizado con QR + email. Sin igualar esto, el algoritmo penaliza activamente.',
    status: 'pending',
    impact: 'high',
    color: '#C9963F',
  },
  {
    front: 'Frente 2',
    label: 'NAP citations en 25+ directorios médicos',
    priority: 'Semana 2–3',
    week: 'semana-2',
    description:
      'Top Doctors, Doctoralia, Tuotromedico, Yelp, Páginas Amarillas, Salud.es. NAP idéntico al GBP. 7% del algoritmo pero señal de existencia para Google.',
    status: 'pending',
    impact: 'medium',
    color: '#C9963F',
  },
  {
    front: 'Frente 2',
    label: 'Posts GBP semanales con keywords procedurales',
    priority: 'Semana 3–4',
    week: 'semana-3',
    description:
      '"Endolift Madrid", "tratamiento papada Goya", "medicina estética Chamberí". Posts activos = señal de prominencia para Maps.',
    status: 'pending',
    impact: 'medium',
    color: '#C9963F',
  },
  {
    front: 'Frente 3',
    label: 'Restructurar contenido para citabilidad IA',
    priority: 'Semana 2–3',
    week: 'semana-2',
    description:
      'Párrafos de 40–60 palabras con afirmaciones directas. Definiciones explícitas ("El Endolift es..."). Datos con fuente citada. Esto es lo que los LLMs extraen.',
    status: 'pending',
    impact: 'high',
    color: '#6B5EA8',
  },
  {
    front: 'Frente 3',
    label: 'llms.txt en la raíz del dominio',
    priority: 'Semana 2–3',
    week: 'semana-2',
    description:
      'Fichero de instrucciones para crawlers de IA: entidad, especialidades, médicos, ubicaciones. Perplexity y Claude lo leen activamente. Ningún competidor en Madrid lo tiene.',
    status: 'pending',
    impact: 'high',
    color: '#6B5EA8',
  },
  {
    front: 'Frente 3',
    label: 'Autoridad de entidad en fuentes de terceros',
    priority: 'Semana 2–4',
    week: 'semana-2',
    description:
      'Menciones en medios salud (WebConsultas, Menssana), entrevistas médicas publicadas, citas en artículos externos. Los LLMs prefieren multi-source verification.',
    status: 'pending',
    impact: 'medium',
    color: '#6B5EA8',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: FrontItem['status'] | 'on-track' | 'behind' | 'achieved' | 'tracking' }) {
  if (status === 'done' || status === 'achieved') {
    return (
      <Badge className="bg-emerald-50 text-emerald-700 border-0 text-[10px] font-bold uppercase tracking-wider">
        <CheckCircle2 className="w-3 h-3 mr-1" />✅ Completado
      </Badge>
    )
  }
  if (status === 'in-progress') {
    return (
      <Badge className="bg-amber-50 text-amber-700 border-0 text-[10px] font-bold uppercase tracking-wider">
        <Clock className="w-3 h-3 mr-1" />🔄 En progreso
      </Badge>
    )
  }
  if (status === 'behind') {
    return (
      <Badge className="bg-red-50 text-red-700 border-0 text-[10px] font-bold uppercase tracking-wider">
        <AlertCircle className="w-3 h-3 mr-1" />⏳ Pendiente
      </Badge>
    )
  }
  return (
    <Badge className="bg-slate-50 text-slate-600 border-0 text-[10px] font-bold uppercase tracking-wider">
      <Minus className="w-3 h-3 mr-1" />Sin datos
    </Badge>
  )
}

function KPICard({ kpi }: { kpi: WeeklyKPI }) {
  const Icon = kpi.icon
  const progress =
    typeof kpi.current === 'number' && typeof kpi.target === 'number'
      ? Math.min(100, Math.round((kpi.current / kpi.target) * 100))
      : null

  return (
    <Card className="bg-white border border-[#E5D5C5]/30 shadow-none rounded-3xl">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: kpi.color + '15' }}
          >
            <Icon className="w-5 h-5" style={{ color: kpi.color }} />
          </div>
          {kpi.delta !== undefined && kpi.delta !== 0 && (
            <span
              className={`flex items-center text-xs font-bold ${kpi.delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}
            >
              {kpi.delta > 0 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {Math.abs(kpi.delta)}
            </span>
          )}
        </div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-[#B08B5A] mb-1">{kpi.label}</p>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-3xl font-serif font-bold text-[#2C2825]">{kpi.current}</span>
          {kpi.unit && <span className="text-sm text-[#8E8680]">{kpi.unit}</span>}
        </div>
        <p className="text-xs text-[#8E8680] mb-3">
          Objetivo: <span className="font-semibold text-[#5C5550]">{kpi.target}{kpi.unit ?? ''}</span>
        </p>
        {progress !== null && (
          <div className="h-1.5 bg-[#F0ECE6] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${progress}%`, backgroundColor: kpi.color }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RoadmapCard({ item }: { item: RoadmapItem }) {
  const borderColor =
    item.status === 'done'
      ? 'border-emerald-200 bg-emerald-50/30'
      : item.status === 'in-progress'
      ? 'border-amber-200 bg-amber-50/20'
      : 'border-[#E5D5C5]/30 bg-white'

  return (
    <div className={`rounded-2xl border p-5 ${borderColor}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#B08B5A]">{item.week}</p>
          <p className="text-sm font-bold text-[#2C2825] mt-0.5">{item.label}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>
      <ul className="space-y-1.5">
        {item.actions.map((action, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-[#5C5550]">
            <span className="mt-0.5 text-[#B08B5A]">·</span>
            {action}
          </li>
        ))}
      </ul>
    </div>
  )
}

function FrontCard({ item }: { item: FrontItem }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E5D5C5]/30 p-5">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
            style={{ backgroundColor: item.color + '20', color: item.color }}
          >
            {item.front}
          </span>
          {item.impact === 'high' && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
              Alta prio
            </span>
          )}
        </div>
        <StatusBadge status={item.status} />
      </div>
      <p className="text-xs font-bold uppercase tracking-widest text-[#B08B5A] mb-1">{item.priority}</p>
      <p className="text-sm font-bold text-[#2C2825] mb-2">{item.label}</p>
      <p className="text-xs text-[#6B6460] leading-relaxed">{item.description}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function SEOTracker() {
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [weekFilter, setWeekFilter] = useState<string>('all')

  const refresh = useCallback(() => setLastRefresh(new Date()), [])

  useEffect(() => {
    document.title = 'SEO Tracker — Nuvanx Control Centre'
  }, [])

  const filteredFronts =
    weekFilter === 'all' ? fronts : fronts.filter((f) => f.week === weekFilter)

  const doneCount = fronts.filter((f) => f.status === 'done').length
  const inProgressCount = fronts.filter((f) => f.status === 'in-progress').length
  const pendingCount = fronts.filter((f) => f.status === 'pending').length

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#B08B5A] mb-1">
            Nuvanx · SEO & IA Visibility
          </p>
          <h1 className="text-2xl font-serif font-bold text-[#2C2825]">
            Seguimiento de Posicionamiento
          </h1>
          <p className="text-sm text-[#8E8680] mt-1">
            3 frentes · 12 semanas · Mobile 68 → 90+ · Local Pack Top 5 · Citabilidad IA
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            className="border-[#E5D5C5] text-[#84643B] hover:bg-[#84643B]/5 rounded-xl"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Actualizar
          </Button>
          <p className="text-[10px] text-[#B08B5A]">
            Última actualización: {LAST_UPDATED}
          </p>
          <p className="text-[10px] text-[#C5BDB8]">
            Sesión: {lastRefresh.toLocaleTimeString('es-ES')}
          </p>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <KPICard key={kpi.label} kpi={kpi} />
        ))}
      </div>

      {/* Progress summary */}
      <Card className="bg-white border border-[#E5D5C5]/30 shadow-none rounded-3xl">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#B08B5A]">
              Avance global — {fronts.length} acciones
            </p>
            <div className="flex gap-3 text-xs">
              <span className="text-emerald-600 font-bold">✅ {doneCount} completadas</span>
              <span className="text-amber-600 font-bold">🔄 {inProgressCount} en progreso</span>
              <span className="text-slate-500 font-bold">⏳ {pendingCount} pendientes</span>
            </div>
          </div>
          <div className="h-3 bg-[#F0ECE6] rounded-full overflow-hidden flex">
            <div
              className="h-full bg-emerald-500 transition-all duration-700"
              style={{ width: `${(doneCount / fronts.length) * 100}%` }}
            />
            <div
              className="h-full bg-amber-400 transition-all duration-700"
              style={{ width: `${(inProgressCount / fronts.length) * 100}%` }}
            />
          </div>
          <p className="text-[11px] text-[#8E8680] mt-2">
            {Math.round(((doneCount + inProgressCount * 0.5) / fronts.length) * 100)}% en marcha
          </p>
        </CardContent>
      </Card>

      {/* Two columns: Roadmap + Actions */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Roadmap */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#B08B5A] mb-4">
            Hoja de ruta — 12 semanas
          </p>
          <div className="space-y-3">
            {roadmap.map((item) => (
              <RoadmapCard key={item.week} item={item} />
            ))}
          </div>
        </div>

        {/* Actions by front */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#B08B5A]">
              Acciones por frente
            </p>
            <div className="flex gap-1.5">
              {[
                { v: 'all', label: 'Todas' },
                { v: 'semana-1', label: 'S1' },
                { v: 'semana-2', label: 'S2–3' },
                { v: 'semana-3', label: 'S3–4' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => setWeekFilter(opt.v)}
                  className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg transition-colors ${
                    weekFilter === opt.v
                      ? 'bg-[#84643B] text-white'
                      : 'bg-[#F0ECE6] text-[#84643B] hover:bg-[#84643B]/10'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3 max-h-[680px] overflow-y-auto pr-1">
            {filteredFronts.map((item, i) => (
              <FrontCard key={i} item={item} />
            ))}
          </div>
        </div>
      </div>

      {/* Tools */}
      <Card className="bg-[#FAF7F2] border border-[#E5D5C5]/30 shadow-none rounded-3xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold text-[#2C2825]">
            Herramientas de medición recomendadas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                name: 'PageSpeed Insights',
                desc: 'Performance mobile semanal',
                url: 'https://pagespeed.web.dev/?url=https://nuvanx.com/',
                icon: Monitor,
                color: '#84643B',
              },
              {
                name: 'Local Falcon',
                desc: 'Local Pack / GBP heat map',
                url: 'https://localfalcon.com',
                icon: MapPin,
                color: '#C9963F',
              },
              {
                name: 'Otterly.ai',
                desc: 'Citaciones en ChatGPT / Perplexity',
                url: 'https://otterly.ai',
                icon: Brain,
                color: '#6B5EA8',
              },
              {
                name: 'Google Business',
                desc: 'Dashboard reseñas + posts GBP',
                url: 'https://business.google.com',
                icon: Star,
                color: '#5B8A6E',
              },
            ].map((tool) => (
              <a
                key={tool.name}
                href={tool.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 bg-white rounded-2xl p-4 border border-[#E5D5C5]/30 hover:border-[#84643B]/30 hover:shadow-sm transition-all group"
              >
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: tool.color + '15' }}
                >
                  <tool.icon className="w-4 h-4" style={{ color: tool.color }} />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#2C2825] group-hover:text-[#84643B] transition-colors flex items-center gap-1">
                    {tool.name}
                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </p>
                  <p className="text-[11px] text-[#8E8680]">{tool.desc}</p>
                </div>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* LLM note */}
      <div className="bg-[#6B5EA8]/5 border border-[#6B5EA8]/15 rounded-2xl p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-[#6B5EA8] mb-2">
          ⚠️ Nota sobre citabilidad en LLMs (ChatGPT, Perplexity, Claude)
        </p>
        <p className="text-sm text-[#4A4560] leading-relaxed">
          Las peticiones HTTP con User-Agent falso (Googlebot, ClaudeBot...) <strong>no registran nada</strong> y han sido eliminadas del script de indexación.
          Los LLMs obtienen su conocimiento de corpus de entrenamiento, no de crawls en tiempo real.
          La citabilidad real se construye con:{' '}
          <strong>structured data (JSON-LD ✅ ya desplegado)</strong>,{' '}
          <strong>llms.txt en la raíz</strong> (pendiente),{' '}
          <strong>menciones verificables en medios de salud</strong> y{' '}
          <strong>contenido de 40–60 palabras con afirmaciones directas y citables</strong>.
        </p>
      </div>
    </div>
  )
}
