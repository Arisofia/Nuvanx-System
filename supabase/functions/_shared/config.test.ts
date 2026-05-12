if (typeof process !== 'undefined' && !process.config) {
  (process as any).config = {};
}

const g = globalThis as any;
const originalDenoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
async function importConfig(env: Record<string, string | undefined>) {
  Object.defineProperty(globalThis, 'Deno', {
    configurable: true,
    enumerable: true,
    value: {
      env: {
        get: vi.fn((name: string) => env[name]),
      },
    },
  });
  vi.resetModules();
  return import('./config.ts');
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalDenoDescriptor) {
    Object.defineProperty(globalThis, 'Deno', originalDenoDescriptor);
  } else if (Object.prototype.hasOwnProperty.call(globalThis, 'Deno')) {
    delete g.Deno;
  }
});

describe('edge runtime config', () => {
  it('normalizes HTTPS frontend URLs and rejects unsafe values', async () => {
    const config = await importConfig({});

    expect(config.normalizeFrontendUrl('https://example.com/')).toBe('https://example.com');
    expect(config.normalizeFrontendUrl('http://example.com')).toBeNull();
    expect(config.normalizeFrontendUrl('*')).toBeNull();
    expect(config.normalizeFrontendUrl('null')).toBeNull();
    expect(config.normalizeFrontendUrl('not a url')).toBeNull();
  });

  it('uses the production fallback URL when production FRONTEND_URL is invalid', async () => {
    const config = await importConfig({
      DENO_ENV: 'production',
      FRONTEND_URL: 'http://localhost:5173',
    });

    expect(config.IS_DEVELOPMENT).toBe(false);
    expect(config.FRONTEND_URL).toBe('https://frontend-arisofias-projects-c2217452.vercel.app');
    expect(config.DEFAULT_CORS_HEADERS['Access-Control-Allow-Origin']).toBe(config.FRONTEND_URL);
  });

  it('allows configured production origins and falls back for unknown origins', async () => {
    const config = await importConfig({
      DENO_ENV: 'production',
      FRONTEND_URL: 'https://nuvanx.com/',
    });

    expect(config.FRONTEND_URL).toBe('https://nuvanx.com');
    expect(config.buildCorsHeaders('https://www.nuvanx.com')['Access-Control-Allow-Origin']).toBe('https://www.nuvanx.com');
    expect(config.buildCorsHeaders('https://evil.example')['Access-Control-Allow-Origin']).toBe('https://nuvanx.com');
  });

  it('reads and validates required runtime secrets through the shared config helpers', async () => {
    const config = await importConfig({
      SUPABASE_URL: ' https://project.supabase.co ',
      SUPABASE_SERVICE_ROLE_KEY: ' service-key ',
    });

    expect(config.SUPABASE_URL).toBe('https://project.supabase.co');
    expect(config.SUPABASE_SERVICE_ROLE_KEY).toBe('service-key');
    expect(config.requireRuntimeSecret('SUPABASE_URL')).toBe('https://project.supabase.co');
    expect(() => config.requireRuntimeSecret('SUPABASE_ANON_KEY')).toThrow('SUPABASE_ANON_KEY is required');
  });
});
