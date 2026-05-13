#!/usr/bin/env node
/**
 * set-meta-credentials.js
 *
 * Encrypts a new Meta access token with the current ENCRYPTION_KEY and updates
 * the credentials table for the configured REPORT_USER_ID.
 *
 * Required env vars:
 *   DATABASE_URL
 *   ENCRYPTION_KEY
 *   META_ACCESS_TOKEN_NEW
 *   REPORT_USER_ID
 *
 * Usage:
 *   DATABASE_URL=... ENCRYPTION_KEY=... REPORT_USER_ID=... META_ACCESS_TOKEN_NEW=... node scripts/set-meta-credentials.js
 */

const { Client } = require('pg');
const { webcrypto } = require('node:crypto');

const { DATABASE_URL, ENCRYPTION_KEY, META_ACCESS_TOKEN_NEW, REPORT_USER_ID } = process.env;

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function encryptCred(raw, masterKey) {
  if (!masterKey) throw new Error('ENCRYPTION_KEY is required');
  const encoder = new TextEncoder();
  const salt = new Uint8Array(32);
  webcrypto.getRandomValues(salt);
  const iv = new Uint8Array(12);
  webcrypto.getRandomValues(iv);
  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(masterKey),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const aesKey = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ciphertextWithTag = new Uint8Array(
    await webcrypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      encoder.encode(raw),
    ),
  );
  const tagLen = 16;
  if (ciphertextWithTag.length < tagLen) throw new Error('failed to encrypt credential');
  const ct = ciphertextWithTag.slice(0, ciphertextWithTag.length - tagLen);
  const tag = ciphertextWithTag.slice(ciphertextWithTag.length - tagLen);
  return [bytesToHex(salt), bytesToHex(iv), bytesToHex(tag), bytesToHex(ct)].join(':');
}

async function main() {
  if (!DATABASE_URL || !ENCRYPTION_KEY || !META_ACCESS_TOKEN_NEW || !REPORT_USER_ID) {
    console.error('Missing required environment variables.');
    console.error('Required: DATABASE_URL, ENCRYPTION_KEY, META_ACCESS_TOKEN_NEW, REPORT_USER_ID');
    process.exit(1);
  }

  const encrypted = await encryptCred(META_ACCESS_TOKEN_NEW, ENCRYPTION_KEY);
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const updateRes = await client.query(
    `UPDATE credentials SET encrypted_key = $1 WHERE service = 'meta' AND user_id = $2`,
    [encrypted, REPORT_USER_ID],
  );

  console.log(`Updated credentials for meta service. Rows affected: ${updateRes.rowCount}`);
  await client.end();
}

main().catch((err) => {
  console.error('Failed to update credentials:', err);
  process.exit(1);
});
