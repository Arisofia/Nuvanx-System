'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { encryptCredential, validateDeveloperToken } = require('./provision-google-ads-developer-token');

function decrypt(encoded, encryptionKey) {
  const [saltHex, ivHex, tagHex, ciphertextHex] = encoded.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const key = crypto.pbkdf2Sync(encryptionKey, salt, 100_000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

test('developer token validation rejects service-account payloads', () => {
  assert.throws(() => validateDeveloperToken('{"client_email":"x","private_key":"y"}'), /service-account payload/);
  assert.equal(validateDeveloperToken('abc_DEF-123.xyz~'), 'abc_DEF-123.xyz~');
});

test('encrypted credential round-trips through the production AES-GCM contract', () => {
  const token = 'developer_token_123';
  const key = 'nuvanx-test-encryption-key';
  const encoded = encryptCredential(token, key);
  assert.match(encoded, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(decrypt(encoded, key), token);
});
