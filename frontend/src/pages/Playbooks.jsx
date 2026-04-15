import { useState } from 'react';
import { Play, CheckCircle, Clock, FileText, MessageSquare, Calendar, RotateCcw, Star, Share2 } from 'lucide-react';
import toast from 'react-hot-toast';

const playbooks = [
  {
    id: 1,
    title: 'Lead Capture & Nurture',
    description: 'Automate the journey from Meta Ads click to WhatsApp conversation — capture, qualify, and nurture every lead.',
    icon: MessageSquare,
    iconColor: 'bg-blue-500/20 text-blue-400',
    status: 'Active',
    category: 'Acquisition',
    steps: [
      'Meta Ads Lead Form triggers webhook',
      'Lead data synced to CRM automatically',
      'WhatsApp welcome message sent within 2 min',
      'AI qualifies lead with 3-question sequence',
      'Appointment booking link sent to qualified leads',
    ],
    runs: 142,
    successRate: 78,
  },
  {
    id: 2,
    title: 'Appointment Follow-up',
    description: 'Post-consultation and post-treatment automated follow-up sequence to maximize satisfaction and upsells.',
    icon: Calendar,
    iconColor: 'bg-emerald-500/20 text-emerald-400',
    status: 'Active',
    category: 'Retention',
    steps: [
      'Treatment completion recorded in system',
      'Satisfaction survey sent 24h after',
      'Personalized care instructions via WhatsApp',
      'Upsell offer for complementary treatment at day 7',
      'Monthly check-in message at day 30',
    ],
    runs: 89,
    successRate: 84,
  },
  {
    id: 3,
    title: 'Re-engagement Campaign',
    description: 'Reactivate dormant clients who haven\'t booked in 60+ days with personalized offers.',
    icon: RotateCcw,
    iconColor: 'bg-amber-500/20 text-amber-400',
    status: 'Active',
    category: 'Reactivation',
    steps: [
      'Identify clients inactive for 60+ days',
      'Segment by last treatment type',
      'Send personalized reactivation email',
      'WhatsApp follow-up after 48h if no open',
      'Exclusive 15% discount offer at day 5',
    ],
    runs: 34,
    successRate: 61,
  },
  {
    id: 4,
    title: 'Seasonal Promotion',
    description: 'Launch holiday and seasonal campaigns with AI-generated copy tailored to your audience segments.',
    icon: Star,
    iconColor: 'bg-violet-500/20 text-violet-400',
    status: 'Draft',
    category: 'Campaigns',
    steps: [
      'Select promotion type and dates',
      'AI generates campaign copy variants',
      'A/B test on 10% of audience first',
      'Winning variant broadcast to full list',
      'Performance report generated automatically',
    ],
    runs: 0,
    successRate: null,
  },
  {
    id: 5,
    title: 'Referral Program',
    description: 'Systematically turn happy clients into brand ambassadors with a tracked referral automation flow.',
    icon: Share2,
    iconColor: 'bg-pink-500/20 text-pink-400',
    status: 'Active',
    category: 'Growth',
    steps: [
      'Identify clients with NPS score 9-10',
      'Send referral invite with unique tracking link',
      'Reward notification when referral books',
      'Thank-you message and reward delivery',
      'Monthly leaderboard for top referrers',
    ],
    runs: 23,
    successRate: 71,
  },
  {
    id: 6,
    title: 'Review Generation',
    description: 'Automate post-treatment review requests to Google and social platforms at the optimal timing.',
    icon: FileText,
    iconColor: 'bg-teal-500/20 text-teal-400',
    status: 'Draft',
    category: 'Reputation',
    steps: [
      'Treatment marked complete in CRM',
      'Wait 48h for experience to settle',
      'Send personalized review request',
      'If no action at 72h, send WhatsApp reminder',
      'Flag negative reviews for immediate follow-up',
    ],
    runs: 0,
    successRate: null,
  },
];

export default function Playbooks() {
  const [filter, setFilter] = useState('All');
  const categories = ['All', 'Acquisition', 'Retention', 'Reactivation', 'Campaigns', 'Growth', 'Reputation'];

  const filtered = filter === 'All' ? playbooks : playbooks.filter(p => p.category === filter);

  function handleRun(pb) {
    if (pb.status === 'Draft') {
      toast('This playbook is in Draft mode. Publish it first.', { icon: '📝' });
    } else {
      toast('Demo action only. Playbook execution is not implemented in backend yet.', { icon: 'ℹ️' });
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-white">Operativo</h2>
        <p className="text-gray-400 mt-0.5">Demo data. Backend playbook orchestration is pending implementation.</p>
      </div>

      <div className="card border-amber-500/20 bg-amber-500/5">
        <p className="text-sm text-amber-300 font-medium">Demo Data</p>
        <p className="text-xs text-amber-200/80 mt-1">
          Runs, success rates, and steps in this screen are static sample values for UI validation.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-3">
        {[
          { label: 'Sample Playbooks', value: playbooks.length },
          { label: 'Active', value: playbooks.filter(p => p.status === 'Active').length },
          { label: 'Sample Runs', value: playbooks.reduce((a, p) => a + p.runs, 0) },
        ].map(s => (
          <div key={s.label} className="card text-center py-4">
            <p className="text-2xl font-bold text-white">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {categories.map(c => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === c
                ? 'bg-brand-500 text-white'
                : 'bg-dark-700 text-gray-400 hover:text-white border border-dark-600'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Playbook Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {filtered.map((pb) => {
          const Icon = pb.icon;
          return (
            <div key={pb.id} className="card flex flex-col gap-4 hover:border-dark-500 transition-colors">
              <div className="flex items-start gap-3">
                <div className={`p-2.5 rounded-xl ${pb.iconColor}`}>
                  <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-white leading-snug">{pb.title}</h3>
                    <span className={pb.status === 'Active' ? 'badge-active' : 'badge-draft'}>
                      <span className={`status-dot ${pb.status === 'Active' ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                      {pb.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{pb.category}</p>
                </div>
              </div>

              <p className="text-sm text-gray-400 leading-relaxed">{pb.description}</p>

              {/* Steps */}
              <div className="space-y-1.5">
                {pb.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-dark-600 text-gray-400 text-xs flex items-center justify-center shrink-0 mt-0.5 font-medium">
                      {i + 1}
                    </span>
                    <p className="text-xs text-gray-400">{step}</p>
                  </div>
                ))}
              </div>

              {/* Stats & Action */}
              <div className="flex items-center justify-between pt-3 border-t border-dark-600 mt-auto">
                <div className="flex gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock size={12} /> {pb.runs} runs
                  </span>
                  {pb.successRate !== null && (
                    <span className="flex items-center gap-1">
                      <CheckCircle size={12} className="text-emerald-500" /> {pb.successRate}%
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleRun(pb)}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                    pb.status === 'Active'
                      ? 'bg-brand-500 hover:bg-brand-600 text-white'
                      : 'bg-dark-600 hover:bg-dark-500 text-gray-300'
                  }`}
                >
                  <Play size={12} />
                  Run Playbook
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
