import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Calendar, FileText, Search, UserPlus, Loader2, AlertCircle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../config/api';

// Backend stage values, in pipeline order
const STAGES = ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'];
const STAGE_LABELS = { lead: 'New', whatsapp: 'Contacted', appointment: 'Appointment', treatment: 'Converted', closed: 'Closed' };
const SOURCE_OPTIONS = ['manual', 'Meta Ads', 'Google Ads', 'Referral', 'Organic', 'WhatsApp'];

const LOST_REASONS = [
  { value: 'price_too_high', label: 'Price too high' },
  { value: 'location', label: 'Location' },
  { value: 'no_response', label: 'No response' },
  { value: 'competitor', label: 'Went to competitor' },
  { value: 'not_ready', label: 'Not ready' },
  { value: 'fake_lead', label: 'Fake lead' },
  { value: 'other', label: 'Other' },
];

const EMPTY_FORM = { name: '', email: '', phone: '', dni: '', source: 'manual', stage: 'lead', revenue: '', lost_reason: '', notes: '' };

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
    dni: lead.dni || '',
    lost_reason: lead.lost_reason || '',
  };
}

const statusConfig = {
  New: { class: 'bg-brand-500/10 text-brand-400 border border-brand-500/20', dot: 'bg-brand-400' },
  Contacted: { class: 'bg-amber-500/10 text-amber-400 border border-amber-500/20', dot: 'bg-amber-400' },
  Appointment: { class: 'bg-violet-500/10 text-violet-400 border border-violet-500/20', dot: 'bg-violet-400' },
  Converted: { class: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20', dot: 'bg-emerald-400' },
};

const sourceColors = {
  'Meta Ads': 'text-brand-400',
  'Referral': 'text-emerald-400',
  'Google Ads': 'text-amber-400',
  'Organic': 'text-gray-400',
};

// ---------------------------------------------------------------------------
// Add Lead Modal
// ---------------------------------------------------------------------------
function AddLeadModal({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState(null);

  const set = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFieldError('Name is required.');
      return;
    }
    setFieldError(null);
    setSaving(true);
    try {
      const rawRevenue = parseFloat(form.revenue);
      const payload = {
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        dni: form.dni.trim() || undefined,
        source: form.source || 'manual',
        stage: form.stage,
        revenue: form.revenue !== '' && !Number.isNaN(rawRevenue) ? rawRevenue : undefined,
        lost_reason: form.stage === 'closed' && form.lost_reason ? form.lost_reason : undefined,
        notes: form.notes.trim() || undefined,
      };
      const res = await api.post('/api/leads', payload);
      const leadName = String(res.data.lead?.name ?? 'Lead');
      toast.success(`Lead "${leadName}" created.`);
      onCreated(res.data.lead);
      onClose();
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to create lead.';
      setFieldError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-600">
          <h2 className="text-lg font-semibold text-white">Add New Lead</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-dark-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Full name"
              className="input w-full"
              autoFocus
            />
          </div>

          {/* Email + Phone */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="email@example.com"
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Phone</label>
              <input
                type="text"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                placeholder="+1 555 000 0000"
                className="input w-full"
              />
            </div>
          </div>

          {/* DNI */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              DNI <span className="text-gray-500 font-normal">(ID — links to Doctoralia revenue)</span>
            </label>
            <input
              type="text"
              value={form.dni}
              onChange={e => set('dni', e.target.value.toUpperCase())}
              placeholder="12345678A"
              className="input w-full font-mono"
              maxLength={16}
            />
          </div>

          {/* Source + Stage */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Source</label>
              <select value={form.source} onChange={e => set('source', e.target.value)} className="input w-full">
                {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Stage</label>
              <select value={form.stage} onChange={e => set('stage', e.target.value)} className="input w-full">
                {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </select>
            </div>
          </div>

          {/* Lost Reason — shown only when stage is closed */}
          {form.stage === 'closed' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Lost Reason</label>
              <select value={form.lost_reason} onChange={e => set('lost_reason', e.target.value)} className="input w-full">
                <option value="">— select reason —</option>
                {LOST_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          )}

          {/* Revenue */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Revenue (€)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.revenue}
              onChange={e => set('revenue', e.target.value)}
              placeholder="0.00"
              className="input w-full"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Optional notes about this lead…"
              className="input w-full resize-none"
              rows={2}
            />
          </div>

          {fieldError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
              <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{fieldError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 text-sm">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              {saving ? 'Saving…' : 'Create Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CRM() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

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

  const handleWhatsApp = async (lead) => {
    if (!lead.phone) {
      toast.error('Este lead no tiene número de teléfono registrado.');
      return;
    }
    const message = window.prompt(
      `Enviar WhatsApp a ${lead.name} (${lead.phone})\n\nEscribe el mensaje:`,
      `Hola ${lead.name}, te contactamos desde nuestra clínica. ¿Podemos ayudarte?`,
    );
    if (!message) return;
    try {
      await api.post('/api/whatsapp/send', { to: lead.phone, message, leadId: lead.id });
      toast.success(`WhatsApp enviado a ${lead.name}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error enviando WhatsApp');
    }
  }
  const handleCalendar = () => {
    toast('Calendar scheduling — coming soon.', { icon: '📅' });
  };
  const handleNotes = () => {
    toast('Lead notes editor — coming soon.', { icon: '📝' });
  };

  const handleLeadCreated = (newLead) => {
    setLeads(prev => [normalizeLead(newLead), ...prev]);
  };

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
          onClick={() => setShowAddModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
          Add Lead
        </button>
      </div>

      {showAddModal && (
        <AddLeadModal
          onClose={() => setShowAddModal(false)}
          onCreated={handleLeadCreated}
        />
      )}

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
                {['Name', 'DNI', 'Source', 'Status', 'Last Contact', 'Value', 'Actions'].map(h => (
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
                      {lead.dni
                        ? <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">{lead.dni}</span>
                        : <span className="text-xs text-gray-600">—</span>}
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
