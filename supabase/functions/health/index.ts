import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  let dbConnected = false;
  let dbLatencyMs = null;
  if (supabaseUrl && serviceKey) {
    const supabase = createClient(supabaseUrl, serviceKey);
    const t0 = Date.now();
    try {
      const { error } = await supabase.from('users').select('id').limit(1);
      dbConnected = !error;
      dbLatencyMs = Date.now() - t0;
    } catch { dbConnected = false; }
  }
  return new Response(JSON.stringify({
    status: 'ok',
    timestamp: new Date().toISOString(),
    runtime: 'supabase-edge-function',
    persistence: dbConnected ? 'postgres' : 'unavailable',
    db: { connected: dbConnected, latencyMs: dbLatencyMs }
  }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
});
