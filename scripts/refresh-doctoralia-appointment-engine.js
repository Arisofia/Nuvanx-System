#!/usr/bin/env node
'use strict';

/**
 * Refresh canonical lead appointment state after Doctoralia ingestion.
 * Uses service-role credentials already present in Daily Sync.
 */

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_ROLE = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NUVANX_SUPABASE_SERVICE_ROLE_KEY || '');

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('DOCTORALIA_APPOINTMENT_ENGINE=FAIL reason=supabase_config_missing');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${SERVICE_ROLE}`,
  apikey: SERVICE_ROLE,
  'Content-Type': 'application/json',
};

async function request(path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  return payload;
}

async function main() {
  const users = await request('/rest/v1/users?select=id&order=created_at.asc');
  if (!Array.isArray(users) || users.length === 0) throw new Error('No public users available');

  let totalUpdated = 0;
  for (const user of users) {
    const userId = String(user?.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Invalid public user id');
    const updated = await request('/rest/v1/rpc/refresh_doctoralia_appointment_engine', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: userId }),
    });
    const count = Number(updated || 0);
    if (!Number.isFinite(count) || count < 0) throw new Error('Invalid appointment engine result');
    totalUpdated += count;
  }

  console.log(`DOCTORALIA_APPOINTMENT_ENGINE=PASS users=${users.length} leads_updated=${totalUpdated}`);
}

main().catch((error) => {
  console.error(`DOCTORALIA_APPOINTMENT_ENGINE=FAIL reason=${String(error?.message || error).slice(0, 160)}`);
  process.exit(1);
});
