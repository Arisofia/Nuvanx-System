import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  TrendingUp,
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
  Zap,
  Globe,
  FileCode,
  ShieldCheck,
  Building2,
  Stethoscope,
  Send,
  Sparkles,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Real Clinical & Indexing Data
// ─────────────────────────────────────────────────────────────────────────────

const LAST_UPDATED = '2026-08-31'

interface MetricRow {
  metric: string
  mobileCurrent: string
  desktopCurrent: string
  target: string
  status: 'good' | 'warning' | 'critical'
  note: string
}

const PERFORMANCE_METRICS: MetricRow[] = [
  { metric: 'Puntuación Global', mobileCurrent: '68 pts', desktopCurrent: '87.7 pts', target: '90+ / 95+', status: 'warning', note: 'Fase 1 desplegada (+12–18 pts estimados tras re-crawl)' },
  { metric: 'LCP (Largest Contentful Paint)', mobileCurrent: '8–10 s', desktopCurrent: '0.8–1.9 s', target: '< 3.0 s / < 1.5 s', status: 'critical', note: 'Preload LCP en wp_head priority 1 activo en nuvanx-performance.php' },
  { metric: 'TBT (Total Blocking Time)', mobileCurrent: '50–760 ms', desktopCurrent: '< 50 ms', target: '< 150 ms', status: 'warning', note: 'Diferir scripts no esenciales en /madrid/valoracion/' },
  { metric: 'CLS (Cumulative Layout Shift)', mobileCurrent: '0.000', desktopCurrent: '0.000', target: '< 0.050 (0.000)', status: 'good', note: 'Estabilidad visual perfecta en todo el sitio' },
  { metric: 'Accesibilidad (a11y)', mobileCurrent: '99.5 %', desktopCurrent: '99.6 %', target: '100 %', status: 'good', note: 'Cumplimiento WCAG 2.1 / 2.2 AA verificado' },
  { metric: 'SEO Técnico', mobileCurrent: '100 %', desktopCurrent: '100 %', target: '100 %', status: 'good', note: 'Sitemaps XML, Schema JSON-LD y routes.json sincronizados' },
  { metric: 'Best Practices', mobileCurrent: '94.7 %', desktopCurrent: '94.3 %', target: '100 %', status: 'warning', note: 'Subirá a 100 con rel=noopener y HTTPS estricto' },
]

interface IndexingHub {
  name: string
  protocol: string
  status: string
  httpCode: number
  ok: boolean
}

const INDEXING_HUBS: IndexingHub[] = [
  { name: 'IndexNow Central', protocol: 'IndexNow API', status: 'Aceptado (200)', httpCode: 200, ok: true },
  { name: 'Microsoft Bing', protocol: 'IndexNow API', status: 'Aceptado (200)', httpCode: 200, ok: true },
  { name: 'Yandex Webmaster', protocol: 'IndexNow API', status: 'Aceptado (200)', httpCode: 200, ok: true },
  { name: 'Seznam Search', protocol: 'IndexNow API', status: 'Aceptado (200)', httpCode: 200, ok: true },
  { name: 'Naver Search', protocol: 'IndexNow API', status: 'Reintentando (Timeout regional)', httpCode: 504, ok: false },
]

const CLINIC_SEDES = [
  {
    name: 'NUVANX Chamberí',
    address: 'Calle de Fernández de la Hoz, 4, Bajo Derecha, 28010 Madrid',
    reg: 'CS20144',
    director: 'Dr. José Javier Rivera Tejeda (Col. 282864786)',
    phone: '+34 669 319 836',
    hours: 'L–S 10:00–20:00',
    placeId: 'ChIJ6R9LvsQpQg0Rj9Ioei_Xwsg',
    reviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJ6R9LvsQpQg0Rj9Ioei_Xwsg',
    status: 'Auditada y Activa',
  },
  {
    name: 'NUVANX Salamanca–Goya',
    address: 'Calle de Fernán González, 26, 28009 Madrid',
    reg: 'CS20073',
    director: 'Dr. José Javier Rivera Tejeda (Col. 282864786)',
    phone: '+34 647 50 51 07',
    hours: 'L–S 11:00–20:00',
    placeId: 'ChIJlZAA78cpQg0RXFxu-B2lgQI',
    reviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJlZAA78cpQg0RXFxu-B2lgQI',
    status: 'Auditada y Activa',
  },
]

