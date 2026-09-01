'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeServiceAccount } = require('./sync-google-ads-service-account');

const account = {
  type: 'service_account',
  project_id: 'nuvanx-test',
  private_key_id: 'key-id',
  private_key: '-----BEGIN PRIVATE KEY-----\nTESTKEY\n-----END PRIVATE KEY-----\n',
  client_email: 'ads@nuvanx-test.iam.gserviceaccount.com',
  client_id: '123',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
};

function verify(raw) {
  const normalized = normalizeServiceAccount(raw);
  const parsed = JSON.parse(normalized);
  assert.equal(parsed.type, 'service_account');
  assert.equal(parsed.client_email, account.client_email);
  assert.equal(parsed.private_key, account.private_key.trim());
  assert.equal(parsed.token_uri, 'https://oauth2.googleapis.com/token');
  return normalized;
}

test('accepts canonical service-account JSON', () => {
  verify(JSON.stringify(account));
});

test('accepts quoted/double-encoded JSON', () => {
  verify(JSON.stringify(JSON.stringify(account)));
});

test('accepts padded, unpadded, prefixed and URL-safe base64 JSON', () => {
  const padded = Buffer.from(JSON.stringify(account), 'utf8').toString('base64');
  verify(padded);
  verify(padded.replace(/=+$/, ''));
  verify(`base64:${padded}`);
  verify(`b64:${padded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`);
});

test('rejects non-service-account and missing key material', () => {
  assert.throws(() => normalizeServiceAccount(JSON.stringify({ type: 'authorized_user' })), /type is invalid/);
  assert.throws(() => normalizeServiceAccount(JSON.stringify({ ...account, private_key: '' })), /private_key/);
});

test('rejects malformed service-account email', () => {
  assert.throws(() => normalizeServiceAccount(JSON.stringify({ ...account, client_email: 'x@' })), /client_email/);
  assert.throws(() => normalizeServiceAccount(JSON.stringify({ ...account, client_email: 'x@example.com' })), /client_email/);
});

test('rejects non-canonical token URI', () => {
  assert.throws(
    () => normalizeServiceAccount(JSON.stringify({ ...account, token_uri: 'https://evil.example/oauth2.googleapis.com/token' })),
    /token_uri/,
  );
});
