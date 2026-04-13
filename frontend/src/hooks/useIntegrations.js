import { useState, useEffect, useCallback } from 'react';
import api from '../config/api';

const MOCK_INTEGRATIONS = [
  { service: 'meta', name: 'Meta Business', description: 'Marketing API + Webhooks for lead capture', icon: '📘', status: 'disconnected', lastSync: null, error: null },
  { service: 'google-calendar', name: 'Google Calendar', description: 'Sync appointments and scheduling', icon: '📅', status: 'disconnected', lastSync: null, error: null },
  { service: 'gmail', name: 'Gmail', description: 'Email campaigns and automated follow-ups', icon: '✉️', status: 'disconnected', lastSync: null, error: null },
  { service: 'whatsapp', name: 'WhatsApp Business', description: 'Automated messaging and lead nurturing', icon: '💬', status: 'disconnected', lastSync: null, error: null },
  { service: 'github', name: 'GitHub', description: 'Repository access for deployment triggers', icon: '🐙', status: 'disconnected', lastSync: null, error: null },
  { service: 'openai', name: 'OpenAI / Gemini AI', description: 'AI content generation and campaign analysis', icon: '🤖', status: 'disconnected', lastSync: null, error: null },
];

export function useIntegrations() {
  const [integrations, setIntegrations] = useState(MOCK_INTEGRATIONS);
  const [loading, setLoading] = useState(false);

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/integrations');
      const serverData = res.data?.integrations || [];
      setIntegrations(prev =>
        prev.map(item => {
          const match = serverData.find(s => s.service === item.service);
          return match ? { ...item, ...match } : item;
        })
      );
    } catch {
      // Backend not available yet - use mock data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  const updateIntegration = useCallback((service, updates) => {
    setIntegrations(prev =>
      prev.map(item => item.service === service ? { ...item, ...updates } : item)
    );
  }, []);

  const connectIntegration = useCallback(async (service, credentials) => {
    await api.post(`/api/integrations/${service}/connect`, credentials);
    updateIntegration(service, {
      status: 'connected',
      lastSync: new Date().toISOString(),
      error: null,
    });
  }, [updateIntegration]);

  const testIntegration = useCallback(async (service) => {
    updateIntegration(service, { status: 'testing' });
    try {
      const res = await api.post(`/api/integrations/${service}/test`);
      updateIntegration(service, {
        status: 'connected',
        lastSync: new Date().toISOString(),
        error: null,
      });
      return res.data;
    } catch (err) {
      const msg = err.response?.data?.message || 'Connection test failed';
      updateIntegration(service, { status: 'error', error: msg });
      throw err;
    }
  }, [updateIntegration]);

  return { integrations, loading, fetchIntegrations, connectIntegration, testIntegration, updateIntegration };
}
