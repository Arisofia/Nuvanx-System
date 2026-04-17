'use strict';

require('dotenv').config();

const Sentry = require('@sentry/node');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const { config, validate } = require('./config/env');
const logger = require('./utils/logger');
const { pool, isAvailable } = require('./db');
const { supabaseAdmin } = require('./config/supabase');
const { defaultLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');
const { startPeriodicSync, stopPeriodicSync } = require('./services/dashboardSync');

// Validate required environment variables before anything else
validate();

// ─── Sentry error tracking ─────────────────────────────────────────────────
if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    tracesSampleRate: config.nodeEnv === 'production' ? 0.2 : 1.0,
  });
  logger.info('Sentry initialized');
}

const app = express();

// Trust first proxy (Railway / Render / Vercel reverse proxy)
app.set('trust proxy', 1);

// ─── Security middleware ────────────────────────────────────────────────────
app.use(helmet());

// Support comma-separated FRONTEND_URL for multiple allowed origins
// e.g. "https://nuvanx.vercel.app,https://nuvanx-preview.vercel.app"
const allowedOrigins = config.frontendUrl
  ? config.frontendUrl.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

app.use(
  cors({
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// ─── Body parsing ───────────────────────────────────────────────────────────
// Capture rawBody for webhook signature verification (Meta, etc.)
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Rate limiting (global) ─────────────────────────────────────────────────
app.use(defaultLimiter);

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const checks = { pg: 'unknown', supabase: 'unknown' };

  // PostgreSQL
  if (isAvailable()) {
    try {
      await pool.query('SELECT 1');
      checks.pg = 'ok';
    } catch {
      checks.pg = 'error';
    }
  } else {
    checks.pg = 'in-memory';
  }

  // Supabase
  if (supabaseAdmin) {
    try {
      const { error } = await supabaseAdmin.from('leads').select('id').limit(1);
      checks.supabase = error ? 'error' : 'ok';
    } catch {
      checks.supabase = 'error';
    }
  } else {
    checks.supabase = 'not-configured';
  }

  const allOk = Object.values(checks).every((v) => v === 'ok' || v === 'not-configured');
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    env: config.nodeEnv,
    database: checks.pg === 'ok' ? 'postgres' : checks.pg,
    checks,
  });
});

// ─── API routes ──────────────────────────────────────────────────────────────
// ─── Webhooks (no auth — signature-verified at route level) ────────────────
app.use('/api/webhooks', require('./routes/webhooks'));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/credentials', require('./routes/credentials'));
app.use('/api/integrations', require('./routes/integrations'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/figma', require('./routes/figma'));
app.use('/api/github', require('./routes/github'));
app.use('/api/playbooks', require('./routes/playbooks'));

// ─── 404 handler ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` });
});

// ─── Sentry error handler (must be before custom errorHandler) ──────────────
if (config.sentryDsn) {
  Sentry.setupExpressErrorHandler(app);
}

// ─── Global error handler ───────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start server ────────────────────────────────────────────────────────────
if (require.main === module) {
  const server = app.listen(config.port, () => {
    logger.info(`RIP backend running on port ${config.port} [${config.nodeEnv}]`);
    logger.info(`Database: ${isAvailable() ? 'PostgreSQL connected' : 'IN-MEMORY (data lost on restart) — set DATABASE_URL in .env'}`);
    logger.info(`Supabase client: ${supabaseAdmin ? 'configured' : 'not configured — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'}`);

    // Start periodic dashboard_metrics sync (every 5 min) when Figma Supabase is configured
    startPeriodicSync();
  });

  // ─── Graceful shutdown ────────────────────────────────────────────
  // Drain in-flight requests before exiting so clients receive complete responses.
  // Cloud platforms (Railway, Render, k8s) send SIGTERM before SIGKILL.
  const gracefulShutdown = (signal) => {
    logger.info(`${signal} received — closing HTTP server`);
    stopPeriodicSync();
    server.close(() => {
      logger.info('HTTP server closed. Exiting.');
      process.exit(0);
    });
    // Force-kill if drain takes longer than 10 s
    setTimeout(() => {
      logger.warn('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = app;
