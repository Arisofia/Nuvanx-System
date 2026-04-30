import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Textarea } from '../components/ui/textarea'
import { Sparkles } from 'lucide-react'

export default function AI() {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    setTimeout(() => setLoading(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">AI Layer</h1>
        <p className="text-slate-600 mt-1">AI content generation + campaign analysis</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
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
              <Button onClick={handleGenerate} disabled={loading || !prompt} className="w-full gap-2">
                <Sparkles className="w-4 h-4" />
                {loading ? 'Generating...' : 'Generate with AI'}
              </Button>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Generated Content</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600 text-sm">Generated content will appear here...</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Templates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start text-left h-auto">
                <div>
                  <p className="font-medium text-sm">WhatsApp Follow-up</p>
                  <p className="text-xs text-slate-500">Nurture leads via WhatsApp</p>
                </div>
              </Button>
              <Button variant="outline" className="w-full justify-start text-left h-auto">
                <div>
                  <p className="font-medium text-sm">Email Campaign</p>
                  <p className="text-xs text-slate-500">Bulk email templates</p>
                </div>
              </Button>
              <Button variant="outline" className="w-full justify-start text-left h-auto">
                <div>
                  <p className="font-medium text-sm">Ad Copy</p>
                  <p className="text-xs text-slate-500">Meta/Google ad variations</p>
                </div>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Campaign Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">
                Analyze Performance
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
