/**
 * Jest setup file — runs before all tests.
 * Configures environment variables to prevent external API calls during testing.
 */

'use strict';

// Disable external API calls and database connections during tests
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32-chars-min!';
process.env.SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'supabase-test-secret-32-chars-min!';

// Clear database connection — tests use in-memory fallback
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_DATABASE_KEY;

// Clear Supabase credentials — Supabase clients will be null
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_FIGMA_URL;
delete process.env.SUPABASE_FIGMA_SERVICE_ROLE;

// Clear external API keys to prevent accidental calls
delete process.env.SENTRY_DSN;
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.META_ACCESS_TOKEN;
delete process.env.GITHUB_TOKEN;
delete process.env.WHATSAPP_ACCESS_TOKEN;

// Set frontend URL for CORS
process.env.FRONTEND_URL = 'http://localhost:5173';

// Suppress logger in tests
process.env.LOG_LEVEL = 'error';

// Set a reasonable timeout for Jest tests
jest.setTimeout(30000);
