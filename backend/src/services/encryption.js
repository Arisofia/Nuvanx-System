'use strict';

const CryptoJS = require('crypto-js');
const { config } = require('../config/env');

/**
 * Encrypts a plain-text string using AES-256.
 * @param {string} text - Plain text to encrypt.
 * @param {string} [key] - Encryption key (defaults to ENCRYPTION_KEY env var).
 * @returns {string} Base64 ciphertext string.
 */
function encrypt(text, key = config.encryptionKey) {
  if (typeof text !== 'string') throw new TypeError('encrypt: text must be a string');
  if (!key) throw new Error('encrypt: encryption key is required');
  return CryptoJS.AES.encrypt(text, key).toString();
}

/**
 * Decrypts an AES-256 ciphertext string.
 * @param {string} ciphertext - Base64 ciphertext produced by encrypt().
 * @param {string} [key] - Encryption key (defaults to ENCRYPTION_KEY env var).
 * @returns {string} Decrypted plain text.
 */
function decrypt(ciphertext, key = config.encryptionKey) {
  if (typeof ciphertext !== 'string') throw new TypeError('decrypt: ciphertext must be a string');
  if (!key) throw new Error('decrypt: encryption key is required');
  const bytes = CryptoJS.AES.decrypt(ciphertext, key);
  // sigBytes < 0 indicates a malformed / wrong-key decryption in crypto-js
  if (bytes.sigBytes < 0) {
    throw new Error('decrypt: decryption failed — invalid key or corrupted ciphertext');
  }
  return bytes.toString(CryptoJS.enc.Utf8);
}

module.exports = { encrypt, decrypt };
