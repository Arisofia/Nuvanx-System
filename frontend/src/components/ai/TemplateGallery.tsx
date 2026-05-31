import { useState } from 'react'

interface Template {
  label: string
  category: string
  prompt: string
}

const TEMPLATES: Template[] = [
  {
    label: 'WhatsApp Follow-up',
    category: 'WhatsApp',
    prompt:
      'Generate 3 WhatsApp follow-up messages for dental clinic leads. Style: warm, professional, action-oriented. Max 3 short paragraphs each with a clear CTA.',
  },
  {
    label: 'Email Campaign',
    category: 'Email',
    prompt:
      'Write a compelling email campaign for an aesthetics clinic promoting a new treatment. Include subject line, body, and CTA.',
  },
  {
    label: 'Ad Copy',
    category: 'Advertising',
    prompt:
      'Generate 3 variations of Meta/Google ad copy for an aesthetics clinic. Each variation: headline (max 30 chars), description (max 90 chars), CTA.',
  },
]

const ALL_CATEGORIES = ['All', ...Array.from(new Set(TEMPLATES.map((t) => t.category)))]

interface TemplateGalleryProps {
  onSelect: (prompt: string) => void
}

export function TemplateGallery({ onSelect }: TemplateGalleryProps) {
  const [activeCategory, setActiveCategory] = useState<string>('All')

  const filtered =
    activeCategory === 'All'
      ? TEMPLATES
      : TEMPLATES.filter((t) => t.category === activeCategory)

  return (
    <div className="space-y-3">
      {/* Category Filter */}
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
            aria-pressed={activeCategory === cat}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Templates */}
      <div className="grid grid-cols-1 gap-2">
        {filtered.map((template) => (
          <button
            key={template.label}
            onClick={() => onSelect(template.prompt)}
            className="text-left p-3 rounded-lg border border-border bg-surface hover:border-muted hover:bg-card transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{template.label}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-card text-muted border border-border shrink-0">
                {template.category}
              </span>
            </div>
            <p className="text-xs text-muted mt-1 line-clamp-2">{template.prompt}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

