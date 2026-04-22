import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2, RefreshCw, Link, Unlink } from 'lucide-react';
import toast from 'react-hot-toast';
import { normalizePhoneNumberId } from '../utils/phoneNumber';

function formatSync(ts) {
  if (!ts) return 'Never';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  return `${Math.floor(hrs / 24)} day(s) ago`;
}

function normalizeMetaAccountId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const unprefixed = value.replace(/^act_/i, '');
  const digits = unprefixed.replace(/\D/g, '');
  return digits ? `act_${digits}` : '';
}

function normalizePhoneNumberId(raw) {
  const value = String(raw || '').trim();
  if (!value || /^act_/i.test(value) || /[a-z]/i.test(value)) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 20) return '';
  return digits;
}

function StatusBadge({ status }) {
  const map = {
    connected: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Connected' },
    disconnected: { dot: 'bg-gray-500', text: 'text-gray-400', label: 'Disconnected' },
    error: { dot: 'bg-red-400 animate-pulse', text: 'text-red-400', label: 'Error' },
    testing: { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-400', label: 'Testing…' },
  };
  const s = map[status] || map.disconnected;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`w-2 h-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function ConnectModal({ integration, onClose, onConnect }) {
  const [apiKey, setApiKey] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [adAccountId, setAdAccountId] = useState('');
  const [pageId, setPageId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isWhatsApp = integration.service === 'whatsapp';
  const isMeta = integration.service === 'meta';
  const normalizedMetaPreview = isMeta ? normalizeMetaAccountId(adAccountId) : '';
  const normalizedPhonePreview = isWhatsApp ? normalizePhoneNumberId(phoneNumberId) : '';

  useEffect(() => {
    if (isMeta) {
      setAdAccountId(integration.metadata?.adAccountId || integration.metadata?.ad_account_id || '');
      setPageId(integration.metadata?.pageId || integration.metadata?.page_id || '');
    }
    if (isWhatsApp) {
      setPhoneNumberId(integration.metadata?.phoneNumberId || integration.metadata?.phone_number_id || '');
    }
  }, [integration.metadata, isMeta, isWhatsApp]);

  const fieldLabels = {
    meta: 'ACCESS TOKEN',
    whatsapp: 'WhatsApp Business API Token',
    github: 'GitHub Personal Access Token',
    openai: 'API KEY',
    gemini: 'API KEY',
  };

  const fieldHints = {
    meta: 'Found in Meta Business Manager → System Users → Generate Token',
    whatsapp: 'Found in Meta Business Manager → WhatsApp → API Setup',
    github: 'Generate at github.com/settings/tokens with repo scope',
    openai: 'Found at platform.openai.com/api-keys',
    gemini: 'Found at ai.google.dev → Get API Key',
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    if (isWhatsApp && !normalizedPhonePreview) {
      toast.error('Use a valid numeric WhatsApp Phone Number ID (not an ad account id like act_...)');
      return;
    }
    const normalizedMetaAccountId = normalizedMetaPreview;
    if (isMeta && !normalizedMetaAccountId) return;

    setSubmitting(true);
    try {
      const credentials = { apiKey };
      if (isWhatsApp) credentials.phoneNumberId = normalizedPhonePreview;
      if (isMeta) {
        credentials.adAccountId = normalizedMetaAccountId;
        if (pageId.trim()) credentials.pageId = pageId.trim();
      }

      await onConnect(integration.service, credentials);
      toast.success(`${integration.name} connected successfully`);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to connect integration');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-dark-700 border border-dark-600 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl">{integration.icon}</span>
          <div>
            <h3 className="text-lg font-bold text-white">Connect {integration.name}</h3>
            <p className="text-sm text-gray-400">{integration.description}</p>
          </div>
        </div>

        <div className="mb-5 p-3 rounded-lg bg-brand-500/10 border border-brand-500/20 flex gap-2">
          <span className="text-brand-400 mt-0.5 shrink-0">🔒</span>
          <p className="text-xs text-brand-300 leading-relaxed">
            Your credentials are encrypted with <strong>AES-256</strong> and stored securely on the server.
            They are <strong>never returned to the client</strong> after being saved.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              {fieldLabels[integration.service] || 'API Key / Token'}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your key here…"
              className="input"
              autoComplete="off"
              required
            />
            {fieldHints[integration.service] && (
              <p className="mt-1.5 text-xs text-gray-500">{fieldHints[integration.service]}</p>
            )}
          </div>

          {isMeta && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5 uppercase">
                  Ad Account ID
                </label>
                <input
                  type="text"
                  value={adAccountId}
                  onChange={(e) => setAdAccountId(e.target.value)}
                  placeholder="e.g. act_123456789 or 123456789"
                  className="input"
                  autoComplete="off"
                  required
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  Accepted formats: <strong>act_123456789</strong> or <strong>123456789</strong>. We automatically normalize and save as{' '}
                  <strong>{normalizedMetaPreview || 'act_<digits>'}</strong>.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5 uppercase">
                  Facebook Page ID <span className="normal-case text-gray-500 font-normal">(required for Lead Ads webhook)</span>
                </label>
                <input
                  type="text"
                  value={pageId}
                  onChange={(e) => setPageId(e.target.value)}
                  placeholder="e.g. 123456789012345"
                  className="input"
                  autoComplete="off"
                  required
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  Found in Meta Business Manager → Pages → select your page → About → Page ID
                </p>
              </div>
            </>
          )}

          {isWhatsApp && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Phone Number ID
              </label>
              <input
                type="text"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                placeholder="e.g. 123456789012345"
                className="input"
                autoComplete="off"
                required
              />
              <p className="mt-1.5 text-xs text-gray-500">
                Use the numeric Phone Number ID from Meta. We normalize and save as{' '}
                <strong>{normalizedPhonePreview || '<digits>'}</strong>.
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !apiKey.trim() || (isWhatsApp && !normalizedPhonePreview) || (isMeta && !normalizedMetaPreview)}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {submitting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function IntegrationCard({ service, name, description, icon, status, lastSync, error, metadata, onConnect, onTest }) {
  const [showModal, setShowModal] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const accountLabel = metadata?.accountName || metadata?.login || metadata?.email
    ? (metadata.accountName || metadata.login || metadata.email)
    : null;
  const metaAdAccountId = metadata?.adAccountId || metadata?.ad_account_id || null;
  const metaPageId = metadata?.pageId || metadata?.page_id || null;

  const handleTest = async () => {
    setTestResult(null);
    try {
      await onTest(service);
      setTestResult({ ok: true, message: 'Connection successful ✓' });
      toast.success(`${name} test passed`);
    } catch (err) {
      setTestResult({ ok: false, message: err.response?.data?.message || 'Test failed' });
    }
  };

  const isConnected = status === 'connected';
  const isTesting = status === 'testing';

  return (
    <>
      <div className="card flex flex-col gap-4 hover:border-dark-500 transition-colors duration-200">
        <div className="flex items-start gap-4">
          <div className="text-3xl shrink-0 mt-0.5">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <h3 className="font-semibold text-white">{name}</h3>
              <StatusBadge status={status} />
            </div>
            <p className="text-sm text-gray-400 mt-0.5 leading-relaxed">{description}</p>
          </div>
        </div>

        {error && status === 'error' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <XCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        {testResult && (
          <div className={`flex items-center gap-2 p-3 rounded-lg ${testResult.ok ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
            {testResult.ok
              ? <CheckCircle size={14} className="text-emerald-400 shrink-0" />
              : <XCircle size={14} className="text-red-400 shrink-0" />}
            <p className={`text-xs font-medium ${testResult.ok ? 'text-emerald-300' : 'text-red-300'}`}>
              {testResult.message}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-gray-500 border-t border-dark-600 pt-3">
          <span>
            Last sync: <span className="text-gray-400">{formatSync(lastSync)}</span>
            {service === 'meta' && (metaAdAccountId || metaPageId) && (
              <span className="block text-[11px] text-gray-500 mt-1">
                {metaAdAccountId ? `Ad Account: ${metaAdAccountId}` : ''}{metaAdAccountId && metaPageId ? ' · ' : ''}{metaPageId ? `Page: ${metaPageId}` : ''}
              </span>
            )}
          </span>
          {accountLabel && (
            <span className="text-gray-500 truncate max-w-[130px]" title={accountLabel}>
              {accountLabel}
            </span>
          )}
        </div>

        <div className="flex gap-2">
          {isConnected ? (
            <>
              <button
                onClick={handleTest}
                disabled={isTesting}
                className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm py-2"
              >
                {isTesting
                  ? <Loader2 size={14} className="animate-spin" />
                  : <RefreshCw size={14} />}
                {isTesting ? 'Testing…' : 'Test Connection'}
              </button>
              <button
                onClick={() => setShowModal(true)}
                className="btn-ghost flex items-center justify-center gap-2 text-sm py-2 px-3"
                title="Reconnect"
              >
                <Unlink size={14} />
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm py-2"
            >
              <Link size={14} />
              Connect
            </button>
          )}
        </div>
      </div>

      {showModal && (
        <ConnectModal
          integration={{ service, name, description, icon, metadata }}
          onClose={() => setShowModal(false)}
          onConnect={onConnect}
        />
      )}
    </>
  );
}
