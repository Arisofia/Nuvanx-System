import { useState } from 'react';
import { Shield, RefreshCw, Loader2, DatabaseZap } from 'lucide-react';
import toast from 'react-hot-toast';
import IntegrationCard from '../components/IntegrationCard';
import { useIntegrations } from '../hooks/useIntegrations';

export default function Integrations() {
  const { integrations, loading, connectIntegration, testIntegration, validateAll, triggerMetaBackfill } = useIntegrations();
  const [backfilling, setBackfilling] = useState(false);

  const handleConnect = async (service, credentials) => {
    await connectIntegration(service, credentials);
  };

  const handleTest = async (service) => {
    await testIntegration(service);
  };

  const handleSync = async () => {
    try {
      const res = await validateAll();
      const connected = res?.validated?.filter(v => v.status === 'connected').length ?? 0;
      toast.success(`Vault synced — ${connected} service${connected !== 1 ? 's' : ''} connected`);
    } catch {
      toast.error('Error syncing vault');
    }
  };

  const handleMetaBackfill = async () => {
    setBackfilling(true);
    try {
      const res = await triggerMetaBackfill(2);
      toast.success(res?.message ?? 'Meta sync completed');
    } catch (err) {
      toast.error(err?.response?.data?.message ?? 'Meta sync failed');
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white uppercase tracking-tight">Integration Center</h2>
          <p className="text-gray-400 mt-0.5">Secure connection to the Nuvanx data ecosystem. Credentials are encrypted and persisted in Supabase Cloud.</p>
        </div>
        <button
          className="btn-primary flex items-center gap-2 text-sm px-5"
          onClick={handleSync}
          disabled={loading}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Sync Vault
        </button>
      </div>

      {/* Security Protocol */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-start gap-4 p-4 rounded-xl bg-brand-500/5 border border-brand-500/20">
          <div className="p-2.5 rounded-lg bg-brand-500/10 shrink-0">
            <Shield size={20} className="text-brand-400" />
          </div>
          <div>
            <p className="font-bold text-brand-400 text-xs uppercase tracking-widest mb-1">Security Protocol</p>
            <p className="text-sm text-gray-300 font-medium uppercase">Cloud Sync</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Your keys are secure. Once saved, they sync with Supabase so you can access them from any Nuvanx device.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-4 p-4 rounded-xl bg-dark-800 border border-dark-600">
          <div className="grid grid-cols-2 gap-y-3 flex-1">
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">End-to-End Encryption</p>
              <p className="text-xs text-emerald-400 font-bold">AES-256-GCM</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">Supabase Vault Auth</p>
              <p className="text-xs text-brand-400 font-bold">Active</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">No Local Plain-Text</p>
              <p className="text-xs text-emerald-400 font-bold">Verified</p>
            </div>
          </div>
        </div>
      </div>

      {/* Integration Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Integrations', value: integrations.length },
          { label: 'Connected', value: integrations.filter(i => i.status === 'connected').length },
          { label: 'Errors', value: integrations.filter(i => i.status === 'error').length },
        ].map(s => (
          <div key={s.label} className="card py-4 text-center">
            <p className="text-2xl font-bold text-white">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Integration Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {integrations.map((integration) => (
          <IntegrationCard
            key={integration.service}
            {...integration}
            onConnect={handleConnect}
            onTest={handleTest}
          />
        ))}
      </div>

      {/* Meta Recovery Panel — visible only when Meta is connected */}
      {integrations.find(i => i.service === 'meta')?.status === 'connected' && (
        <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-start gap-4">
          <div className="p-2.5 rounded-lg bg-amber-500/10 shrink-0">
            <DatabaseZap size={20} className="text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-amber-300 text-sm mb-0.5">Meta Data Recovery</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              If the webhook was down or you see missing leads in the dashboard, use this to backfill the last 48 hours of Meta ad data and warm the cache.
            </p>
          </div>
          <button
            onClick={handleMetaBackfill}
            disabled={backfilling}
            className="btn-secondary text-xs flex items-center gap-1.5 shrink-0"
          >
            {backfilling ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {backfilling ? 'Syncing…' : 'Force Sync Meta (48h)'}
          </button>
        </div>
      )}

      {/* Footer note */}
      <div className="text-center py-8">
        <p className="text-xs text-gray-500 uppercase font-bold tracking-widest mb-2">Need Help?</p>
        <p className="text-sm text-gray-400">
          Check the integrations guide for step-by-step token setup.{' '}
          <a href="#" className="text-brand-400 hover:text-brand-300 font-bold ml-1">VIEW DOCUMENTATION →</a>
        </p>
      </div>
    </div>
  );
}
