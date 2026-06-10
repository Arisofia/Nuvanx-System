import { useState } from 'react'

const TEMPLATES = [
  {
    label: 'WhatsApp seguimiento lead',
    category: 'WhatsApp',
    prompt:
      'Genera 3 mensajes de seguimiento por WhatsApp para leads de NUVANX Medicina Estética Láser. Tono: claro, elegante, médico y sin presión. Máximo 3 párrafos breves. CTA: valoración médica gratuita.',
  },
  {
    label: 'Respuesta a paciente',
    category: 'Paciente',
    prompt:
      'Redacta una respuesta breve para una paciente interesada en medicina estética láser. Debe explicar que la indicación final y presupuesto se confirman en valoración médica gratuita. Tono español de España, cercano y profesional.',
  },
  {
    label: 'Copy Meta compliant',
    category: 'Publicidad',
    prompt:
      'Genera 3 variaciones de copy para Meta Ads de NUVANX. Evita señalar defectos personales, promesas absolutas o lenguaje de antes/después agresivo. Enfoque: naturalidad, criterio médico, discreción y valoración previa.',
  },
]

const ALL_CATEGORIES = ['Todas', ...Array.from(new Set(TEMPLATES.map((t) => t.category)))]

interface Props {
  onSelect: (prompt: string) => void
}

export function TemplateGallery({ onSelect }: Props) {
  const [activeCategory, setActiveCategory] = useState('Todas')

  const filtered =
    activeCategory === 'Todas' ? TEMPLATES : TEMPLATES.filter((t) => t.category === activeCategory)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {ALL_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              activeCategory === cat
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-[#5c4a33] text-muted hover:border-primary hover:text-foreground'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2">
        {filtered.map((t) => (
          <button
            key={t.label}
            onClick={() => onSelect(t.prompt)}
            className="text-left p-3 rounded-lg border border-border bg-surface hover:border-muted hover:bg-card transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{t.label}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-card text-muted border border-border shrink-0">
                {t.category}
              </span>
            </div>
            <p className="text-xs text-muted mt-1 line-clamp-2">{t.prompt}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
