'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';

const { encrypt, decrypt } = require('../src/services/encryption');

describe('AES-256 Encryption Service', () => {
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

  test('two encryptions of the same text produce different ciphertexts (IV)', () => {
    const text = 'same-text';
    const c1 = encrypt(text, key);
    const c2 = encrypt(text, key);
    expect(c1).not.toBe(c2);
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

  test('throws if wrong key is used to decrypt', () => {
    const ciphertext = encrypt('secret', key);
    expect(() => decrypt(ciphertext, 'completely-wrong-key-that-is-long-enough!')).toThrow(
      'decryption failed',
    );
  });
});
