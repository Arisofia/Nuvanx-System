'use strict';

require('dotenv').config();

const REQUIRED_VARS = ['JWT_SECRET', 'ENCRYPTION_KEY'];

function validate() {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters');
  }
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET,
  encryptionKey: process.env.ENCRYPTION_KEY,
  // PostgreSQL: prefer DATABASE_URL, fall back to Supabase connection key
  databaseUrl: process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_KEY,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',

  // Third-party API keys (server-level defaults; per-user vault credentials take priority)
  openaiApiKey: process.env.OPENAI_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  googleApiKey: process.env.GOOGLE_API_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  hubspotAccessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  hubspotApiKey: process.env.HUBSPOT_API_KEY,
  // Note: Codespaces secret name has a typo (HUSPOT_PORTAL_ID); support both spellings
  hubspotPortalId: process.env.HUBSPOT_PORTAL_ID || process.env.HUSPOT_PORTAL_ID,
};

module.exports = { config, validate };
