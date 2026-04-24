'use strict';

require('dotenv').config();

const REQUIRED_VARS = ['JWT_SECRET', 'ENCRYPTION_KEY'];

function validate() {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';

  if (isProd && process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }
  if (isProd && process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters in production');
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

  // Meta (Facebook) Marketing API
  metaAccessToken: process.env.META_ACCESS_TOKEN,
  metaAdAccountId: process.env.META_AD_ACCOUNT_ID,
  metaAppSecret: process.env.META_APP_SECRET || null,
  metaVerifyToken: process.env.META_VERIFY_TOKEN || null,
  metaPixelId: process.env.META_PIXEL_ID || null,
  metaCapiAccessToken: process.env.META_CAPI_ACCESS_TOKEN || null,

  // WhatsApp Business Cloud API
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,

  // GitHub — server-level personal access token fallback (fine-grained or classic).
  // Checks GITHUB_PAT first (recommended naming to avoid collision with the built-in
  // GitHub Actions token), then GITHUB_TOKEN_CLASSIC, then GITHUB_TOKEN.
  githubToken: process.env.GITHUB_PAT || process.env.GITHUB_TOKEN_CLASSIC || process.env.GITHUB_TOKEN || null,

  // Sentry error tracking
  sentryDsn: process.env.SENTRY_DSN || null,

  // Resend email service — used for password reset emails
  resendApiKey: process.env.RESEND_API_KEY || null,
  emailFrom: process.env.EMAIL_FROM || 'Nuvanx <noreply@nuvanx.com>',

  // Allow falling back to server-level env var credentials when a user has
  // no per-user vault credential.  Safe for single-tenant; set to 'false'
  // in production multi-tenant to enforce per-user vault credentials.
  allowSharedCredentials: process.env.ALLOW_SHARED_CREDENTIALS !== 'false',

  // UUID of the admin/owner user that receives webhook-originated leads (Meta, WhatsApp)
  // Set this to the UUID of the main platform user in Supabase Auth.
  webhookAdminUserId: process.env.WEBHOOK_ADMIN_USER_ID || null,
};

module.exports = { config, validate };
