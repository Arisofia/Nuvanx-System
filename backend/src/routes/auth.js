'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { config } = require('../config/env');
const { authLimiter } = require('../middleware/rateLimiter');
const { authLoginRules, authRegisterRules, handleValidationErrors } = require('../utils/validators');
const logger = require('../utils/logger');

const router = express.Router();

// In-memory user store (TODO: replace with PostgreSQL)
const users = new Map();

router.post('/register', authLimiter, authRegisterRules, handleValidationErrors, async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (users.has(email)) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    const user = { id, email, name, passwordHash, createdAt: new Date().toISOString() };
    users.set(email, user);

    const token = jwt.sign({ id, email, name }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    logger.info('User registered', { userId: id, email });

    return res.status(201).json({
      success: true,
      token,
      user: { id, email, name },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, authLoginRules, handleValidationErrors, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = users.get(email);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn },
    );
    logger.info('User logged in', { userId: user.id });

    return res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', require('../middleware/auth').authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
