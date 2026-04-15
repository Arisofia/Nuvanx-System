'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const { config, validate } = require('./config/env');
const logger = require('./utils/logger');
const { defaultLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');

// Validate required environment variables before anything else
validate();

const app = express();

// ─── Security middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// ─── Body parsing ───────────────────────────────────────────────────────────
// Capture rawBody for webhook signature verification (HubSpot, etc.)
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Rate limiting (global) ─────────────────────────────────────────────────
app.use(defaultLimiter);

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: config.nodeEnv });
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
app.use('/api/figma', require('./routes/figma'));

// ─── 404 handler ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` });
});

// ─── Global error handler ───────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start server ────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(config.port, () => {
    logger.info(`RIP backend running on port ${config.port} [${config.nodeEnv}]`);
  });
}

module.exports = app;
