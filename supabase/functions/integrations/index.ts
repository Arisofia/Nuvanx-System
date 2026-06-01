import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anonKey    = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

async function getAuthUser(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return null;
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await client.auth.getUser();
  return user;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  const user = await getAuthUser(req);
  if (!user) return json({ success: false, message: 'Unauthorized' }, 401);

  const supabase = createClient(supabaseUrl, serviceKey);
  const userId = user.id;
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/integrations\/?/, '').replace(/^\//, '');

  // GET /integrations — list all
  if (req.method === 'GET' && !path) {
    const { data, error } = await supabase
      .from('integrations')
      .select('id, service, status, last_sync, last_error, metadata, created_at, updated_at')
      .eq('user_id', userId)
      .order('service');
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, integrations: data ?? [] });
  }

  // POST /integrations/connect — store encrypted credential + mark connected
  if (req.method === 'POST' && path === 'connect') {
    const body = await req.json().catch(() => ({}));
    const { service, apiKey, metadata } = body;
    if (!service || !apiKey) return json({ success: false, message: 'service and apiKey required' }, 400);

    const ALLOWED = ['meta', 'whatsapp', 'hubspot', 'openai', 'gemini', 'google-calendar', 'google-gmail', 'github'];
    if (!ALLOWED.includes(service)) return json({ success: false, message: `Unknown service: ${service}` }, 400);

    // Store in credentials table (key stored as-is; production Node backend encrypts with AES-256)
    const { error: credError } = await supabase
      .from('credentials')
      .upsert({ user_id: userId, service, encrypted_key: apiKey, last_used: new Date().toISOString() },
               { onConflict: 'user_id, service' });
    if (credError) return json({ success: false, message: credError.message }, 500);

    // Upsert integration status
    const { error: intError } = await supabase
      .from('integrations')
      .upsert({
        user_id: userId, service, status: 'connected',
        last_sync: new Date().toISOString(),
        last_error: null,
        metadata: metadata ?? {}
      }, { onConflict: 'user_id, service' });
    if (intError) return json({ success: false, message: intError.message }, 500);

    return json({ success: true, message: `${service} connected successfully` });
  }

  // POST /integrations/:service/disconnect
  if (req.method === 'POST' && path.endsWith('/disconnect')) {
    const service = path.replace('/disconnect', '');
    await supabase.from('credentials').delete().eq('user_id', userId).eq('service', service);
    await supabase.from('integrations').update({ status: 'disconnected', last_error: null })
      .eq('user_id', userId).eq('service', service);
    return json({ success: true, message: `${service} disconnected` });
  }

  return json({ success: false, message: `Unknown path: ${path}` }, 404);
});
