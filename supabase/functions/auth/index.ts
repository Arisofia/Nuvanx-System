import { createClient } from '@supabase/supabase-js';
import { buildCorsHeaders, SUPABASE_ANON_KEY, SUPABASE_URL } from '../_shared/config.ts';

function createPublicAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/auth\/?/, '').replace(/^\//, '');
  const body: unknown = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  // POST /auth/register — public by design. Registration traverses the standard
  // Supabase Auth signup endpoint so native signup policy/rate limits apply.
  // public.users is mirrored transactionally by the versioned auth.users trigger.
  if (req.method === 'POST' && path === 'register') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ success: false, message: 'invalid request body' }, 400);
    }

    const { email, password, name } = body as Record<string, unknown>;
    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      (name !== undefined && typeof name !== 'string')
    ) {
      return json({ success: false, message: 'email, password and name must have valid types' }, 400);
    }

    const normalizedEmail = email.trim();
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    if (!normalizedEmail || !password) {
      return json({ success: false, message: 'email and password required' }, 400);
    }
    if (password.length < 8) {
      return json({ success: false, message: 'password must be at least 8 characters' }, 400);
    }

    const publicAuth = createPublicAuthClient();
    const { data: authData, error: authError } = await publicAuth.auth.signUp({
      email: normalizedEmail,
      password,
      options: { data: { name: normalizedName } },
    });

    if (authError || !authData.user) {
      const status = authError?.message.toLowerCase().includes('already') ? 409 : 400;
      return json({ success: false, message: authError?.message || 'Registration failed' }, status);
    }

    // Supabase may return an obfuscated user for an already-registered confirmed
    // address. No auth.users INSERT occurs in that case, so the DB trigger cannot
    // create a phantom public.users row. Keep the response generic to avoid user
    // enumeration and do not perform any service-role mirror from this public route.
    return json({ success: true, message: 'Registration request accepted. Please use Supabase Auth to log in.' });
  }

  // GET /auth/me — verify token and return user.
  if (req.method === 'GET' && path === 'me') {
    const authHeader = req.headers.get('Authorization') ?? '';
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return json({ success: false, message: 'Unauthorized' }, 401);
    return json({ success: true, user: { id: user.id, email: user.email, name: user.user_metadata?.name } });
  }

  return json({ success: false, message: `Unknown path: ${path}` }, 404);
});
