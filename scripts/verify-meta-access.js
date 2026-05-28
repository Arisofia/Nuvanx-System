#!/usr/bin/env node
'use strict';

// Cargar variables de entorno desde .env.local si existe
try {
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: '.env.local' });
} catch {
  // Si dotenv no está instalado o el archivo no existe, seguimos sin romper
}

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';
const MIN_NODE_MAJOR = 18;

function normalizeAdAccountId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.startsWith('act_') ? value : `act_${value}`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.error) {
    const code = body?.error?.code ? ` code=${body.error.code}` : '';
    const subcode = body?.error?.error_subcode ? ` subcode=${body.error.error_subcode}` : '';
    const message = body?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Meta API request failed:${code}${subcode} ${message}`.trim());
  }

  return body;
}

async function listAccessibleAdAccounts(accessToken) {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts`);
  url.searchParams.set('fields', 'id,name,account_status,currency');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);

  const payload = await fetchJson(url);
  return Array.isArray(payload.data) ? payload.data : [];
}

async function main() {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isInteger(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
    throw new Error(`Node.js ${MIN_NODE_MAJOR}+ is required (current: ${process.versions.node}).`);
  }

  const accessToken = String(process.env.META_ACCESS_TOKEN || '').trim();
  const targetAdAccountId = normalizeAdAccountId(process.env.META_AD_ACCOUNT_ID || '');

  if (!accessToken || !targetAdAccountId) {
    throw new Error('META_ACCESS_TOKEN and META_AD_ACCOUNT_ID are required.');
  }

  const accounts = await listAccessibleAdAccounts(accessToken);
  const normalized = accounts
    .map((row) => ({
      id: normalizeAdAccountId(row.id),
      name: String(row.name || '').trim(),
      status: row.account_status,
      currency: String(row.currency || '').trim(),
    }))
    .filter((row) => row.id);

  const hasAccess = normalized.some((account) => account.id === targetAdAccountId);

  console.log(`Accessible ad accounts: ${normalized.length}`);
  // Mostrar todas las cuentas a las que el token tiene acceso
  normalized.forEach((account) => {
    console.log(
      `- ${account.id} | ${account.name} | status=${account.status} | currency=${account.currency}`
    );
  });

  if (hasAccess) {
    console.log('✅ Meta token has access to the configured ad account.');
    return;
  }

  throw new Error(
    normalized.length
      ? 'Token cannot access the configured ad account.'
      : 'Token cannot access the configured ad account. No accessible accounts returned by API.'
  );
}

main().catch((err) => {
  console.error('❌ Meta access verification failed.');
  console.error('Reason:', err?.message || err);
  process.exit(1);
});