const NAP_DIRECTORIES = [
  { name: 'Google Business Profile (Goya & Chamberí)', weight: '32%', status: 'Activo', type: 'Local Pack' },
  { name: 'Doctoralia España (CS20144 & CS20073)', weight: 'Alta', status: 'Sincronizado', type: 'Médico' },
  { name: 'Top Doctors Madrid', weight: 'Alta', status: 'Pendiente verificación', type: 'Médico' },
  { name: 'Tuotromedico / Salud.es', weight: 'Media', status: 'En trámite', type: 'Salud' },
  { name: 'Páginas Amarillas & QDQ', weight: 'Media', status: 'Pendiente', type: 'Directorio' },
  { name: 'Bing Places for Business', weight: 'Media', status: 'Activo', type: 'Local' },
  { name: 'Apple Maps / Apple Business Connect', weight: 'Media', status: 'Activo', type: 'Mapas' },
]

// ─────────────────────────────────────────────────────────────────────────────
// UI Components
// ─────────────────────────────────────────────────────────────────────────────

function StatusTag({ status }: { status: 'done' | 'in-progress' | 'pending' | 'good' | 'warning' | 'critical' }) {
  if (status === 'done' || status === 'good') {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-700 border-0 text-[10px] font-bold uppercase tracking-wider">
        <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
        Completado
      </Badge>
    )
  }
  if (status === 'in-progress' || status === 'warning') {
    return (
      <Badge className="bg-amber-500/10 text-amber-700 border-0 text-[10px] font-bold uppercase tracking-wider">
        <Clock className="w-3 h-3 mr-1 text-amber-600" />
        En curso
      </Badge>
    )
  }
  return (
    <Badge className="bg-red-500/10 text-red-700 border-0 text-[10px] font-bold uppercase tracking-wider">
      <AlertCircle className="w-3 h-3 mr-1 text-red-600" />
      Pendiente
    </Badge>
  )
}

