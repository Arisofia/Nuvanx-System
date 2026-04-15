import { Shield } from 'lucide-react';
import IntegrationCard from '../components/IntegrationCard';
import { useIntegrations } from '../hooks/useIntegrations';

export default function Integrations() {
  const { integrations, connectIntegration, testIntegration } = useIntegrations();

  async function handleConnect(service, credentials) {
    await connectIntegration(service, credentials);
  }

  async function handleTest(service) {
    await testIntegration(service);
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white uppercase tracking-tight">Centro de Integraciones</h2>
          <p className="text-gray-400 mt-0.5">Conexión segura con el ecosistema de datos de Nuvanx. Las credenciales se cifran y persisten en Supabase Cloud.</p>
        </div>
        <button className="btn-primary flex items-center gap-2 text-sm px-5">
          <RefreshCw size={16} />
          Sincronizar Vault
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
              Tus claves están seguras. Al guardarlas, se sincronizan con Supabase para permitir el acceso desde cualquier dispositivo Nuvanx.
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

      {/* Footer note */}
      <div className="text-center py-8">
        <p className="text-xs text-gray-500 uppercase font-bold tracking-widest mb-2">Need Help?</p>
        <p className="text-sm text-gray-400">
          Revisa la guía de integraciones para obtener los tokens paso a paso.{' '}
          <a href="#" className="text-brand-400 hover:text-brand-300 font-bold ml-1">VIEW DOCUMENTATION →</a>
        </p>
      </div>
    </div>
  );
}
