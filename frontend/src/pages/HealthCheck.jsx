import { useEffect, useState } from 'react';
import api from '../config/api.js';
import { apiConfig } from '../config/api.js';

function StatusBadge({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-700/60 bg-slate-950/60 p-4">
      <p className="text-sm text-gray-400">{label}</p>
      <p className="mt-2 font-semibold text-white break-all">{value}</p>
    </div>
  );
}

export default function HealthCheck() {
  const [health, setHealth] = useState(null);
  const [secrets, setSecrets] = useState(null);
  const [error, setError] = useState('');
  const [secretsError, setSecretsError] = useState('');
  const missingSupabaseEnv = !apiConfig.supabaseUrl || !apiConfig.supabaseKey;

  useEffect(() => {
    let mounted = true;
    api
      .get('/api/health')
      .then((res) => {
        if (mounted) {
          setHealth(res.data);
          setError('');
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.response?.data?.message || err.message || 'Network error fetching /api/health');
        }
      });

    api
      .get('/api/health/secrets')
      .then((res) => {
        if (mounted) {
          setSecrets(res.data?.secrets ?? null);
          setSecretsError('');
        }
      })
      .catch((err) => {
        if (mounted) {
          setSecretsError(err.response?.data?.message || err.message || 'Network error fetching /api/health/secrets');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="p-6 min-h-screen bg-dark-900 text-white">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Frontend & API runtime diagnostics</h1>
          <p className="mt-2 text-gray-400">Verify Vercel build-time env vars, frontend config, and the `/api/health` proxy endpoint.</p>
          {missingSupabaseEnv ? (
            <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
              <p className="font-semibold text-white">Vercel environment variables are missing.</p>
              <p className="mt-1 text-gray-300">
                Without `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, the frontend cannot connect to Supabase and auth will fail. Set these values in Vercel and redeploy.
              </p>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatusBadge label="VITE_SUPABASE_URL" value={apiConfig.supabaseUrl || 'missing'} />
          <StatusBadge label="VITE_SUPABASE_PUBLISHABLE_KEY" value={apiConfig.supabaseKey ? 'set' : 'missing'} />
          <StatusBadge label="Explicit API URL" value={apiConfig.explicitApiUrl || 'unset'} />
          <StatusBadge label="Computed API Base URL" value={apiConfig.apiBaseUrl || 'missing'} />
          <StatusBadge label="Current window origin" value={typeof window !== 'undefined' ? window.location.origin : 'server'} />
          <StatusBadge label="Build mode" value={import.meta.env.MODE} />
        </div>

        <div className="rounded-2xl border border-gray-700/80 bg-slate-950/70 p-6">
          <h2 className="text-xl font-semibold">Proxy & health check</h2>
          <p className="mt-2 text-gray-400">This page attempts a real call to <code className="bg-slate-900 px-1 py-0.5 rounded">/api/health</code> using the same origin as the frontend.</p>
          <div className="mt-4 space-y-3">
            {health ? (
              <div>
                <p className="text-sm text-gray-400">Endpoint status</p>
                <pre className="mt-2 rounded-xl bg-slate-900 p-4 text-sm text-white overflow-x-auto">{JSON.stringify(health, null, 2)}</pre>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-700/80 bg-slate-950/60 p-4">
                <p className="text-sm text-gray-400">Health check result is pending.</p>
                {error ? <p className="mt-2 text-red-300">{error}</p> : null}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-700/80 bg-slate-950/70 p-6">
          <h2 className="text-xl font-semibold">Secret diagnostic check</h2>
          <p className="mt-2 text-gray-400">This endpoint verifies whether the Edge Function sees the required secrets.</p>
          <div className="mt-4 space-y-3">
            {secrets ? (
              <div>
                <p className="text-sm text-gray-400">Secret presence</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-3">
                  {Object.entries(secrets).map(([name, present]) => (
                    <div key={name} className="rounded-xl border border-gray-700/60 bg-slate-900/80 p-4">
                      <p className="text-xs uppercase text-gray-500">{name}</p>
                      <p className={`mt-2 text-sm font-semibold ${present ? 'text-emerald-300' : 'text-red-300'}`}>
                        {present ? 'present' : 'missing'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-700/80 bg-slate-950/60 p-4">
                <p className="text-sm text-gray-400">Secret diagnostics are pending.</p>
                {secretsError ? <p className="mt-2 text-red-300">{secretsError}</p> : null}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-700/80 bg-slate-950/70 p-6 text-sm text-gray-300">
          <p className="font-semibold text-white">How to use this page</p>
          <ul className="mt-3 space-y-2 list-disc list-inside">
            <li>Confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are present.</li>
            <li>Confirm the frontend can reach `/api/health` through the Vercel rewrite proxy.</li>
            <li>If the health check fails, the production frontend build or Vercel rewrite is likely misconfigured.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
