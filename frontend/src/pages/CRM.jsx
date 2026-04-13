import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Calendar, FileText, Search, UserPlus, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../config/api';

const MOCK_LEADS = [
  { id: 1, name: 'Sofia Martínez', source: 'Meta Ads', status: 'New', lastContact: '2025-01-14', value: 450, email: 'sofia@email.com', phone: '+1 555 0101' },
  { id: 2, name: 'Carlos Herrera', source: 'Referral', status: 'Contacted', lastContact: '2025-01-13', value: 780, email: 'carlos@email.com', phone: '+1 555 0102' },
  { id: 3, name: 'Valentina Cruz', source: 'Google Ads', status: 'Appointment', lastContact: '2025-01-12', value: 1200, email: 'vale@email.com', phone: '+1 555 0103' },
  { id: 4, name: 'Miguel Torres', source: 'Meta Ads', status: 'Converted', lastContact: '2025-01-11', value: 340, email: 'miguel@email.com', phone: '+1 555 0104' },
  { id: 5, name: 'Isabella Reyes', source: 'Organic', status: 'New', lastContact: '2025-01-14', value: 560, email: 'isa@email.com', phone: '+1 555 0105' },
  { id: 6, name: 'Diego Morales', source: 'Meta Ads', status: 'Contacted', lastContact: '2025-01-10', value: 920, email: 'diego@email.com', phone: '+1 555 0106' },
  { id: 7, name: 'Camila López', source: 'Referral', status: 'Appointment', lastContact: '2025-01-13', value: 1500, email: 'cami@email.com', phone: '+1 555 0107' },
  { id: 8, name: 'Andrés García', source: 'Google Ads', status: 'New', lastContact: '2025-01-14', value: 380, email: 'andres@email.com', phone: '+1 555 0108' },
  { id: 9, name: 'Luciana Flores', source: 'Meta Ads', status: 'Converted', lastContact: '2025-01-09', value: 2200, email: 'luci@email.com', phone: '+1 555 0109' },
  { id: 10, name: 'Roberto Jiménez', source: 'Organic', status: 'Contacted', lastContact: '2025-01-12', value: 670, email: 'roberto@email.com', phone: '+1 555 0110' },
];

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
  const [leads, setLeads] = useState(MOCK_LEADS);
  const [usingLiveData, setUsingLiveData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/leads');
      const serverLeads = res.data?.leads || [];
      if (serverLeads.length > 0) {
        setLeads(serverLeads.map(normalizeLead));
        setUsingLiveData(true);
      }
    } catch {
      // Backend unavailable — keep mock data
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
    toast.success(`Opening WhatsApp for ${lead.name}`);
  }
  function handleCalendar(lead) {
    toast.success(`Scheduling appointment for ${lead.name}`);
  }
  function handleNotes(lead) {
    toast(`Notes for ${lead.name}`, { icon: '📝' });
  }

  const counts = statuses.slice(1).reduce((acc, s) => {
    acc[s] = leads.filter(l => l.status === s).length;
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-white">CRM & Lead Pipeline</h2>
            {usingLiveData && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Live Data
              </span>
            )}
          </div>
          <p className="text-gray-400 mt-0.5">
            {loading ? 'Loading…' : `${leads.length} total leads tracked`}
          </p>
        </div>
        <button className="btn-primary flex items-center gap-2">
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
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-500">No leads found matching your filters.</div>
          )}
        </div>
      </div>
    </div>
  );
}
