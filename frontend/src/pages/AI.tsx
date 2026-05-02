import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Textarea } from '../components/ui/textarea'
import { Sparkles, BarChart2 } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'

const TEMPLATES = [
  { label: 'WhatsApp Follow-up', prompt: 'Generate 3 WhatsApp follow-up messages for dental clinic leads. Style: warm, professional, action-oriented. Max 3 short paragraphs each with a clear CTA.' },
  { label: 'Email Campaign', prompt: 'Write a compelling email campaign for an aesthetics clinic promoting a new treatment. Include subject line, body, and CTA.' },
  { label: 'Ad Copy', prompt: 'Generate 3 variations of Meta/Google ad copy for an aesthetics clinic. Each variation: headline (max 30 chars), description (max 90 chars), CTA.' },
]

export default function AI() {
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<string | null>(null)

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">AI Layer</h1>
        <p className="text-slate-600 mt-1">AI content generation + campaign analysis</p>
      </div>

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
                  placeholder="Describe what you want to generate (e.g., 'Generate 3 WhatsApp follow-up messages for dental appointments')"
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
                <pre className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">{result}</pre>
              </CardContent>
            </Card>
          )}

          {analysisResult !== null && (
            <Card>
              <CardHeader>
                <CardTitle>Campaign Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">{analysisResult}</pre>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Templates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {TEMPLATES.map((t) => (
                <Button
                  key={t.label}
                  variant="outline"
                  className="w-full justify-start text-left h-auto"
                  onClick={() => setPrompt(t.prompt)}
                >
                  <div>
                    <p className="font-medium text-sm">{t.label}</p>
                  </div>
                </Button>
              ))}
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
    </div>
  )
}
