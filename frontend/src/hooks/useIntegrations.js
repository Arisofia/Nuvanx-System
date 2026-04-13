import { useState, useEffect, useCallback } from 'react';
import api from '../config/api';

const MOCK_INTEGRATIONS = [
  { service: 'meta', name: 'Meta Business', description: 'Marketing API + Webhooks for lead capture', icon: '📘', status: 'disconnected', lastSync: null, error: null },
  { service: 'google-calendar', name: 'Google Calendar', description: 'Sync appointments and scheduling', icon: '📅', status: 'disconnected', lastSync: null, error: null },
  { service: 'google-gmail', name: 'Gmail', description: 'Email campaigns and automated follow-ups', icon: '✉️', status: 'disconnected', lastSync: null, error: null },
  { service: 'whatsapp', name: 'WhatsApp Business', description: 'Automated messaging and lead nurturing', icon: '💬', status: 'disconnected', lastSync: null, error: null },
  { service: 'github', name: 'GitHub', description: 'Repository access for deployment triggers', icon: '🐙', status: 'disconnected', lastSync: null, error: null },
  { service: 'openai', name: 'OpenAI', description: 'GPT-4 content generation and analysis', icon: '🤖', status: 'disconnected', lastSync: null, error: null },
  { service: 'gemini', name: 'Google Gemini', description: 'Gemini AI content generation and campaign insights', icon: '✨', status: 'disconnected', lastSync: null, error: null },
  { service: 'hubspot', name: 'HubSpot CRM', description: 'CRM contacts, deals and pipeline management', icon: '🟠', status: 'disconnected', lastSync: null, error: null },
];

export function useIntegrations() {
  const [integrations, setIntegrations] = useState(MOCK_INTEGRATIONS);
  const [loading, setLoading] = useState(false);

  const mergeServerData = useCallback((serverData) => {
    setIntegrations(prev =>
      prev.map(item => {
        const match = serverData.find(s => s.service === item.service);
        if (!match) return item;
        // Normalise backend field names: lastError → error, keep lastSync consistent
        const { lastError, lastSync, ...rest } = match;
        return {
          ...item,
          ...rest,
          ...(lastSync !== undefined && { lastSync }),
          error: lastError !== undefined ? lastError : (rest.error ?? item.error),
        };
      })
    );
  }, []);

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/integrations');
      mergeServerData(res.data?.integrations || []);
    } catch {
      // Backend not available — use mock data
    } finally {
      setLoading(false);
    }
  }, [mergeServerData]);

  /** Validate all services that have credentials (vault or env-var) in one request. */
  const validateAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/integrations/validate-all');
      const validated = res.data?.validated || [];
      setIntegrations(prev =>
        prev.map(item => {
          const match = validated.find(v => v.service === item.service);
          if (!match || match.skipped) return item;
          return {
            ...item,
            status: match.status,
            lastSync: match.status === 'connected' ? new Date().toISOString() : item.lastSync,
            error: match.error || null,
            metadata: {
              accountName: match.accountName,
              login: match.login,
              email: match.email,
              portalId: match.portalId,
            },
          };
        })
      );
      return res.data;
    } catch {
      // Fall back to individual fetch if validate-all fails
      await fetchIntegrations();
    } finally {
      setLoading(false);
    }
  }, [fetchIntegrations]);

  useEffect(() => {
    validateAll();
  }, [validateAll]);

  const updateIntegration = useCallback((service, updates) => {
    setIntegrations(prev =>
      prev.map(item => item.service === service ? { ...item, ...updates } : item)
    );
  }, []);

  const connectIntegration = useCallback(async (service, credentials) => {
    // The backend expects { token } for the API key plus an optional metadata object.
    // Extra fields (e.g. phoneNumberId for WhatsApp) are forwarded as metadata so the
    // backend can persist them alongside the integration record.
    const { apiKey, ...extraFields } = credentials;
    const body = {
      token: apiKey,
      ...(Object.keys(extraFields).length > 0 && { metadata: extraFields }),
    };
    await api.post(`/api/integrations/${service}/connect`, body);
    updateIntegration(service, {
      status: 'connected',
      lastSync: new Date().toISOString(),
      error: null,
      metadata: extraFields,
    });
  }, [updateIntegration]);

  const testIntegration = useCallback(async (service) => {
    updateIntegration(service, { status: 'testing' });
    try {
      // WhatsApp test requires phoneNumberId which is stored in the integration metadata
      const current = integrations.find(i => i.service === service);
      const body = service === 'whatsapp' && current?.metadata?.phoneNumberId
        ? { phoneNumberId: current.metadata.phoneNumberId }
        : {};

      const res = await api.post(`/api/integrations/${service}/test`, body);
      updateIntegration(service, {
        status: 'connected',
        lastSync: new Date().toISOString(),
        error: null,
        metadata: res.data?.metadata,
      });
      return res.data;
    } catch (err) {
      const msg = err.response?.data?.message || 'Connection test failed';
      updateIntegration(service, { status: 'error', error: msg });
      throw err;
    }
  }, [integrations, updateIntegration]);

  return { integrations, loading, fetchIntegrations, validateAll, connectIntegration, testIntegration, updateIntegration };
}
