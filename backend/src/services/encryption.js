'use strict';

/**
 * Credential encryption using Node's native crypto module.
 *
 * Algorithm : AES-256-GCM (authenticated encryption — detects tampering)
 * Key derivation: PBKDF2-HMAC-SHA256 with a unique random salt per record.
 *   This ensures that even if two records contain the same API key they produce
 *   different ciphertexts, and that compromise of one derived key cannot be
 *   used to brute-force the master encryption key.
 *
 * Ciphertext format (colon-delimited hex): salt:iv:authTag:ciphertext
 *   salt     — 32 bytes (256 bit) — unique per encrypt() call
 *   iv       — 12 bytes (96 bit)  — GCM standard nonce
 *   authTag  — 16 bytes (128 bit) — GCM authentication tag
 *   ciphertext — variable length
 */

const crypto = require('crypto');
const { config } = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;      // 256-bit AES key
const IV_LEN = 12;       // 96-bit GCM nonce (recommended)
const SALT_LEN = 32;     // 256-bit PBKDF2 salt
const ITERATIONS = 100000; // PBKDF2 rounds (high-entropy master key — no user password)
const DIGEST = 'sha256';
const SEPARATOR = ':';
const PART_COUNT = 4;

function deriveKey(masterKey, salt) {
  return crypto.pbkdf2Sync(masterKey, salt, ITERATIONS, KEY_LEN, DIGEST);
}

/**
 * Encrypts a plain-text string.
 * @param {string} text - Plain text to encrypt.
 * @param {string} [masterKey] - Master encryption key (defaults to ENCRYPTION_KEY env var).
 * @returns {string} Colon-delimited hex string: salt:iv:authTag:ciphertext
 */
function encrypt(text, masterKey = config.encryptionKey) {
  if (typeof text !== 'string') throw new TypeError('encrypt: text must be a string');
  if (!masterKey) throw new Error('encrypt: encryption key is required');

  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(masterKey, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    ciphertext.toString('hex'),
  ].join(SEPARATOR);
}

/**
 * Decrypts a ciphertext produced by encrypt().
 * @param {string} encoded - Colon-delimited hex string from encrypt().
 * @param {string} [masterKey] - Master encryption key (defaults to ENCRYPTION_KEY env var).
 * @returns {string} Decrypted plain text.
 */
function decrypt(encoded, masterKey = config.encryptionKey) {
  if (typeof encoded !== 'string') throw new TypeError('decrypt: ciphertext must be a string');
  if (!masterKey) throw new Error('decrypt: encryption key is required');

  const parts = encoded.split(SEPARATOR);
  if (parts.length !== PART_COUNT) {
    throw new Error('decrypt: decryption failed — malformed ciphertext (expected salt:iv:authTag:ciphertext)');
  }

  try {
    const [saltHex, ivHex, authTagHex, ciphertextHex] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    const key = deriveKey(masterKey, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
  } catch (err) {
    // GCM auth tag mismatch = wrong key; other errors = corrupted ciphertext
    const reason = err.message?.includes('auth') ? 'authentication tag mismatch (wrong key)' : 'corrupted ciphertext';
    throw new Error(`decrypt: decryption failed — ${reason}`);
  }
}

module.exports = { encrypt, decrypt };
