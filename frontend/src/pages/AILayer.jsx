import { useState, useEffect } from 'react';
import { Loader2, Copy, CheckCheck, Sparkles, BarChart2, ChevronDown, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApi } from '../hooks/useApi';
import api from '../config/api';

const CONTENT_TYPES = [
  'Ad Copy',
  'Email Subject Line',
  'WhatsApp Message',
  'Campaign Concept',
  'Follow-up Script',
  'Referral Invite',
  'SMS Blast',
];

export default function AILayer() {
  const [engine, setEngine] = useState('openai');
  const [contentType, setContentType] = useState(CONTENT_TYPES[0]);
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [copied, setCopied] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const [generateOutputId, setGenerateOutputId] = useState(null);

  const [campaignData, setCampaignData] = useState('');
  const [analysisResult, setAnalysisResult] = useState('');
  const [analyzeError, setAnalyzeError] = useState(null);
  const [analyzeOutputId, setAnalyzeOutputId] = useState(null);
  const [recentOutputs, setRecentOutputs] = useState([]);
  const [loadingOutputs, setLoadingOutputs] = useState(false);

  const [aiAvailable, setAiAvailable] = useState(null); // null = checking, true/false = result
  const [aiProvider, setAiProvider] = useState(null);

  const { loading: generating, post: postGenerate } = useApi(),
    { loading: analyzing, post: postAnalyze } = useApi();

  // Check AI key availability on mount
  useEffect(() => {
    api.get('/api/ai/status')
      .then((res) => {
        setAiAvailable(res.data?.available ?? false);
        setAiProvider(res.data?.provider || null);
      })
      .catch(() => setAiAvailable(false));

    fetchRecentOutputs();
  }, []);

  const fetchRecentOutputs = async () => {
    setLoadingOutputs(true);
    try {
      const res = await api.get('/api/ai/outputs', { params: { limit: 8 } });
      setRecentOutputs(res.data?.outputs || []);
    } catch {
      setRecentOutputs([]);
    } finally {
      setLoadingOutputs(false);
    }
  };

  const formatOutputPreview = (row) => {
    const out = row?.output || {};
    if (typeof out.content === 'string' && out.content.trim()) return out.content;
    if (typeof out.analysis === 'string' && out.analysis.trim()) return out.analysis;
    if (Array.isArray(out.suggestions)) return out.suggestions.join(' | ');
    return 'Stored output';
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error('Please enter a prompt first');
      return;
    }
    setGenerateError(null);
    setGenerateOutputId(null);
    try {
      const res = await postGenerate('/api/ai/generate', { prompt, provider: engine, contentType });
      setResult(res.result || res.content || '');
      setGenerateOutputId(res.outputId || null);
      fetchRecentOutputs();
      toast.success('Content generated successfully!');
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to generate content. Please ensure AI integration is connected.';
      setGenerateError(msg);
      console.error('AI generation error:', err);
      toast.error(msg);
    }
  };

  const handleAnalyze = async () => {
    if (!campaignData.trim()) {
      toast.error('Please paste your campaign data first');
      return;
    }
    setAnalyzeError(null);
    setAnalyzeOutputId(null);
    try {
      const res = await postAnalyze('/api/ai/analyze-campaign', { campaignData, provider: engine });
      setAnalysisResult(res.analysis || res.result || '');
      setAnalyzeOutputId(res.outputId || null);
      fetchRecentOutputs();
      toast.success('Campaign analyzed successfully!');
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to analyze campaign. Please ensure AI integration is connected.';
      setAnalyzeError(msg);
      console.error('AI analysis error:', err);
      toast.error(msg);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    toast.success('Copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-white">AI Content Layer</h2>
        <p className="text-gray-400 mt-0.5">Generate, optimize, and analyze with GPT-4 or Gemini</p>
      </div>

      {/* AI key status banner */}
      {aiAvailable === false && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <p className="text-sm leading-relaxed">
            No AI engine configured. Connect an <strong>OpenAI</strong> or <strong>Gemini</strong> key in{' '}
            <a href="/integrations" className="underline hover:text-amber-200">Integrations</a> to
            enable content generation.
          </p>
        </div>
      )}
      {aiAvailable === true && (
        <div className="flex items-center gap-2 text-xs text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          AI engine ready
          {aiProvider && <span className="text-gray-500">· {aiProvider}</span>}
        </div>
      )}

      {/* Engine Toggle */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-400">AI Engine:</span>
        <div className="flex rounded-lg border border-dark-600 overflow-hidden">
          {[
            { id: 'openai', label: '🤖 GPT-4' },
            { id: 'gemini', label: '✨ Gemini' },
          ].map(e => (
            <button
              key={e.id}
              onClick={() => setEngine(e.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                engine === e.id
                  ? 'bg-brand-500 text-white'
                  : 'bg-dark-700 text-gray-400 hover:text-white'
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Content Generator */}
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-brand-400" />
            <h3 className="font-semibold text-white">Content Generator</h3>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Content Type</label>
            <div className="relative">
              <select
                value={contentType}
                onChange={e => setContentType(e.target.value)}
                className="input appearance-none pr-9 cursor-pointer"
              >
                {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Your Prompt</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder={`Describe what you need...\n\nExample: "Write a ${contentType.toLowerCase()} for a spring promotion targeting women 30-45 interested in anti-aging treatments. Tone: warm, professional."`}
              className="input min-h-[140px] resize-none leading-relaxed"
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {generating ? 'Generating…' : 'Generate Content'}
          </button>

          {generateError && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={16} />
              <p className="text-xs text-red-400">{generateError}</p>
            </div>
          )}

          {result && (
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">Result</span>
                <div className="flex items-center gap-3">
                  {generateOutputId && (
                    <span className="text-[11px] px-2 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                      Saved #{generateOutputId.slice(0, 8)}
                    </span>
                  )}
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors"
                  >
                    {copied ? <CheckCheck size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="bg-dark-800 border border-dark-600 rounded-lg p-4">
                <pre className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed font-sans">{result}</pre>
              </div>
            </div>
          )}
        </div>

        {/* Campaign Analyzer */}
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <BarChart2 size={18} className="text-violet-400" />
            <h3 className="font-semibold text-white">Campaign Analyzer</h3>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Campaign Data</label>
            <textarea
              value={campaignData}
              onChange={e => setCampaignData(e.target.value)}
              placeholder={'Paste your campaign metrics here (budget, impressions, clicks, leads, conversions, revenue).\nThe AI will analyze performance and suggest optimizations.'}
              className="input min-h-[180px] resize-none leading-relaxed font-mono text-xs"
            />
          </div>

          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg font-medium text-sm bg-violet-500 hover:bg-violet-600 text-white transition-colors disabled:opacity-50"
          >
            {analyzing ? <Loader2 size={16} className="animate-spin" /> : <BarChart2 size={16} />}
            {analyzing ? 'Analyzing…' : 'Analyze & Optimize'}
          </button>

          {analyzeError && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={16} />
              <p className="text-xs text-red-400">{analyzeError}</p>
            </div>
          )}

          {analysisResult && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">Optimization Report</span>
                {analyzeOutputId && (
                  <span className="text-[11px] px-2 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                    Saved #{analyzeOutputId.slice(0, 8)}
                  </span>
                )}
              </div>
              <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 max-h-80 overflow-y-auto">
                <pre className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed font-sans">{analysisResult}</pre>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-white">Recent AI Outputs</h3>
          <button onClick={fetchRecentOutputs} className="btn-secondary text-xs" disabled={loadingOutputs}>
            {loadingOutputs ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {recentOutputs.length === 0 ? (
          <p className="text-sm text-gray-400">No persisted outputs yet. Generate content to create history.</p>
        ) : (
          <div className="space-y-2">
            {recentOutputs.map((row) => (
              <div key={row.id} className="p-3 rounded-lg border border-dark-600 bg-dark-800/70">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <p className="text-xs text-gray-400 uppercase tracking-wide">{row.agent_type}</p>
                  <p className="text-[11px] text-gray-500">{new Date(row.created_at).toLocaleString()}</p>
                </div>
                <p className="text-sm text-gray-200 line-clamp-2">{formatOutputPreview(row)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { icon: '🎯', title: 'Targeted Prompts', tip: 'Include audience demographics, tone, and goal for best results.' },
          { icon: '🔄', title: 'A/B Variants', tip: 'Generate 3 variants and test each on 10% of your audience.' },
          { icon: '📊', title: 'Data-Driven', tip: 'Paste real campaign data into the Analyzer for actionable insights.' },
        ].map(t => (
          <div key={t.title} className="p-4 rounded-xl bg-dark-700/50 border border-dark-600">
            <p className="text-2xl mb-2">{t.icon}</p>
            <p className="text-sm font-semibold text-white">{t.title}</p>
            <p className="text-xs text-gray-500 mt-1">{t.tip}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
