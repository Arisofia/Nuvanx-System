import { useState } from 'react';
import { Loader2, Copy, CheckCheck, Sparkles, BarChart2, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApi } from '../hooks/useApi';

const CONTENT_TYPES = [
  'Ad Copy',
  'Email Subject Line',
  'WhatsApp Message',
  'Campaign Concept',
  'Follow-up Script',
  'Referral Invite',
  'SMS Blast',
];

const MOCK_RESULTS = {
  'Ad Copy': `🌟 Transform Your Look This Season!\n\nDiscover our exclusive aesthetic treatments designed for natural, radiant results.\n✅ 15+ specialized procedures\n✅ Board-certified specialists\n✅ Results in 1 visit\n\n👉 Book your free consultation today — limited slots available!\n\n#AestheticClinic #GlowUp #NaturalBeauty`,
  'Email Subject Line': `"Your complimentary consultation is waiting, [Name] ✨" | "Last chance: 20% off this weekend only" | "We noticed you haven't visited in a while — here's a gift"`,
  'WhatsApp Message': `Hi [Name]! 👋 It's the team at [Clinic]. We wanted to follow up on your recent inquiry about our treatments. We have availability this week that matches your schedule perfectly. Would you like me to send you a few options? 😊`,
  'Campaign Concept': `Campaign: "New Year, New You" — Q1 Reactivation\n\nAngle: Transformation story + before/after social proof\nChannel mix: Meta Reels + WhatsApp broadcast + Email\nOffers: 3-treatment package at 25% off\nTimeline: 2-week campaign, 5 touchpoints per lead\nExpected conversion lift: +18% based on historical data`,
  'Follow-up Script': `Day 1: "Hi [Name], thank you for your consultation today! Here's your personalized care guide: [link]"\n\nDay 3: "How are you feeling? Any questions about your treatment plan?"\n\nDay 7: "Ready to maximize your results? Book your follow-up treatment at a 15% discount this week only."\n\nDay 30: "It's been a month! We'd love to hear your experience. Would you mind leaving us a quick review? [link]"`,
  'Referral Invite': `[Name], you're amazing! 🌟\n\nAs one of our favorite clients, we'd love to share something special with you. For every friend you refer, you'll receive $50 credit toward your next treatment — and your friend gets 15% off their first visit!\n\nYour unique referral link: [link]\n\nThank you for being part of our community! 💛`,
  'SMS Blast': `Hi [Name]! Nuvanx Clinic here. 🌟 Our Spring promotion ends Sunday — 20% off all facial treatments. Reply BOOK or call 555-0100. Opt-out: STOP`,
};

const MOCK_ANALYSIS = `## Campaign Performance Analysis

**Overall Score: 7.2/10**

### Strengths
- Strong click-through rate (3.2%) — 40% above industry average
- WhatsApp response rate at 68% (excellent engagement)
- Cost per lead at $12.40 is within target range

### Optimization Opportunities
1. **Audience Fatigue** — Ad frequency at 4.2x; rotate creatives every 7 days
2. **Drop-off at WhatsApp Stage** — 31% of leads don't respond to first message; test sending within 5 min instead of 15 min of lead capture
3. **Appointment Show Rate** — 78% show rate; add SMS reminder 2h before appointment to reach 85%+
4. **Best Performing Creative** — Video reels outperform static 2.4x — increase video budget allocation to 70%

### Recommended Actions
- Increase retargeting audience from 30 to 60-day window
- Add lookalike audience based on top 20% converted clients
- Test promotional offer in first WhatsApp message (conversion +22% in A/B tests)
- Run campaigns Tuesday–Thursday for 35% lower CPL`;

export default function AILayer() {
  const [engine, setEngine] = useState('openai');
  const [contentType, setContentType] = useState(CONTENT_TYPES[0]);
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [copied, setCopied] = useState(false);

  const [campaignData, setCampaignData] = useState('');
  const [analysisResult, setAnalysisResult] = useState('');

  const { loading: generating, post: postGenerate } = useApi();
  const { loading: analyzing, post: postAnalyze } = useApi();

  async function handleGenerate() {
    if (!prompt.trim()) {
      toast.error('Please enter a prompt first');
      return;
    }
    try {
      const res = await postGenerate('/api/ai/generate', { prompt, provider: engine });
      setResult(res.result || res.content || '');
    } catch {
      // Backend not available — use mock
      const mock = MOCK_RESULTS[contentType] || 'AI-generated content will appear here when the backend is connected.';
      setResult(mock);
      toast('Using demo response — connect OpenAI in Integrations to go live', { icon: '💡' });
    }
  }

  async function handleAnalyze() {
    if (!campaignData.trim()) {
      toast.error('Please paste your campaign data first');
      return;
    }
    try {
      const res = await postAnalyze('/api/ai/analyze-campaign', { campaignData, provider: engine });
      setAnalysisResult(res.analysis || res.result || '');
    } catch {
      setAnalysisResult(MOCK_ANALYSIS);
      toast('Using demo analysis — connect AI in Integrations to go live', { icon: '💡' });
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(result);
    setCopied(true);
    toast.success('Copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-white">AI Content Layer</h2>
        <p className="text-gray-400 mt-0.5">Generate, optimize, and analyze with GPT-4 or Gemini</p>
      </div>

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

          {result && (
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">Result</span>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors"
                >
                  {copied ? <CheckCheck size={13} /> : <Copy size={13} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
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
              placeholder={`Paste your campaign metrics here...\n\nExample:\nCampaign: Spring Aesthetics\nBudget: $2,400\nImpressions: 45,200\nClicks: 1,440 (3.2% CTR)\nLeads: 89\nCost per lead: $26.97\nAppointments: 34\nConversions: 12\nRevenue: $8,400`}
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

          {analysisResult && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">Optimization Report</span>
              </div>
              <div className="bg-dark-800 border border-dark-600 rounded-lg p-4 max-h-80 overflow-y-auto">
                <pre className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed font-sans">{analysisResult}</pre>
              </div>
            </div>
          )}
        </div>
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
