'use strict';

const jwt = require('jsonwebtoken');
const { config } = require('../config/env');
const logger = require('../utils/logger');

/**
 * Verifies the JWT from the Authorization: Bearer <token> header.
 *
 * Accepts two JWT types:
 *  1. Custom backend JWTs signed with JWT_SECRET (legacy / no-Supabase mode)
 *  2. Supabase JWTs signed with SUPABASE_JWT_SECRET when that env var is set
 *
 * Attaches the decoded payload to req.user on success.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authorization token required' });
  }

  const token = authHeader.slice(7);

  // Try the custom backend JWT first
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
    return next();
  } catch (primaryErr) {
    // Only fall through to Supabase verification if we have a Supabase JWT secret
    if (!config.supabaseJwtSecret) {
      logger.debug('JWT verification failed', { error: primaryErr.message });
      if (primaryErr.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Token expired' });
      }
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
  }

  // Try Supabase JWT
  try {
    const decoded = jwt.verify(token, config.supabaseJwtSecret);
    // Normalize Supabase payload fields to the shape the rest of the app expects
    req.user = {
      id: decoded.sub || decoded.id,
      email: decoded.email || null,
      name: (decoded.user_metadata && decoded.user_metadata.name) || decoded.email || decoded.sub,
    };
    return next();
  } catch (supabaseErr) {
    logger.debug('Supabase JWT verification failed', { error: supabaseErr.message });
    if (supabaseErr.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

module.exports = { authenticate };
