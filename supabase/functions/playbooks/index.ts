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
  const path = url.pathname.replace(/^\/playbooks\/?/, '').replace(/^\//, '');

  // GET /playbooks
  if (req.method === 'GET' && !path) {
    const { data, error } = await supabase
      .from('playbooks')
      .select('id, slug, title, description, category, status, steps, run_count, last_run_at, created_at')
      .order('created_at');
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, playbooks: data ?? [], source: 'database' });
  }

  // POST /playbooks/:id/run
  if (req.method === 'POST' && path.endsWith('/run')) {
    const playbookId = path.replace('/run', '');
    const { data: pb, error: pbError } = await supabase
      .from('playbooks').select('id, title').eq('id', playbookId).single();
    if (pbError || !pb) return json({ success: false, message: 'Playbook not found' }, 404);

    const execId = crypto.randomUUID();
    const { error: execError } = await supabase
      .from('playbook_executions')
      .insert({ id: execId, playbook_id: playbookId, user_id: userId, status: 'triggered', metadata: {} });
    if (execError) return json({ success: false, message: execError.message }, 500);

    await supabase.from('playbooks')
      .update({ run_count: (pb as any).run_count + 1 || 1, last_run_at: new Date().toISOString() })
      .eq('id', playbookId);

    return json({
      success: true,
      message: `Execution of "${pb.title}" recorded. Full orchestration is not yet implemented.`,
      executionId: execId
    });
  }

  return json({ success: false, message: `Unknown path: ${path}` }, 404);
});
