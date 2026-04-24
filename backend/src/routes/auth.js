'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { config } = require('../config/env');
const { pool, isAvailable, isProduction } = require('../db');
const { authLimiter } = require('../middleware/rateLimiter');
const { authLoginRules, authRegisterRules, handleValidationErrors } = require('../utils/validators');
const { sendPasswordResetEmail } = require('../services/email');
const logger = require('../utils/logger');

const router = express.Router();

const BCRYPT_ROUNDS = config.bcryptRounds;
const DUMMY_PASSWORD_HASH = '$2b$10$C/wSDSBx/6CkXbkqVKgfHOmC9ZwTe74MkRUyvMh35vj0IadB1iKs6';

// In-memory fallback store for local development/testing only.
const memStore = new Map();

function issueTokenAndResponse(res, user, statusCode = 200) {
  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, clinicId: user.clinicId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );

  return res.status(statusCode).json({
    success: true,
    token,
    user: { id: user.id, email: user.email, name: user.name, clinicId: user.clinicId },
  });
}

function normalizeUserRow(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    clinicId: row.clinic_id || null,
  };
}

async function dbFindByEmail(email) {
  const { rows } = await pool.query('SELECT id, email, name, password_hash, clinic_id FROM users WHERE email = $1', [email]);
  return rows[0] ? normalizeUserRow(rows[0]) : null;
}

async function dbCreateUser({ email, name, passwordHash }) {
  const id = uuidv4();
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (id, email, name, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, password_hash, clinic_id`,
      [id, email, name, passwordHash],
    );
    return normalizeUserRow(rows[0]);
  } catch (err) {
    // Postgres unique_violation — race condition between findByEmail and INSERT
    if (err.code === '23505') {
      const e = new Error('Email already registered');
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

function memoryFindByEmail(email) {
  return memStore.get(email) || null;
}

function memoryCreateUser({ email, name, passwordHash }) {
  const id = uuidv4();
  const user = { id, email, name, passwordHash, createdAt: new Date().toISOString() };
  memStore.set(email, user);
  return user;
}

router.post('/register', authLimiter, authRegisterRules, handleValidationErrors, async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    const { password, name } = req.body;

    const dbReady = isAvailable();
    if (!dbReady && isProduction) {
      return res.status(503).json({ success: false, message: 'Database unavailable' });
    }

    const findUser = dbReady ? dbFindByEmail : memoryFindByEmail;
    const createUser = dbReady ? dbCreateUser : memoryCreateUser;

    const existing = await findUser(email);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    let user;
    try {
      user = await createUser({ email, name, passwordHash });
    } catch (err) {
      if (err.status === 409) {
        return res.status(409).json({ success: false, message: 'Email already registered' });
      }
      throw err;
    }

    logger.info('User registered', { userId: user.id, email, storage: dbReady ? 'db' : 'memory' });
    return issueTokenAndResponse(res, user, 201);
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, authLoginRules, handleValidationErrors, async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    const { password } = req.body;

    const dbReady = isAvailable();
    if (!dbReady && isProduction) {
      return res.status(503).json({ success: false, message: 'Database unavailable' });
    }

    const findUser = dbReady ? dbFindByEmail : memoryFindByEmail;
    const user = await findUser(email);

    // Always compare against a hash to reduce timing side-channels.
    const passwordHashToCompare = user ? user.passwordHash : DUMMY_PASSWORD_HASH;
    const valid = await bcrypt.compare(password, passwordHashToCompare);
    if (!user || !valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    logger.info('User logged in', { userId: user.id, storage: dbReady ? 'db' : 'memory' });
    return issueTokenAndResponse(res, user);
  } catch (err) {
    next(err);
  }
});

router.get('/me', require('../middleware/auth').authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

// ─── Password reset ─────────────────────────────────────────────────────────

// In-memory fallback for reset tokens (used when DB is unavailable).
const memoryResetTokens = new Map();

// DB-backed token helpers — use the users table's reset columns when available,
// otherwise fall back to the in-memory Map.
async function storeResetToken(email, token, expiresAt) {
  if (isAvailable()) {
    await pool.query(
      `UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3`,
      [token, new Date(expiresAt).toISOString(), email],
    );
  } else {
    memoryResetTokens.set(token, { email, expiresAt });
  }
}

async function findResetToken(token) {
  if (isAvailable()) {
    const { rows } = await pool.query(
      `SELECT email, reset_token_expires FROM users WHERE reset_token = $1`,
      [token],
    );
    if (!rows[0]) return null;
    const expiresAt = new Date(rows[0].reset_token_expires).getTime();
    if (Date.now() > expiresAt) {
      await pool.query(`UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE reset_token = $1`, [token]);
      return null;
    }
    return { email: rows[0].email, expiresAt };
  }
  return memoryResetTokens.get(token) || null;
}

async function clearResetToken(token, email) {
  if (isAvailable()) {
    await pool.query(`UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE email = $1`, [email]);
  } else {
    memoryResetTokens.delete(token);
  }
}

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Generates a reset token (valid 1h). For now, returns it in the response
 * because no email transport is configured. Once an email provider is wired,
 * send the token via email and return a generic success message instead.
 */
router.post('/forgot-password', authLimiter, async (req, res, next) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    // Always return 200 to prevent email enumeration — but we still generate a
    // real token only if the user exists.
    const dbReady = isAvailable();
    if (!dbReady && isProduction) {
      return res.status(503).json({ success: false, message: 'Database unavailable' });
    }

    const findUser = dbReady ? dbFindByEmail : memoryFindByEmail;
    const user = await findUser(email);

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      await storeResetToken(email, token, Date.now() + 3600000); // 1h
      logger.info('Password reset token generated', { email });

      await sendPasswordResetEmail(email, token);
    }

    // User not found — return same message to prevent enumeration
    return res.json({
      success: true,
      message: 'If that email is registered, a reset link has been generated.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/reset-password
 * Body: { token, newPassword }
 * Validates the reset token and updates the password.
 */
router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'Token and newPassword are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }

    const entry = await findResetToken(token);
    if (!entry) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
    }

    const dbReady = isAvailable();
    if (!dbReady && isProduction) {
      return res.status(503).json({ success: false, message: 'Database unavailable' });
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    if (dbReady) {
      const { rowCount } = await pool.query(
        'UPDATE users SET password_hash = $1 WHERE email = $2',
        [passwordHash, entry.email],
      );
      if (rowCount === 0) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }
    } else {
      const user = memoryFindByEmail(entry.email);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }
      user.passwordHash = passwordHash;
    }

    await clearResetToken(token, entry.email);
    logger.info('Password reset completed', { email: entry.email });
    return res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
