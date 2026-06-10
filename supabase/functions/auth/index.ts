import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/config.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url  = new URL(req.url);
  const path = url.pathname.replace(/^\/auth\/?/, '').replace(/^\//, '');
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  // POST /auth/register
  if (req.method === 'POST' && path === 'register') {
    const { email, password, name } = body;
    if (!email || !password) return json({ success: false, message: 'email and password required' }, 400);
    if (password.length < 8)  return json({ success: false, message: 'password must be at least 8 characters' }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Use Supabase Auth so sessions work across frontend
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { name: name || '' }
    });
    if (authError) {
      const status = authError.message.includes('already') ? 409 : 400;
      return json({ success: false, message: authError.message }, status);
    }
    // Mirror into public.users for FK integrity
    const { error: insertError } = await supabase.from('users').upsert({
      id: authData.user.id,
      email: authData.user.email ?? email,
      name: name || '',
      password_hash: 'supabase_auth'
    }, { onConflict: 'id' });
    if (insertError) console.error('public.users mirror failed:', insertError.message);

    return json({ success: true, message: 'Registration successful. Please use Supabase Auth to log in.' });
  }

  // GET /auth/me — verify token and return user
  if (req.method === 'GET' && path === 'me') {
    const authHeader = req.headers.get('Authorization') ?? '';
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return json({ success: false, message: 'Unauthorized' }, 401);
    return json({ success: true, user: { id: user.id, email: user.email, name: user.user_metadata?.name } });
  }

  return json({ success: false, message: `Unknown path: ${path}` }, 404);
});
