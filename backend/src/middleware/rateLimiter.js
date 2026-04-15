'use strict';

const rateLimit = require('express-rate-limit');

const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts, please try again later.' },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'AI request rate limit exceeded, please slow down.' },
});

/** Mutations on the leads table — tighter window to prevent bulk-insert abuse. */
const leadsWriteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Lead write rate limit exceeded, please slow down.' },
});

/** Inbound webhook rate limiter — prevents flooding from misconfigured callers. */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Webhook rate limit exceeded.' },
});

/**
 * Integration test limiter — each test call makes a real external API request.
 * 5 tests per minute per IP prevents accidental or intentional external API abuse.
 */
const integrationTestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many integration test requests. Wait a moment before testing again.' },
});

/**
 * Credentials write limiter — prevents brute-force credential enumeration/replacement.
 * 10 writes per 15 min is generous for legitimate use; blocks automated attacks.
 */
const credentialsWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many credential operations. Please wait before trying again.' },
});

module.exports = {
  defaultLimiter,
  authLimiter,
  aiLimiter,
  leadsWriteLimiter,
  webhookLimiter,
  integrationTestLimiter,
  credentialsWriteLimiter,
};
