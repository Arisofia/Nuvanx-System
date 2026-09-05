import { createClient } from '@supabase/supabase-js';
import { buildCorsHeaders, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/config.ts';

function createPublicAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function createAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  // POST /auth/register — public by design, but registration must traverse the
  // standard Supabase Auth signup endpoint so native signup policy/rate limits apply.
  if (req.method === 'POST' && path === 'register') {
    const { email, password, name } = body;
    if (!email || !password) return json({ success: false, message: 'email and password required' }, 400);
    if (password.length < 8) return json({ success: false, message: 'password must be at least 8 characters' }, 400);

    const publicAuth = createPublicAuthClient();
    const { data: authData, error: authError } = await publicAuth.auth.signUp({
      email,
      password,
      options: { data: { name: name || '' } },
    });

    if (authError || !authData.user) {
      const status = authError?.message.toLowerCase().includes('already') ? 409 : 400;
      return json({ success: false, message: authError?.message || 'Registration failed' }, status);
    }

    // Mirror identity metadata into public.users for FK integrity. The service role
    // is used only after Supabase Auth has accepted the standard signup request.
    const admin = createAdminClient();
    const { error: insertError } = await admin.from('users').upsert({
      id: authData.user.id,
      email: authData.user.email ?? email,
      name: name || '',
    }, { onConflict: 'id' });

    if (insertError) console.error('public.users mirror failed:', insertError.message);

    return json({ success: true, message: 'Registration successful. Please use Supabase Auth to log in.' });
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