export default function SEOTracker() {
  const [, setLastRefresh] = useState(new Date())

  const refresh = useCallback(() => {
    setLastRefresh(new Date())
  }, [])

  useEffect(() => {
    document.title = 'SEO & Visibilidad IA — Nuvanx Control Centre'
  }, [])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest bg-[#84643B]/10 text-[#84643B] px-2.5 py-1 rounded-full">
              Estrategia Omnicanal 2026
            </span>
            <span className="text-xs text-[#8E8680]">· 12 Semanas de Ejecución</span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-serif font-bold text-[#2C2825] mt-1">
            SEO, Local Pack & Citabilidad IA
          </h1>
          <p className="text-sm text-[#8E8680] mt-1">
            Seguimiento simultáneo de los 3 frentes: Rendimiento Web, Google Business Profile y Posicionamiento en LLMs
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            className="border-[#E5D5C5] text-[#84643B] hover:bg-[#84643B]/5 rounded-xl font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Actualizar datos
          </Button>
          <a
            href="https://pagespeed.web.dev/?url=https://nuvanx.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#84643B] text-white rounded-xl text-xs font-semibold hover:bg-[#6e5330] transition-colors shadow-sm"
          >
            <Zap className="w-3.5 h-3.5" />
            PageSpeed Live
            <ExternalLink className="w-3 h-3 ml-0.5 opacity-80" />
          </a>
        </div>
      </div>

      {/* 3 Frentes Header Cards */}
      <div className="grid md:grid-cols-3 gap-5">
        {/* Frente 1 */}
        <Card className="bg-white border border-[#E5D5C5]/40 rounded-3xl shadow-none hover:border-[#84643B]/30 transition-all">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#84643B] bg-[#84643B]/10 px-2 py-0.5 rounded-full">
                Frente 1 · Técnico
              </span>
              <Smartphone className="w-4 h-4 text-[#84643B]" />
            </div>
            <CardTitle className="text-base font-bold text-[#2C2825] mt-2">
              Performance Mobile
            </CardTitle>
            <CardDescription className="text-xs text-[#8E8680]">
              LCP 8–10 s → &lt;3 s · Mobile 68 → 90+
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between pt-1">
              <div>
                <span className="text-2xl font-serif font-bold text-[#2C2825]">68</span>
                <span className="text-xs text-[#8E8680] ml-1">/ 100 actual</span>
              </div>
              <span className="text-xs font-bold text-emerald-600">Meta: 90+</span>
            </div>
            <div className="h-2 bg-[#F0ECE6] rounded-full overflow-hidden">
              <div className="h-full bg-[#84643B] rounded-full" style={{ width: '75%' }} />
            </div>
            <p className="text-xs text-[#5C5550] leading-relaxed">
              <strong>Fase 1 activa:</strong> Preload LCP con WebP hints y prioridad máxima desplegado en <code>nuvanx-performance.php</code>.
            </p>
          </CardContent>
        </Card>

        {/* Frente 2 */}
        <Card className="bg-white border border-[#E5D5C5]/40 rounded-3xl shadow-none hover:border-[#C9963F]/30 transition-all">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#C9963F] bg-[#C9963F]/10 px-2 py-0.5 rounded-full">
                Frente 2 · Local SEO
              </span>
              <MapPin className="w-4 h-4 text-[#C9963F]" />
            </div>
            <CardTitle className="text-base font-bold text-[#2C2825] mt-2">
              GBP, Reseñas & Citations
            </CardTitle>
            <CardDescription className="text-xs text-[#8E8680]">
              32% del algoritmo local en medicina estética
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between pt-1">
              <div>
                <span className="text-2xl font-serif font-bold text-[#2C2825]">Top 5</span>
                <span className="text-xs text-[#8E8680] ml-1">Map Pack objetivo</span>
              </div>
              <span className="text-xs font-bold text-[#C9963F]">8–12 res/mes</span>
            </div>
            <div className="h-2 bg-[#F0ECE6] rounded-full overflow-hidden">
              <div className="h-full bg-[#C9963F] rounded-full" style={{ width: '50%' }} />
            </div>
            <p className="text-xs text-[#5C5550] leading-relaxed">
              <strong>2 Sedes registradas:</strong> Chamberí (CS20144) y Goya (CS20073). Flujo de reseñas post-consulta en preparación.
            </p>
          </CardContent>
        </Card>

        {/* Frente 3 */}
        <Card className="bg-white border border-[#E5D5C5]/40 rounded-3xl shadow-none hover:border-[#6B5EA8]/30 transition-all">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#6B5EA8] bg-[#6B5EA8]/10 px-2 py-0.5 rounded-full">
                Frente 3 · GEO / IA
              </span>
              <Brain className="w-4 h-4 text-[#6B5EA8]" />
            </div>
            <CardTitle className="text-base font-bold text-[#2C2825] mt-2">
              Citabilidad en ChatGPT & Perplexity
            </CardTitle>
            <CardDescription className="text-xs text-[#8E8680]">
              45% de pacientes usan recomendaciones de IA
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between pt-1">
              <div>
                <span className="text-2xl font-serif font-bold text-[#2C2825]">llms.txt</span>
                <span className="text-xs text-emerald-600 ml-1 font-bold">✓ Activo</span>
              </div>
              <span className="text-xs font-bold text-[#6B5EA8]">Otterly.ai</span>
            </div>
            <div className="h-2 bg-[#F0ECE6] rounded-full overflow-hidden">
              <div className="h-full bg-[#6B5EA8] rounded-full" style={{ width: '65%' }} />
            </div>
            <p className="text-xs text-[#5C5550] leading-relaxed">
              <strong>Entidades y tarifas canónicas</strong> expuestas vía JSON-LD y <code>llms.txt</code> en raíz con precios reales 2026.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="bg-[#F0ECE6] p-1 rounded-2xl">
          <TabsTrigger value="overview" className="rounded-xl text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-[#84643B]">
            Visión General & Hoja de Ruta
          </TabsTrigger>
          <TabsTrigger value="performance" className="rounded-xl text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-[#84643B]">
            Frente 1: Métricas de Rendimiento
          </TabsTrigger>
          <TabsTrigger value="local-seo" className="rounded-xl text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-[#84643B]">
            Frente 2: Sedes GBP & Reseñas
          </TabsTrigger>
          <TabsTrigger value="ai-visibility" className="rounded-xl text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-[#84643B]">
            Frente 3: Citabilidad IA & llms.txt
          </TabsTrigger>
          <TabsTrigger value="indexing" className="rounded-xl text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-[#84643B]">
            Indexación Omnicanal (76 URLs)
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Overview */}
        <TabsContent value="overview" className="space-y-6">
          <Card className="bg-white border border-[#E5D5C5]/40 rounded-3xl shadow-none">
            <CardHeader>
              <CardTitle className="text-lg font-serif font-bold text-[#2C2825]">
                Hoja de Ruta Estratégica — 12 Semanas
              </CardTitle>
              <CardDescription className="text-xs text-[#8E8680]">
                Cronograma priorizado por ROI e impacto en captación de pacientes en Madrid
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-4 gap-4">
                <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Semanas 1–2</span>
                    <Badge className="bg-emerald-500 text-white text-[9px]">En curso</Badge>
                  </div>
                  <p className="text-xs font-bold text-[#2C2825]">Performance & Setup Base</p>
                  <ul className="text-[11px] text-[#5C5550] space-y-1">
                    <li>✓ Preload LCP hero desplegado</li>
                    <li>✓ Verificación sanitarios GBP</li>
                    <li>· Activación Cloudflare APO</li>
                    <li>· QR de reseñas en recepción</li>
                  </ul>
                </div>

                <div className="p-4 rounded-2xl border border-[#E5D5C5]/40 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#84643B]">Semanas 3–4</span>
                    <Badge className="bg-transparent border border-[#E5D5C5] text-[#8E8680] text-[9px]">Siguiente</Badge>
                  </div>
                  <p className="text-xs font-bold text-[#2C2825]">WebP & Directorios NAP</p>
                  <ul className="text-[11px] text-[#5C5550] space-y-1">
                    <li>· Regenerar thumbnails hero</li>
                    <li>· Alta en 25 directorios salud</li>
                    <li>· Sincronización Doctoralia</li>
                    <li>· Formato AI-ready en 4 páginas</li>
                  </ul>
                </div>

                <div className="p-4 rounded-2xl border border-[#E5D5C5]/40 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#84643B]">Mes 2</span>
                    <Badge className="bg-transparent border border-[#E5D5C5] text-[#8E8680] text-[9px]">Planificado</Badge>
                  </div>
                  <p className="text-xs font-bold text-[#2C2825]">Autoridad & Posts GBP</p>
                  <ul className="text-[11px] text-[#5C5550] space-y-1">
                    <li>· Posts semanales en GBP</li>
                    <li>· Outreach en medios médicos DA40+</li>
                    <li>· Re-auditoría completa PageSpeed</li>
                    <li>· Menciones en salud digital</li>
                  </ul>
                </div>

                <div className="p-4 rounded-2xl border border-[#E5D5C5]/40 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#84643B]">Mes 3</span>
                    <Badge className="bg-transparent border border-[#E5D5C5] text-[#8E8680] text-[9px]">Consolidación</Badge>
                  </div>
                  <p className="text-xs font-bold text-[#2C2825]">Medición & Optimización</p>
                  <ul className="text-[11px] text-[#5C5550] space-y-1">
                    <li>· Medición Local Falcon Map Pack</li>
                    <li>· Auditoría citaciones en Otterly.ai</li>
                    <li>· Freshness updates mensuales</li>
                    <li>· Ajuste fino por conversión real</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Performance */}
        <TabsContent value="performance" className="space-y-6">
          <Card className="bg-white border border-[#E5D5C5]/40 rounded-3xl shadow-none overflow-hidden">
            <CardHeader className="border-b border-[#E5D5C5]/30">
              <CardTitle className="text-lg font-serif font-bold text-[#2C2825]">
                Diagnóstico de Core Web Vitals y Objetivos de Rendimiento
              </CardTitle>
              <CardDescription className="text-xs text-[#8E8680]">
                Valores basados en la auditoría integral de 162 análisis y 81 URLs
              </CardDescription>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#E5D5C5]/30 bg-[#FAF7F2]">
                    <th className="text-left font-bold text-[#84643B] p-3.5">Métrica</th>
                    <th className="text-left font-bold text-[#84643B] p-3.5">Mobile Actual</th>
                    <th className="text-left font-bold text-[#84643B] p-3.5">Desktop Actual</th>
                    <th className="text-left font-bold text-[#84643B] p-3.5">Objetivo</th>
                    <th className="text-left font-bold text-[#84643B] p-3.5">Estado</th>
                    <th className="text-left font-bold text-[#84643B] p-3.5">Plan de Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5D5C5]/20">
                  {PERFORMANCE_METRICS.map((row, i) => (
                    <tr key={i} className="hover:bg-[#FAF7F2]/50 transition-colors">
                      <td className="p-3.5 font-semibold text-[#2C2825]">{row.metric}</td>
                      <td className="p-3.5 font-mono text-[#5C5550]">{row.mobileCurrent}</td>
                      <td className="p-3.5 font-mono text-[#5C5550]">{row.desktopCurrent}</td>
                      <td className="p-3.5 font-semibold text-emerald-700">{row.target}</td>
                      <td className="p-3.5"><StatusTag status={row.status} /></td>
                      <td className="p-3.5 text-[#5C5550]">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Tab 3: Local SEO */}
        <TabsContent value="local-seo" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-5">
            {CLINIC_SEDES.map((sede, i) => (
              <Card key={i} className="bg-white border border-[#E5D5C5]/40 rounded-3xl shadow-none">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#84643B] bg-[#84643B]/10 px-2 py-0.5 rounded-full">
                      Sede Oficial NUVANX
                    </span>
                    <Badge className="bg-emerald-500/10 text-emerald-700 border-0 text-[10px]">
                      {sede.status}
                    </Badge>
                  </div>
                  <CardTitle className="text-base font-bold text-[#2C2825] mt-2">{sede.name}</CardTitle>
                  <CardDescription className="text-xs text-[#8E8680]">{sede.address}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-xs text-[#5C5550]">
                  <div className="grid grid-cols-2 gap-2 p-3 bg-[#FAF7F2] rounded-2xl">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-[#84643B]">Registro Sanitario</p>
                      <p className="font-semibold text-[#2C2825]">{sede.reg}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-[#84643B]">Horario</p>
                      <p className="font-semibold text-[#2C2825]">{sede.hours}</p>
                    </div>
                  </div>
                  <p><strong>Dirección médica:</strong> {sede.director}</p>
                  <p><strong>Teléfono:</strong> {sede.phone}</p>
                  <div className="pt-2">
                    <a
                      href={sede.reviewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#C9963F] text-white rounded-xl text-xs font-semibold hover:bg-[#b08335] transition-colors w-full justify-center shadow-sm"
                    >
                      <Star className="w-3.5 h-3.5 fill-current" />
                      Enlace Directo de Reseñas para Pacientes
                      <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="bg-white border border-[#E5D5C5]/40 rounded-3xl shadow-none">
            <CardHeader>
              <CardTitle className="text-base font-bold text-[#2C2825]">
                Directorio de Citaciones NAP (Name, Address, Phone)
              </CardTitle>
              <CardDescription className="text-xs text-[#8E8680]">
                Consistencia exacta del 100% con Google Business Profile para reforzar prominencia local
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                {NAP_DIRECTORIES.map((dir, idx) => (
                  <div key={idx} className="p-3 rounded-2xl border border-[#E5D5C5]/30 bg-[#FAF7F2] flex items-center justify-between">
                    <div>
                      <p className="font-bold text-[#2C2825]">{dir.name}</p>
                      <p className="text-[10px] text-[#8E8680]">{dir.type} · Relevancia: {dir.weight}</p>
                    </div>
                    <Badge className="bg-transparent border border-[#E5D5C5] text-[#8E8680] text-[9px]">
                      {dir.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: AI Visibility */}
        <TabsContent value="ai-visibility" className="space-y-6">
          <Card className="bg-white border border-[#E5D5C5]/40 rounded-3xl shadow-none">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-[#2C2825]">
                    Declaración Canónica para LLMs (<code>llms.txt</code>)
                  </CardTitle>
                  <CardDescription className="text-xs text-[#8E8680]">
                    Leído por OpenAI SearchBot, PerplexityBot y Claude para citar a NUVANX como referente en medicina estética en Madrid
                  </CardDescription>
                </div>
                <a
                  href="https://nuvanx.com/llms.txt"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#84643B] hover:underline"
                >
                  Ver fichero en vivo
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-xs text-[#5C5550]">
              <div className="p-4 bg-[#2C2825] text-[#F7F7F5] font-mono rounded-2xl space-y-2 text-[11px] overflow-x-auto">
                <p className="text-[#B08B5A]"># NUVANX Medicina Estética Láser — Resumen para Sistemas de IA</p>
                <p>&gt; Dirección médica: Dr. José Javier Rivera Tejeda (Col. ICOMEM 282864786)</p>
                <p>&gt; Sedes autorizadas: Chamberí (CS20144) y Salamanca–Goya (CS20073)</p>
                <p>&gt; Precios de referencia oficiales (tariff-catalog.json):</p>
                <p className="text-emerald-400">  - Endolift® facial: desde 798,60€ (ojeras) / 1.064,80€ (papada)</p>
                <p className="text-emerald-400">  - Láser CO₂ fraccionado: desde 330€ (periocular) / 665,50€ (facial completo)</p>
                <p className="text-emerald-400">  - EXION® BTL: desde 395€ / pack 4 sesiones 1.395€</p>
                <p className="text-emerald-400">  - Rinomodelación médica sin cirugía: 598€</p>
              </div>

              <div className="grid sm:grid-cols-3 gap-3 pt-2">
                <div className="p-3 bg-[#6B5EA8]/5 border border-[#6B5EA8]/20 rounded-2xl">
                  <p className="font-bold text-[#6B5EA8]">Párrafos concisos</p>
                  <p className="text-[11px] text-[#4A4560] mt-1">40–60 palabras con respuestas directas y datos factuales citables.</p>
                </div>
                <div className="p-3 bg-[#6B5EA8]/5 border border-[#6B5EA8]/20 rounded-2xl">
                  <p className="font-bold text-[#6B5EA8]">Autoridad médica</p>
                  <p className="text-[11px] text-[#4A4560] mt-1">Firma del colegiado y registro sanitario en cada página de tratamiento.</p>
                </div>
                <div className="p-3 bg-[#6B5EA8]/5 border border-[#6B5EA8]/20 rounded-2xl">
                  <p className="font-bold text-[#6B5EA8]">Multi-source verification</p>
                  <p className="text-[11px] text-[#4A4560] mt-1">Menciones coincidentes en Doctoralia, TopDoctors y prensa de salud.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 5: Indexing */}
        <TabsContent value="indexing" className="space-y-6">
          <Card className="bg-white border border-[#E5D5C5]/40 rounded-3xl shadow-none overflow-hidden">
            <CardHeader className="border-b border-[#E5D5C5]/30">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-[#2C2825]">
                    Estado de Envío IndexNow (76 URLs Verificadas)
                  </CardTitle>
                  <CardDescription className="text-xs text-[#8E8680]">
                    Último envío realizado con éxito a los motores de búsqueda que soportan el protocolo IndexNow
                  </CardDescription>
                </div>
                <Badge className="bg-emerald-500/10 text-emerald-700 border-0 text-[10px]">
                  4 / 5 Hubs Activos
                </Badge>
              </div>
            </CardHeader>
            <div className="p-4 space-y-3">
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                {INDEXING_HUBS.map((hub, idx) => (
                  <div key={idx} className="p-3.5 rounded-2xl border border-[#E5D5C5]/30 bg-[#FAF7F2] flex items-start justify-between">
                    <div>
                      <p className="font-bold text-xs text-[#2C2825]">{hub.name}</p>
                      <p className="text-[10px] text-[#8E8680]">{hub.protocol}</p>
                      <p className="text-[11px] font-semibold mt-1 text-[#5C5550]">{hub.status}</p>
                    </div>
                    {hub.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    )}
                  </div>
                ))}
              </div>

              <div className="p-4 bg-emerald-50/50 border border-emerald-200/60 rounded-2xl text-xs text-emerald-900 space-y-1">
                <p className="font-bold">✓ Sitemaps XML Notificadas:</p>
                <p className="text-[11px] text-emerald-800">
                  · <code>https://nuvanx.com/sitemap.xml</code> (Índice general)<br />
                  · <code>https://nuvanx.com/page-sitemap.xml</code> (62 páginas estáticas y landings)<br />
                  · <code>https://nuvanx.com/post-sitemap.xml</code> (14 artículos médicos del Journal)
                </p>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
