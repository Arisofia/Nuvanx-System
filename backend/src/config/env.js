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

  // Supabase — main project
  supabaseUrl: process.env.SUPABASE_URL || null,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
  // Supabase JWT secret — Project Settings → API → JWT Settings → JWT Secret
  // When set, the backend will also accept Supabase access tokens as Bearer JWTs.
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET || null,

  // Supabase — Figma V.1 project
  supabaseFigmaUrl: process.env.SUPABASE_FIGMA_URL || null,
  supabaseFigmaAnonKey: process.env.SUPABASE_FIGMA_ANON_KEY || null,
  supabaseFigmaServiceRoleKey: process.env.SUPABASE_FIGMA_SERVICE_ROLE || null,

  // Third-party API keys (server-level defaults; per-user vault credentials take priority)
  openaiApiKey: process.env.OPENAI_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  googleApiKey: process.env.GOOGLE_API_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  hubspotAccessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  hubspotApiKey: process.env.HUBSPOT_API_KEY,
  // Note: Codespaces secret name has a typo (HUSPOT_PORTAL_ID); support both spellings
  hubspotPortalId: process.env.HUBSPOT_PORTAL_ID || process.env.HUSPOT_PORTAL_ID,

  // Meta (Facebook) Marketing API
  metaAccessToken: process.env.META_ACCESS_TOKEN,
  metaAdAccountId: process.env.META_AD_ACCOUNT_ID,

  // WhatsApp Business Cloud API
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
};

module.exports = { config, validate };
