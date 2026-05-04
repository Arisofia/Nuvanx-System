import { useEffect, useState } from 'react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Textarea } from '../components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Sparkles, BarChart2, Lightbulb, History, Copy, Check } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'
import { TemplateGallery } from '../components/ai/TemplateGallery'

export default function AI() {
  // Generate tab
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<string | null>(null)

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
    setError(null)
    setAnalysisResult(null)
    try {
      const campaigns: any = await invokeApi('/meta/campaigns')
      const campaignData = JSON.stringify(campaigns?.campaigns ?? [], null, 2)
      const data: any = await invokeApi('/ai/analyze-campaign', { method: 'POST', body: { campaignData } })
      if (!data?.success) throw new Error(data?.message || 'Analysis failed')
      setAnalysisResult(data.content ?? data.result ?? data.analysis ?? '')
    } catch (err: any) {
      setError(err?.message || 'Campaign analysis failed.')
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

  const outputTypes = ['all', ...Array.from(new Set(outputs.map((o) => o.agent_type).filter(Boolean)))]
  const filteredOutputs = typeFilter === 'all' ? outputs : outputs.filter((o) => o.agent_type === typeFilter)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">AI Layer</h1>
        <p className="text-slate-400 mt-1">AI content generation, suggestions and output history</p>
      </div>

      <Tabs defaultValue="generate" className="w-full">
        <TabsList>
          <TabsTrigger value="generate" className="gap-2"><Sparkles className="w-4 h-4" />Generate</TabsTrigger>
          <TabsTrigger value="suggestions" className="gap-2"><Lightbulb className="w-4 h-4" />Suggestions</TabsTrigger>
          <TabsTrigger value="history" className="gap-2"><History className="w-4 h-4" />History</TabsTrigger>
        </TabsList>

        {/* ── Generate ── */}
        <TabsContent value="generate" className="mt-4 space-y-4">
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Generate Content</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Prompt</label>
                    <Textarea
                      placeholder="Describe what you want to generate…"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      className="mt-2"
                      rows={4}
                    />
                  </div>
                  <Button onClick={handleGenerate} disabled={loading || !prompt.trim()} className="w-full gap-2">
                    <Sparkles className="w-4 h-4" />
                    {loading ? 'Generating…' : 'Generate with AI'}
                  </Button>
                </CardContent>
              </Card>

              {result !== null && (
                <Card>
                  <CardHeader>
                    <CardTitle>Generated Content</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="whitespace-pre-wrap text-sm text-slate-300 leading-relaxed">{result}</pre>
                  </CardContent>
                </Card>
              )}

              {analysisResult !== null && (
                <Card>
                  <CardHeader>
                    <CardTitle>Campaign Analysis</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="whitespace-pre-wrap text-sm text-slate-300 leading-relaxed">{analysisResult}</pre>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Templates</CardTitle>
                </CardHeader>
                <CardContent>
                  <TemplateGallery onSelect={(p) => setPrompt(p)} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Campaign Analysis</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full gap-2" onClick={handleAnalyze} disabled={analyzing}>
                    <BarChart2 className="w-4 h-4" />
                    {analyzing ? 'Analyzing…' : 'Analyze Performance'}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── Suggestions ── */}
        <TabsContent value="suggestions" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle>AI Suggestions</CardTitle>
              <Button onClick={handleFetchSuggestions} disabled={suggestionsLoading} size="sm" className="gap-2">
                <Lightbulb className="w-4 h-4" />
                {suggestionsLoading ? 'Loading…' : 'Get Suggestions'}
              </Button>
            </CardHeader>
            <CardContent>
              {suggestionsError && (
                <p className="text-sm text-red-500 mb-4">{suggestionsError}</p>
              )}
              {suggestions.length === 0 && !suggestionsLoading && !suggestionsError && (
                <p className="text-slate-500 text-sm py-4 text-center">Click "Get Suggestions" to receive AI-powered insights based on your leads.</p>
              )}
              <div className="space-y-3">
                {suggestions.map((s, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 p-4 rounded-lg border border-slate-700 bg-slate-900">
                    <p className="text-sm text-slate-200 flex-1">{s}</p>
                    <button
                      onClick={() => handleCopy(s, i)}
                      className="shrink-0 text-slate-500 hover:text-slate-200 transition-colors"
                      title="Copy to clipboard"
                    >
                      {copiedIdx === i ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
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
              <CardTitle>Output History</CardTitle>
              <div className="flex items-center gap-2">
                {outputTypes.length > 1 && (
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="bg-slate-800 text-white text-xs font-medium px-3 py-1.5 rounded-lg border-none focus:ring-1 focus:ring-slate-500"
                  >
                    {outputTypes.map((t) => (
                      <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>
                    ))}
                  </select>
                )}
                <Button onClick={handleFetchOutputs} disabled={outputsLoading} size="sm" variant="outline" className="gap-2">
                  <History className="w-4 h-4" />
                  {outputsLoading ? 'Loading…' : 'Load History'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {outputsError && (
                <p className="text-sm text-red-500 mb-4">{outputsError}</p>
              )}
              {filteredOutputs.length === 0 && !outputsLoading && !outputsError && (
                <p className="text-slate-500 text-sm py-4 text-center">No output history yet. Click "Load History" to fetch previous AI outputs.</p>
              )}
              <div className="space-y-3">
                {filteredOutputs.map((o) => {
                  const content = typeof o.output === 'string'
                    ? o.output
                    : o.output?.content ?? o.output?.result ?? JSON.stringify(o.output ?? {})
                  return (
                    <div key={o.id} className="p-4 rounded-lg border border-slate-700 bg-slate-900 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          {o.agent_type ?? 'unknown'}
                        </span>
                        <span className="text-xs text-slate-500">
                          {o.created_at ? new Date(o.created_at).toLocaleString() : ''}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300 line-clamp-3 whitespace-pre-wrap">{content}</p>
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
