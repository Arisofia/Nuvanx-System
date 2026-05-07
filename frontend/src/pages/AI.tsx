import { useEffect, useState } from 'react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Textarea } from '../components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Sparkles, BarChart2, Lightbulb, History, Copy, Check, RefreshCw } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'
import { TemplateGallery } from '../components/ai/TemplateGallery'

export default function AI() {
  // Generate tab
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<string | null>(null)
  const [analysisEmpty, setAnalysisEmpty] = useState<string | null>(null)

  // Suggestions tab
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  // History tab
  const [outputs, setOutputs] = useState<any[]>([])
  const [outputsLoading, setOutputsLoading] = useState(false)
  const [outputsError, setOutputsError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState('all')

  const handleGenerate = async () => {
    if (!prompt.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data: any = await invokeApi('/ai/generate', { method: 'POST', body: { prompt: prompt.trim() } })
      if (!data?.success) throw new Error(data?.message || 'Generation failed')
      setResult(data.content ?? data.result ?? '')
    } catch (err: any) {
      setError(err?.message || 'AI generation failed. Check that an OpenAI or Gemini key is configured in Integrations.')
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setAnalysisError(null)
    setAnalysisEmpty(null)
    try {
      // Backend agent auto-fetches a CRM-side snapshot when no payload is sent,
      // so the panel can render on mount without the client gathering data first.
      const data: any = await invokeApi('/ai/analyze-campaign', { method: 'POST', body: {} })
      if (!data?.success) throw new Error(data?.message || 'Analysis failed')
      if (data?.empty) {
        setAnalysisResult(null)
        setAnalysisEmpty(data?.message ?? 'Aún no hay datos suficientes para analizar.')
      } else {
        setAnalysisResult(data.content ?? data.result ?? data.analysis ?? '')
      }
    } catch (err: any) {
      setAnalysisError(err?.message || 'Campaign analysis failed.')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleFetchSuggestions = async () => {
    setSuggestionsLoading(true)
    setSuggestionsError(null)
    try {
      const data: any = await invokeApi('/ai/suggestions', { method: 'POST', body: {} })
      if (!data?.success) throw new Error(data?.message || 'Failed to fetch suggestions')
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
    } catch (err: any) {
      setSuggestionsError(err?.message || 'Failed to load suggestions.')
    } finally {
      setSuggestionsLoading(false)
    }
  }

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 2000)
    })
  }

  const handleFetchOutputs = async () => {
    setOutputsLoading(true)
    setOutputsError(null)
    try {
      const data: any = await invokeApi('/ai/outputs?limit=50')
      if (!data?.success) throw new Error(data?.message || 'Failed to fetch history')
      setOutputs(Array.isArray(data.outputs) ? data.outputs : [])
    } catch (err: any) {
      setOutputsError(err?.message || 'Failed to load history.')
    } finally {
      setOutputsLoading(false)
    }
  }

  // Auto-load every panel on mount so the UI is "connected by default" and
  // only surfaces errors when a specific agent fails.
  useEffect(() => {
    handleAnalyze()
    handleFetchSuggestions()
    handleFetchOutputs()
  }, [])

  const outputTypes = ['all', ...Array.from(new Set(outputs.map((o) => o.agent_type).filter(Boolean)))]
  const filteredOutputs = typeFilter === 'all' ? outputs : outputs.filter((o) => o.agent_type === typeFilter)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Capa IA</h1>
        <p className="text-muted mt-1">Generación de contenido, sugerencias y registro de resultados</p>
      </div>

      <Tabs defaultValue="generate" className="w-full">
        <TabsList>
          <TabsTrigger value="generate" className="gap-2"><Sparkles className="w-4 h-4" />Generar</TabsTrigger>
          <TabsTrigger value="suggestions" className="gap-2"><Lightbulb className="w-4 h-4" />Sugerencias</TabsTrigger>
          <TabsTrigger value="history" className="gap-2"><History className="w-4 h-4" />Historial</TabsTrigger>
        </TabsList>

        {/* ── Generate ── */}
        <TabsContent value="generate" className="mt-4 space-y-4">
          {error && (
            <div className="rounded-md border border-[#D9534F]/30 bg-[#D9534F]/8 px-4 py-3 text-sm text-[#D9534F]">{error}</div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Generar contenido</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label htmlFor="ai-prompt" className="text-sm font-medium">Prompt</label>
                    <Textarea
                      id="ai-prompt"
                      placeholder="Describe lo que quieres generar..."
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      className="mt-2"
                      rows={4}
                    />
                  </div>
                  <Button onClick={handleGenerate} disabled={loading || !prompt.trim()} className="w-full gap-2">
                    <Sparkles className="w-4 h-4" />
                    {loading ? 'Generando...' : 'Generar con IA'}
                  </Button>
                </CardContent>
              </Card>

              {result !== null && (
                <Card>
                  <CardHeader>
                    <CardTitle>Contenido generado</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="whitespace-pre-wrap text-sm text-[#d7c5ae] leading-relaxed">{result}</pre>
                  </CardContent>
                </Card>
              )}

              {analysisError && (
                <Card>
                  <CardHeader>
                    <CardTitle>Análisis de campaña</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-[#D9534F]">{analysisError}</p>
                  </CardContent>
                </Card>
              )}

              {!analysisError && analysisEmpty && (
                <Card>
                  <CardHeader>
                    <CardTitle>Análisis de campaña</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted">{analysisEmpty}</p>
                  </CardContent>
                </Card>
              )}

              {!analysisError && !analysisEmpty && analysisResult !== null && (
                <Card>
                  <CardHeader>
                    <CardTitle>Análisis de campaña</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="whitespace-pre-wrap text-sm text-[#d7c5ae] leading-relaxed">{analysisResult}</pre>
                  </CardContent>
                </Card>
              )}

              {!analysisError && !analysisEmpty && analysisResult === null && analyzing && (
                <Card>
                  <CardHeader>
                    <CardTitle>Análisis de campaña</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted">El agente está analizando tus campañas…</p>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Plantillas</CardTitle>
                </CardHeader>
                <CardContent>
                  <TemplateGallery onSelect={(p) => setPrompt(p)} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base flex items-center gap-2"><BarChart2 className="w-4 h-4" />Agente de análisis</CardTitle>
                  <button
                    type="button"
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    title="Refrescar análisis"
                    className="text-muted hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${analyzing ? 'animate-spin' : ''}`} />
                  </button>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted">
                    Conectado por defecto. El agente analiza tus campañas con memoria de análisis previos.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── Suggestions ── */}
        <TabsContent value="suggestions" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle>Sugerencias de IA</CardTitle>
              <button
                type="button"
                onClick={handleFetchSuggestions}
                disabled={suggestionsLoading}
                title="Refrescar sugerencias"
                className="text-muted hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${suggestionsLoading ? 'animate-spin' : ''}`} />
              </button>
            </CardHeader>
            <CardContent>
              {suggestionsError && (
                <p className="text-sm text-[#D9534F] mb-4">{suggestionsError}</p>
              )}
              {suggestions.length === 0 && !suggestionsLoading && !suggestionsError && (
                <p className="text-muted text-sm py-4 text-center">Aún no hay sugerencias. El agente las generará cuando tengas leads en el CRM.</p>
              )}
              {suggestions.length === 0 && suggestionsLoading && (
                <p className="text-muted text-sm py-4 text-center">El agente está preparando sugerencias…</p>
              )}
              <div className="space-y-3">
                {suggestions.map((s) => (
                  <div key={s} className="flex items-start justify-between gap-3 p-4 rounded-lg border border-border bg-surface">
                    <p className="text-sm text-foreground flex-1">{s}</p>
                    <button
                      onClick={() => handleCopy(s, suggestions.indexOf(s))}
                      className="shrink-0 text-muted hover:text-foreground transition-colors"
                      title="Copiar al portapapeles"
                    >
                      {copiedIdx === suggestions.indexOf(s) ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── History ── */}
        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle>Historial de resultados</CardTitle>
              <div className="flex items-center gap-2">
                {outputTypes.length > 1 && (
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="bg-card text-foreground text-xs font-medium px-3 py-1.5 rounded-lg border-none focus:ring-1 focus:ring-primary"
                  >
                    {outputTypes.map((t) => (
                      <option key={t} value={t}>{t === 'all' ? 'Todos los tipos' : t}</option>
                    ))}
                  </select>
                )}
                <Button onClick={handleFetchOutputs} disabled={outputsLoading} size="sm" variant="outline" className="gap-2">
                  <RefreshCw className={`w-4 h-4 ${outputsLoading ? 'animate-spin' : ''}`} />
                  {outputsLoading ? 'Cargando...' : 'Refrescar'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {outputsError && (
                <p className="text-sm text-[#D9534F] mb-4">{outputsError}</p>
              )}
              {filteredOutputs.length === 0 && !outputsLoading && !outputsError && (
                <p className="text-muted text-sm py-4 text-center">Aún no hay historial. Cuando los agentes generen resultados aparecerán aquí automáticamente.</p>
              )}
              {filteredOutputs.length === 0 && outputsLoading && (
                <p className="text-muted text-sm py-4 text-center">Cargando historial…</p>
              )}
              <div className="space-y-3">
                {filteredOutputs.map((o) => {
                  const content = typeof o.output === 'string'
                    ? o.output
                    : o.output?.content ?? o.output?.result ?? JSON.stringify(o.output ?? {})
                  return (
                    <div key={o.id} className="p-4 rounded-lg border border-border bg-surface space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-card text-[#d7c5ae] border border-border">
                          {o.agent_type ?? 'desconocido'}
                        </span>
                        <span className="text-xs text-muted">
                          {o.created_at ? new Date(o.created_at).toLocaleString() : ''}
                        </span>
                      </div>
                      <p className="text-sm text-[#d7c5ae] line-clamp-3 whitespace-pre-wrap">{content}</p>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
