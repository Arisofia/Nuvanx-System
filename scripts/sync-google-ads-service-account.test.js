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
  return normalized;
}

test('accepts canonical service-account JSON', () => {
  verify(JSON.stringify(account));
});

test('accepts quoted/double-encoded JSON', () => {
  verify(JSON.stringify(JSON.stringify(account)));
});

test('accepts base64 JSON', () => {
  verify(Buffer.from(JSON.stringify(account), 'utf8').toString('base64'));
});

test('rejects non-service-account and missing key material', () => {
  assert.throws(() => normalizeServiceAccount(JSON.stringify({ type: 'authorized_user' })), /type is invalid/);
  assert.throws(() => normalizeServiceAccount(JSON.stringify({ ...account, private_key: '' })), /private_key/);
});
