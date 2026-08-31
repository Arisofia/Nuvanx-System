import { Activity, AlertCircle, ExternalLink, Gauge, MapPin, Search } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'

const REQUIRED_TELEMETRY = [
  {
    name: 'Rendimiento web',
    description: 'PageSpeed/Lighthouse o fuente equivalente con fecha de captura, URL y dispositivo.',
    icon: Gauge,
  },
  {
    name: 'Search Console',
    description: 'Consultas, páginas, impresiones, clics y posición desde una fuente autenticada.',
    icon: Search,
  },
  {
    name: 'SEO local',
    description: 'Google Business Profile y señales locales con sede, fecha y procedencia verificables.',
    icon: MapPin,
  },
] as const

export default function SEOTracker() {
  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Badge className="border-0 bg-amber-500/10 text-amber-700">
              <AlertCircle className="mr-1 h-3 w-3" />
              Telemetría pendiente
            </Badge>
          </div>
          <h1 className="text-3xl font-serif font-bold text-[#2C2825]">SEO, Local & Citabilidad IA</h1>
          <p className="mt-2 max-w-3xl text-sm text-[#5C5550]">
            Este módulo no publica métricas actuales hasta disponer de una fuente viva y verificable.
            Se retiraron los valores estáticos que podían confundirse con observaciones runtime.
          </p>
        </div>
        <a
          href="https://pagespeed.web.dev/?url=https://nuvanx.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-[#E5D5C5] bg-white px-4 py-2 text-sm font-semibold text-[#84643B]"
        >
          PageSpeed público
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <Card className="border border-[#E5D5C5]/60 bg-white shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-[#2C2825]">
            <Activity className="h-5 w-5 text-[#84643B]" />
            Contrato de datos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-[#5C5550]">
            Cada KPI futuro debe incluir fuente, timestamp, ámbito y estado de calidad. Si la fuente no responde,
            el panel debe mostrar indisponibilidad o stale data; nunca un número hardcodeado, estimado o heredado
            presentado como actual.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-5 md:grid-cols-3">
        {REQUIRED_TELEMETRY.map(({ name, description, icon: Icon }) => (
          <Card key={name} className="border border-[#E5D5C5]/60 bg-white shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-[#2C2825]">
                <Icon className="h-4 w-4 text-[#84643B]" />
                {name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-[#5C5550]">{description}</p>
              <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">
                Sin fuente runtime conectada
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
