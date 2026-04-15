'use strict';

require('dotenv').config();

const REQUIRED_VARS = ['JWT_SECRET', 'ENCRYPTION_KEY'];

function validate() {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'production' && !process.env.DATABASE_URL && !process.env.SUPABASE_DATABASE_KEY) {
    throw new Error('In production, DATABASE_URL or SUPABASE_DATABASE_KEY is required');
  }

  const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
  if (!Number.isFinite(bcryptRounds) || bcryptRounds < 4 || bcryptRounds > 31) {
    throw new Error('BCRYPT_ROUNDS must be an integer between 4 and 31');
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
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

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
  // Used to verify webhook signatures from HubSpot (Private App → Webhooks → Client secret)
  hubspotClientSecret: process.env.HUBSPOT_CLIENT_SECRET || null,

  // Meta (Facebook) Marketing API
  metaAccessToken: process.env.META_ACCESS_TOKEN,
  metaAdAccountId: process.env.META_AD_ACCOUNT_ID,

  // WhatsApp Business Cloud API
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
};

module.exports = { config, validate };
