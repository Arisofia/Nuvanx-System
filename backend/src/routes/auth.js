'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { config } = require('../config/env');
const { pool, isAvailable, isProduction } = require('../db');
const { authLimiter } = require('../middleware/rateLimiter');
const { authLoginRules, authRegisterRules, handleValidationErrors } = require('../utils/validators');
const logger = require('../utils/logger');

const router = express.Router();

const BCRYPT_ROUNDS = config.bcryptRounds;
const DUMMY_PASSWORD_HASH = '$2b$10$C/wSDSBx/6CkXbkqVKgfHOmC9ZwTe74MkRUyvMh35vj0IadB1iKs6';

// In-memory fallback store for local development/testing only.
const memStore = new Map();

function issueTokenAndResponse(res, user, statusCode = 200) {
  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );

  return res.status(statusCode).json({
    success: true,
    token,
    user: { id: user.id, email: user.email, name: user.name },
  });
}

function normalizeUserRow(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
  };
}

async function dbFindByEmail(email) {
  const { rows } = await pool.query('SELECT id, email, name, password_hash FROM users WHERE email = $1', [email]);
  return rows[0] ? normalizeUserRow(rows[0]) : null;
}

async function dbCreateUser({ email, name, passwordHash }) {
  const id = uuidv4();
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, name, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, name, password_hash`,
    [id, email, name, passwordHash],
  );
  return normalizeUserRow(rows[0]);
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
    const user = await createUser({ email, name, passwordHash });

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

module.exports = router;
