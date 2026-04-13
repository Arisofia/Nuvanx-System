'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';

const { encrypt, decrypt } = require('../src/services/encryption');

describe('AES-256-GCM Encryption Service (native crypto + PBKDF2)', () => {
  const key = 'a-specific-32-char-test-key-here!';

  test('roundtrip: encrypts and decrypts back to original', () => {
    const original = 'sk-abc123SuperSecretAPIKey';
    const ciphertext = encrypt(original, key);
    expect(ciphertext).not.toBe(original);
    const plaintext = decrypt(ciphertext, key);
    expect(plaintext).toBe(original);
  });

  test('roundtrip: works with empty string', () => {
    const ciphertext = encrypt('', key);
    const plaintext = decrypt(ciphertext, key);
    expect(plaintext).toBe('');
  });

  test('roundtrip: works with special characters and unicode', () => {
    const special = '!@#$%^&*()_+{}|:"<>?~`-=[]\\;\',./🔑é日本語';
    const ciphertext = encrypt(special, key);
    const plaintext = decrypt(ciphertext, key);
    expect(plaintext).toBe(special);
  });

  test('two encryptions of the same text produce different ciphertexts (random salt + IV)', () => {
    const text = 'same-text';
    const c1 = encrypt(text, key);
    const c2 = encrypt(text, key);
    expect(c1).not.toBe(c2);
  });

  test('ciphertext format is colon-delimited hex with exactly 4 parts', () => {
    const ciphertext = encrypt('test-value', key);
    const parts = ciphertext.split(':');
    expect(parts).toHaveLength(4);
    // salt: 32 bytes = 64 hex chars
    expect(parts[0]).toHaveLength(64);
    // iv: 12 bytes = 24 hex chars
    expect(parts[1]).toHaveLength(24);
    // authTag: 16 bytes = 32 hex chars
    expect(parts[2]).toHaveLength(32);
    // ciphertext: >= 0 chars
    expect(parts[3].length).toBeGreaterThanOrEqual(0);
  });

  test('uses ENCRYPTION_KEY env var by default', () => {
    const text = 'default-key-test';
    const ciphertext = encrypt(text); // no explicit key
    const plaintext = decrypt(ciphertext); // no explicit key
    expect(plaintext).toBe(text);
  });

  test('throws TypeError if text is not a string', () => {
    expect(() => encrypt(12345, key)).toThrow(TypeError);
  });

  test('throws TypeError if ciphertext is not a string', () => {
    expect(() => decrypt(null, key)).toThrow(TypeError);
  });

  test('throws if wrong key is used to decrypt (GCM auth tag mismatch)', () => {
    const ciphertext = encrypt('secret', key);
    expect(() => decrypt(ciphertext, 'completely-wrong-key-that-is-long-enough!')).toThrow(
      'decryption failed',
    );
  });

  test('throws if ciphertext is malformed (wrong number of parts)', () => {
    expect(() => decrypt('notvalid:format', key)).toThrow('malformed ciphertext');
  });
});
