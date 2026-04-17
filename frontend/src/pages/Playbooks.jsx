import { useState, useEffect, useCallback } from 'react';
import { Play, CheckCircle, Clock, FileText, MessageSquare, Calendar, RotateCcw, Star, Share2, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../config/api';

const ICON_MAP = {
  'lead-capture-nurture': MessageSquare,
  'appointment-followup': Calendar,
  'reengagement-campaign': RotateCcw,
  'seasonal-promotion': Star,
  'referral-program': Share2,
  'review-generation': FileText,
};

const ICON_COLOR_MAP = {
  'lead-capture-nurture': 'bg-blue-500/20 text-blue-400',
  'appointment-followup': 'bg-emerald-500/20 text-emerald-400',
  'reengagement-campaign': 'bg-amber-500/20 text-amber-400',
  'seasonal-promotion': 'bg-violet-500/20 text-violet-400',
  'referral-program': 'bg-pink-500/20 text-pink-400',
  'review-generation': 'bg-teal-500/20 text-teal-400',
};

export default function Playbooks() {
  const [playbooks, setPlaybooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(null); // slug of the playbook currently being run
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('All');

  const fetchPlaybooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/playbooks');
      setPlaybooks(res.data.playbooks || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Error loading playbooks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlaybooks(); }, [fetchPlaybooks]);

  const categories = ['All', ...Array.from(new Set(playbooks.map(p => p.category)))];
  const filtered = filter === 'All' ? playbooks : playbooks.filter(p => p.category === filter);

  async function handleRun(pb) {
    if (pb.status === 'draft') {
      toast('This playbook is in draft. Activate it first.', { icon: '📝' });
      return;
    }
    setRunning(pb.slug);
    try {
      const res = await api.post(`/api/playbooks/${pb.slug}/run`);
      toast.success(`"${pb.title}" executed successfully`);
      // Update run count locally without a full refetch
      setPlaybooks(prev => prev.map(p =>
        p.slug === pb.slug
          ? { ...p, runs: p.runs + 1, lastRunAt: res.data.execution.ranAt }
          : p
      ));
    } catch (err) {
      const msg = err.response?.data?.message || 'Error running playbook';
      toast.error(msg);
    } finally {
      setRunning(null);
    }
  }

  const totalRuns = playbooks.reduce((a, p) => a + p.runs, 0);
  const activeCount = playbooks.filter(p => p.status === 'active').length;

  if (error) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="card border-red-500/20 bg-red-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={20} />
            <div>
              <h3 className="font-semibold text-white">Error loading Playbooks</h3>
              <p className="text-sm text-gray-300 mt-1">{error}</p>
              <button onClick={fetchPlaybooks} className="btn-secondary text-sm mt-3">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">Playbooks</h2>
          <p className="text-gray-400 mt-0.5">Business automations. Run counters are real and persisted in the database.</p>
        </div>
        <button
          onClick={fetchPlaybooks}
          disabled={loading}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Playbooks', value: loading ? '—' : playbooks.length },
          { label: 'Active', value: loading ? '—' : activeCount },
          { label: 'Total Runs', value: loading ? '—' : totalRuns },
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

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="card animate-pulse h-64 bg-dark-700/50" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="card text-center py-16">
          <AlertCircle size={32} className="mx-auto mb-3 text-gray-600" />
          <p className="text-gray-400 font-medium">No playbooks in this category</p>
        </div>
      )}

      {/* Playbook Grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((pb) => {
            const Icon = ICON_MAP[pb.slug] || FileText;
            const iconColor = ICON_COLOR_MAP[pb.slug] || 'bg-gray-500/20 text-gray-400';
            const isRunning = running === pb.slug;
            const isActive = pb.status === 'active';

            return (
              <div key={pb.id} className="card flex flex-col gap-4 hover:border-dark-500 transition-colors">
                <div className="flex items-start gap-3">
                  <div className={`p-2.5 rounded-xl ${iconColor}`}>
                    <Icon size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-white leading-snug">{pb.title}</h3>
                      <span className={isActive ? 'badge-active' : 'badge-draft'}>
                        <span className={`status-dot ${isActive ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                        {isActive ? 'Active' : 'Draft'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{pb.category}</p>
                  </div>
                </div>

                <p className="text-sm text-gray-400 leading-relaxed">{pb.description}</p>

                {/* Steps */}
                <div className="space-y-1.5">
                  {(pb.steps || []).map((step, i) => (
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
                      <Clock size={12} /> {pb.runs} ejecuciones
                    </span>
                    {pb.successRate !== null && (
                      <span className="flex items-center gap-1">
                        <CheckCircle size={12} className="text-emerald-500" /> {pb.successRate}%
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleRun(pb)}
                    disabled={isRunning}
                    className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50'
                        : 'bg-dark-600 hover:bg-dark-500 text-gray-300'
                    }`}
                  >
                    {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    {isRunning ? 'Ejecutando...' : 'Run Playbook'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
