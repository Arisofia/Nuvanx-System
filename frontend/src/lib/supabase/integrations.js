/**
 * Supabase persistence layer for integration status.
 *
 * Stores integration connection state (status, lastSync, metadata) in the
 * `user_integrations` Supabase table. Actual API credentials are kept on the
 * backend — only the connection status is synced here.
 *
 * All calls are guarded: they silently return early when Supabase is not
 * configured so the app degrades gracefully in local-only environments.
 */

import { supabase, isSupabaseAvailable } from './client';

/**
 * Fetch integration rows for the current user from Supabase.
 * Returns an empty array if Supabase is not available.
 *
 * @returns {Promise<Array<{ service: string, status: string, lastSync: string|null, metadata: object }>>}
 */
export async function fetchIntegrationStatus() {
  if (!isSupabaseAvailable()) return [];

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('user_integrations')
    .select('service, status, last_sync, last_error, metadata')
    .eq('user_id', user.id);

  if (error) {
    console.error('[Supabase] fetchIntegrationStatus error:', error.message);
    return [];
  }

  return (data || []).map((row) => ({
    service: row.service,
    status: row.status,
    lastSync: row.last_sync,
    error: row.last_error || null,
    metadata: row.metadata || {},
  }));
}

/**
 * Upsert (insert or update) a single integration row for the current user.
 *
 * @param {string} service
 * @param {{ status?: string, lastSync?: string|null, error?: string|null, metadata?: object }} updates
 */
export async function saveIntegrationStatus(service, updates) {
  if (!isSupabaseAvailable()) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const row = {
    user_id: user.id,
    service,
    status: updates.status ?? 'disconnected',
    last_sync: updates.lastSync ?? null,
    last_error: updates.error ?? null,
    metadata: updates.metadata ?? {},
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('user_integrations')
    .upsert(row, { onConflict: 'user_id,service' });

  if (error) {
    console.error('[Supabase] saveIntegrationStatus error:', error.message);
  }
}

/**
 * Subscribe to real-time changes on the current user's integrations.
 * Calls `onUpdate` whenever a row is inserted or updated.
 *
 * @param {string} userId  Supabase user UUID
 * @param {(row: object) => void} onUpdate
 * @returns {() => void}  Unsubscribe function
 */
export function subscribeIntegrationStatus(userId, onUpdate) {
  if (!isSupabaseAvailable()) return () => {};

  const channel = supabase
    .channel(`integrations:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'user_integrations',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new;
        onUpdate({
          service: row.service,
          status: row.status,
          lastSync: row.last_sync,
          error: row.last_error || null,
          metadata: row.metadata || {},
        });
      },
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}
