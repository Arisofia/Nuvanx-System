#!/usr/bin/env node

import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('../config/meta/rsv26-canonical.json', import.meta.url), 'utf8'));
const token = String(process.env.META_CANONICAL_ACCESS_TOKEN || '').trim();
if (!token) {
  console.error('META_SYSTEM_USER_AUDIT=FAIL reason=no_canonical_token');
  process.exit(1);
}

const version = String(config.graph_version || 'v22.0');
const graphBase = `https://graph.facebook.com/${version}`;

async function get(path, params = {}) {
  const url = new URL(`${graphBase}/${String(path).replace(/^\//, '')}`);
  url.searchParams.set('access_token', token);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function errorSummary(body) {
  return body?.error
    ? { code: body.error.code ?? null, type: body.error.type ?? null, message: body.error.message ?? null }
    : null;
}

const identity = await get('me', { fields: 'id,name' });
if (!identity.response.ok || !identity.body?.id) {
  console.log(`META_TOKEN_IDENTITY=${JSON.stringify({ status: identity.response.status, ok: false, error: errorSummary(identity.body) })}`);
  console.error('META_SYSTEM_USER_AUDIT=FAIL reason=identity_unreadable');
  process.exit(1);
}

const systemUsers = await get(`${config.business_id}/system_users`, { fields: 'id,name,role', limit: 100 });
const rows = Array.isArray(systemUsers.body?.data) ? systemUsers.body.data : [];
const safeRows = rows.map((row) => ({
  id: String(row?.id ?? ''),
  name: row?.name ?? null,
  role: row?.role ?? null,
}));
const tokenUserId = String(identity.body.id);
const preferredId = String(config.preferred_system_user_id || '');
const tokenUser = safeRows.find((row) => row.id === tokenUserId) ?? null;
const preferredUser = safeRows.find((row) => row.id === preferredId) ?? null;
const preferredIdMatch = Boolean(preferredId) && tokenUserId === preferredId;

console.log(`META_TOKEN_IDENTITY=${JSON.stringify({ status: identity.response.status, ok: true, id: tokenUserId, name: identity.body?.name ?? null })}`);
console.log(`META_BUSINESS_SYSTEM_USERS=${JSON.stringify({ status: systemUsers.response.status, ok: systemUsers.response.ok, rows: safeRows, error: errorSummary(systemUsers.body) })}`);
console.log(`META_SYSTEM_USER_RESOLUTION=${JSON.stringify({ token_user_in_business: Boolean(tokenUser), preferred_user_in_business: Boolean(preferredUser), preferred_id_match: preferredIdMatch, token_user: tokenUser, preferred_user: preferredUser })}`);

if (!systemUsers.response.ok || !tokenUser) {
  console.error('META_SYSTEM_USER_AUDIT=FAIL reason=token_system_user_not_owned_by_business');
  process.exit(1);
}
if (!preferredUser || !preferredIdMatch) {
  console.error(`META_SYSTEM_USER_AUDIT=FAIL reason=canonical_system_user_mismatch token_user=${tokenUserId} preferred_user=${preferredId || 'unset'}`);
  process.exit(1);
}

console.log('META_SYSTEM_USER_AUDIT=PASS read_only=true preferred_id_match=true');
