'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { config } = require('../config/env');
const { getPool, isAvailable } = require('../db');
const { authLimiter } = require('../middleware/rateLimiter');
const { authLoginRules, authRegisterRules, handleValidationErrors } = require('../utils/validators');
const logger = require('../utils/logger');

const router = express.Router();

const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// In-memory fallback — only used in development/test when DATABASE_URL is
// absent.  In production the DB pool module exits the process if the database
// is unavailable, so this path is never reached in production.
// ---------------------------------------------------------------------------
const memStore = new Map();

// ---------------------------------------------------------------------------
// Password helpers
// ---------------------------------------------------------------------------
function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ---------------------------------------------------------------------------
// Database helpers (users table from 001_initial_schema.sql)
// ---------------------------------------------------------------------------
async function _dbFindByEmail(email) {
  const { rows } = await getPool().query(
    'SELECT id, email, name, password_hash, created_at FROM users WHERE email = $1',
    [email],
  );
  return rows[0] || null;
}

async function _dbCreate(email, name, passwordHash) {
  const { rows } = await getPool().query(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, email, name, created_at`,
    [email, name, passwordHash],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
router.post('/register', authLimiter, authRegisterRules, handleValidationErrors, async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (isAvailable()) {
      // ── Database path ───────────────────────────────────────────────────
      try {
        const existing = await _dbFindByEmail(email);
        if (existing) {
          return res.status(409).json({ success: false, message: 'Email already registered' });
        }

        const passwordHash = await hashPassword(password);
        let row;
        try {
          row = await _dbCreate(email, name || '', passwordHash);
        } catch (err) {
          if (err && err.code === '23505') {
            return res.status(409).json({ success: false, message: 'Email already registered' });
          }
          throw err;
        }
        const { id } = row;

        const token = jwt.sign({ id, email, name: row.name }, config.jwtSecret, {
          expiresIn: config.jwtExpiresIn,
        });
        logger.info('User registered (db)', { userId: id, email });

        return res.status(201).json({
          success: true,
          token,
          user: { id, email, name: row.name },
        });
      } catch (err) {
        if (config.nodeEnv !== 'production') {
          logger.warn('DB register failed in dev/test, falling back to in-memory', { error: err.message });
          // fall through to in-memory path
        } else {
          throw err;
        }
      }
    }

    // ── In-memory fallback (dev/test only, or DB failure in non-production) ──
    if (memStore.has(email)) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const passwordHash = await hashPassword(password);
    const id = uuidv4();
    const user = { id, email, name: name || '', passwordHash, createdAt: new Date().toISOString() };
    memStore.set(email, user);

    const token = jwt.sign({ id, email, name: user.name }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn,
    });
    logger.info('User registered (in-memory)', { userId: id, email });

    return res.status(201).json({
      success: true,
      token,
      user: { id, email, name: user.name },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post('/login', authLimiter, authLoginRules, handleValidationErrors, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (isAvailable()) {
      // ── Database path ───────────────────────────────────────────────────
      try {
        const user = await _dbFindByEmail(email);
        if (!user) {
          return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) {
          return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        const token = jwt.sign(
          { id: user.id, email: user.email, name: user.name },
          config.jwtSecret,
          { expiresIn: config.jwtExpiresIn },
        );
        logger.info('User logged in (db)', { userId: user.id });

        return res.json({
          success: true,
          token,
          user: { id: user.id, email: user.email, name: user.name },
        });
      } catch (err) {
        if (config.nodeEnv !== 'production') {
          logger.warn('DB login failed in dev/test, falling back to in-memory', { error: err.message });
          // fall through to in-memory path
        } else {
          throw err;
        }
      }
    }

    // ── In-memory fallback (dev/test only, or DB failure in non-production) ──
    const user = memStore.get(email);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn },
    );
    logger.info('User logged in (in-memory)', { userId: user.id });

    return res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
router.get('/me', require('../middleware/auth').authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
