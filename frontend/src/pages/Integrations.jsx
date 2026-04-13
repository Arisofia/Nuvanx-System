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
      <div>
        <h2 className="text-2xl font-bold text-white">Integration Management</h2>
        <p className="text-gray-400 mt-0.5">Connect your tools to power the Revenue Intelligence Platform</p>
      </div>

      {/* Security Banner */}
      <div className="flex items-start gap-4 p-4 rounded-xl bg-brand-500/8 border border-brand-500/25 bg-gradient-to-r from-brand-500/10 to-transparent">
        <div className="p-2.5 rounded-lg bg-brand-500/20 shrink-0">
          <Shield size={20} className="text-brand-400" />
        </div>
        <div>
          <p className="font-medium text-brand-300 text-sm">Security Notice</p>
          <p className="text-sm text-gray-400 mt-0.5 leading-relaxed">
            🔒 All API credentials are encrypted with <strong className="text-gray-300">AES-256</strong> and stored securely on the backend.
            Keys are <strong className="text-gray-300">never transmitted to or stored in the browser</strong> after submission.
            Connections are validated server-side only.
          </p>
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
      <div className="text-center py-4">
        <p className="text-xs text-gray-600">
          Need help setting up an integration?{' '}
          <a href="#" className="text-brand-400 hover:text-brand-300">View documentation →</a>
        </p>
      </div>
    </div>
  );
}
