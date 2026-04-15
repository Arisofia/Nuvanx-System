import { useState, useEffect, useCallback } from 'react';
import api from '../config/api';
import {
  fetchIntegrationStatus,
  saveIntegrationStatus,
  subscribeIntegrationStatus,
} from '../lib/supabase/integrations';
import { isSupabaseAvailable, supabase } from '../lib/supabase/client';

// Initial empty integrations structure - will be populated from backend
const EMPTY_INTEGRATIONS = [
  { service: 'meta', name: 'Meta Business', description: 'Marketing API + Webhooks for lead capture', icon: '📘' },
  { service: 'google-calendar', name: 'Google Calendar', description: 'Sync appointments and scheduling', icon: '📅' },
  { service: 'google-gmail', name: 'Gmail', description: 'Email campaigns and automated follow-ups', icon: '✉️' },
  { service: 'whatsapp', name: 'WhatsApp Business', description: 'Automated messaging and lead nurturing', icon: '💬' },
  { service: 'github', name: 'GitHub', description: 'Repository access for deployment triggers', icon: '🐙' },
  { service: 'openai', name: 'OpenAI', description: 'GPT-4 content generation and analysis', icon: '🤖' },
  { service: 'gemini', name: 'Google Gemini', description: 'Gemini AI content generation and campaign insights', icon: '✨' },
  { service: 'hubspot', name: 'HubSpot CRM', description: 'CRM contacts, deals and pipeline management', icon: '🟠' },
].map(item => ({ ...item, status: 'disconnected', lastSync: null, error: null }));

export function useIntegrations() {
  const [integrations, setIntegrations] = useState(EMPTY_INTEGRATIONS);
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
          error: lastError ?? rest.error ?? item.error,
        };
      })
    );
  }, []);

  // Seed local state from Supabase whenever the user's session is available
  useEffect(() => {
    if (!isSupabaseAvailable()) return;

    let unsubscribe = () => {};

    async function loadFromSupabase() {
      const rows = await fetchIntegrationStatus();
      if (rows.length > 0) mergeServerData(rows);

      // Also subscribe to real-time updates
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (!userErr && user) {
        unsubscribe = subscribeIntegrationStatus(user.id, (row) => {
          mergeServerData([row]);
        });
      }
    }

    loadFromSupabase();
    return () => unsubscribe();
  }, [mergeServerData]);

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/integrations');
      mergeServerData(res.data?.integrations || []);
    } catch (err) {
      console.error('Failed to fetch integrations:', err);
      // Keep EMPTY_INTEGRATIONS structure, don't fallback to mock data
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
    } catch (err) {
      console.error('Failed to validate integrations:', err);
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
    const statusUpdate = {
      status: 'connected',
      lastSync: new Date().toISOString(),
      error: null,
      metadata: extraFields,
    };
    updateIntegration(service, statusUpdate);
    // Persist connection status to Supabase (fire-and-forget)
    saveIntegrationStatus(service, statusUpdate);
  }, [updateIntegration]);

  const testIntegration = useCallback(async (service) => {
    updateIntegration(service, { status: 'testing' });
    try {
      // WhatsApp test requires phoneNumberId which is stored in the integration metadata
      const current = integrations.find(i => i.service === service);
      const body = {};
      if (service === 'whatsapp' && current?.metadata?.phoneNumberId) {
        body.phoneNumberId = current.metadata.phoneNumberId;
      }
      if (service === 'meta' && current?.metadata?.adAccountId) {
        body.adAccountId = current.metadata.adAccountId;
      }

      const res = await api.post(`/api/integrations/${service}/test`, body);
      const statusUpdate = {
        status: 'connected',
        lastSync: new Date().toISOString(),
        error: null,
        metadata: res.data?.metadata,
      };
      updateIntegration(service, statusUpdate);
      saveIntegrationStatus(service, statusUpdate);
      return res.data;
    } catch (err) {
      const msg = err.response?.data?.message || 'Connection test failed';
      updateIntegration(service, { status: 'error', error: msg });
      throw err;
    }
  }, [integrations, updateIntegration]);

  return { integrations, loading, fetchIntegrations, validateAll, connectIntegration, testIntegration, updateIntegration };
}
