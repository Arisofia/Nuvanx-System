import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Calendar, FileText, Search, UserPlus, Loader2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../config/api';

// Map backend stage names to display status labels
const STAGE_TO_STATUS = {
  lead: 'New',
  whatsapp: 'Contacted',
  appointment: 'Appointment',
  treatment: 'Converted',
  closed: 'Converted',
};

function normalizeLead(lead) {
  return {
    id: lead.id,
    name: lead.name || '—',
    source: lead.source || 'manual',
    status: STAGE_TO_STATUS[lead.stage] || 'New',
    lastContact: lead.updatedAt ? lead.updatedAt.split('T')[0] : lead.createdAt?.split('T')[0] || '',
    value: lead.revenue || 0,
    email: lead.email || '',
    phone: lead.phone || '',
  };
}

const statusConfig = {
  New: { class: 'bg-blue-500/10 text-blue-400 border border-blue-500/20', dot: 'bg-blue-400' },
  Contacted: { class: 'bg-amber-500/10 text-amber-400 border border-amber-500/20', dot: 'bg-amber-400' },
  Appointment: { class: 'bg-violet-500/10 text-violet-400 border border-violet-500/20', dot: 'bg-violet-400' },
  Converted: { class: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20', dot: 'bg-emerald-400' },
};

const sourceColors = {
  'Meta Ads': 'text-blue-400',
  'Referral': 'text-emerald-400',
  'Google Ads': 'text-amber-400',
  'Organic': 'text-gray-400',
};

export default function CRM() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/leads');
      const serverLeads = res.data?.leads || [];
      setLeads(serverLeads.map(normalizeLead));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load leads');
      console.error('CRM fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const statuses = ['All', 'New', 'Contacted', 'Appointment', 'Converted'];

  const filtered = leads.filter(l => {
    const matchStatus = filter === 'All' || l.status === filter;
    const matchSearch = !search || l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.source.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  function handleWhatsApp(lead) {
    toast('Placeholder action: WhatsApp launch is not wired yet.', { icon: 'ℹ️' });
  }
  function handleCalendar(lead) {
    toast('Placeholder action: Calendar scheduling is not wired yet.', { icon: 'ℹ️' });
  }
  function handleNotes(lead) {
    toast('Placeholder action: Lead notes editor is not implemented yet.', { icon: 'ℹ️' });
  }

  const counts = statuses.slice(1).reduce((acc, s) => {
    acc[s] = leads.filter(l => l.status === s).length;
    return acc;
  }, {});

  if (error) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="card border-red-500/20 bg-red-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <h3 className="font-semibold text-white mb-1">Error Loading CRM</h3>
              <p className="text-sm text-gray-300 mb-3">{error}</p>
              <button onClick={fetchLeads} className="btn-secondary text-sm">
                Try Again
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
          <h2 className="text-2xl font-bold text-white">CRM & Lead Pipeline</h2>
          <p className="text-gray-400 mt-0.5">
            {loading ? 'Loading…' : `${leads.length} total leads tracked`}
          </p>
          <p className="text-xs text-gray-500 mt-1">Lead list is sourced from backend endpoint /api/leads.</p>
        </div>
        <button
          type="button"
          onClick={() => toast('Placeholder action: lead creation modal is pending implementation.', { icon: 'ℹ️' })}
          className="btn-primary flex items-center gap-2"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
          Add Lead
        </button>
      </div>

      {/* Pipeline summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statuses.slice(1).map(s => {
          const cfg = statusConfig[s];
          return (
            <div key={s} className="card py-4 text-center cursor-pointer hover:border-dark-500 transition-colors" onClick={() => setFilter(s)}>
              <div className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full mb-2 ${cfg.class}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {s}
              </div>
              <p className="text-2xl font-bold text-white">{counts[s]}</p>
            </div>
          );
        })}
      </div>

      {/* Filters & Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search leads…"
            className="input pl-9 py-2"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === s ? 'bg-brand-500 text-white' : 'bg-dark-700 text-gray-400 hover:text-white border border-dark-600'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-600">
                {['Name', 'Source', 'Status', 'Last Contact', 'Value', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3.5 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-600">
              {filtered.map(lead => {
                const cfg = statusConfig[lead.status];
                return (
                  <tr key={lead.id} className="hover:bg-dark-800/50 transition-colors group">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400/40 to-brand-600/40 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {lead.name[0]}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">{lead.name}</p>
                          <p className="text-xs text-gray-500">{lead.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs font-medium ${sourceColors[lead.source] || 'text-gray-400'}`}>
                        {lead.source}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${cfg.class}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-gray-400">
                      {lead.lastContact
                        ? new Date(lead.lastContact).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-sm font-semibold text-white">${lead.value.toLocaleString()}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleWhatsApp(lead)}
                          title="WhatsApp"
                          className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                        >
                          <MessageSquare size={15} />
                        </button>
                        <button
                          onClick={() => handleCalendar(lead)}
                          title="Schedule"
                          className="p-1.5 rounded-lg text-brand-400 hover:bg-brand-500/10 transition-colors"
                        >
                          <Calendar size={15} />
                        </button>
                        <button
                          onClick={() => handleNotes(lead)}
                          title="Notes"
                          className="p-1.5 rounded-lg text-gray-400 hover:bg-dark-600 transition-colors"
                        >
                          <FileText size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && !loading && (
            <div className="text-center py-12 text-gray-500">
              <UserPlus size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">
                {leads.length === 0 ? 'No leads yet' : 'No leads found matching your filters'}
              </p>
              <p className="text-xs">
                {leads.length === 0 ? 'Add your first lead to get started' : 'Try adjusting your filters'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
