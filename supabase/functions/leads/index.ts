import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Get authenticated user from JWT
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const userId = user.id;

  try {
    if (req.method === 'GET') {
      const { data: leads, error } = await supabase
        .from('leads')
        .select('*')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .neq('source', 'doctoralia')   // consistent real acquisition data
        .order('created_at', { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, leads: leads ?? [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const STAGES = ['lead','whatsapp','appointment','treatment','closed'];
      const stage = STAGES.includes(body.stage) ? body.stage : 'lead';
      const { data: lead, error } = await supabase
        .from('leads')
        .insert({
          user_id: userId,
          name: body.name || '',
          email: body.email || '',
          phone: body.phone || '',
          source: body.source || 'manual',
          stage,
          revenue: Number.parseFloat(body.revenue) || 0,
          notes: body.notes || '',
          external_id: body.external_id || null
        })
        .select()
        .single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, lead }), {
        status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: false, message: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('[supabase/functions/leads] Error handling request:', err);
    return new Response(JSON.stringify({ success: false, message: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
