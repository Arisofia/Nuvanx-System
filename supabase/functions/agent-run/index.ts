/**
 * Agent Runner Edge Function
 * 
 * Executes real AI analysis using configured credentials,
 * persists output to agent_outputs table, and returns the result.
 * 
 * POST /agent-run
 * Body: { agent_type, content_type?, prompt_override?, context_data? }
 * 
 * Required Supabase Secrets:
 *   ANTHROPIC_API_KEY or OPENAI_API_KEY or GEMINI_API_KEY
 *   (reads from credentials table if env not set)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

// Try to get API keys from Supabase secrets first, then from env
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const OPENAI_KEY    = Deno.env.get('OPENAI_API_KEY') ?? '';
const GEMINI_KEY    = Deno.env.get('GEMINI_API_KEY') ?? '';

async function resolveClinicId(adminClient: any, userId: string): Promise<string | null> {
  const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
  return usr?.clinic_id ?? null;
}

async function callAnthropicAPI(prompt: string, context: string): Promise<{ text: string; model: string; tokens: number }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [{ role: 'user', content: context ? `${context}\n\n${prompt}` : prompt }]
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return {
    text: data.content?.[0]?.text ?? '',
    model: 'claude-3-5-sonnet-20241022',
    tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0)
  };
}

async function callOpenAIAPI(prompt: string, context: string): Promise<{ text: string; model: string; tokens: number }> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 2000,
      messages: [
        ...(context ? [{ role: 'system', content: context }] : []),
        { role: 'user', content: prompt }
      ]
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    model: 'gpt-4o-mini',
    tokens: data.usage?.total_tokens ?? 0
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  // Auth
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ success: false, message: 'Unauthorized' }, 401);

  const supabase = createClient(supabaseUrl, serviceKey);

  // GET /agent-run -> list recent outputs
  if (req.method === 'GET') {
    const { data: outputs, error } = await supabase
      .from('agent_outputs')
      .select('id, agent_type, output_text, output_data, model_used, tokens_used, status, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) return json({ success: false, message: error.message }, 500);
    return json({ success: true, outputs: outputs ?? [] });
  }

  // POST /agent-run -> execute analysis
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const { agent_type = 'analysis', prompt, context_data = {}, content_type } = body;

    if (!prompt) return json({ success: false, message: 'prompt is required' }, 400);

    // Enrich context with REAL user-specific clinic + financial data (consistent with main api + fixed dashboard)
    let context = '';
    const clinicId = await resolveClinicId(supabase, user.id);

    let clinicQuery = supabase.from('clinics').select('name, timezone, plan');
    if (clinicId) clinicQuery = clinicQuery.eq('id', clinicId);
    const { data: clinicData } = await clinicQuery.limit(1).single();

    let settlementsQuery = supabase.from('financial_settlements')
      .select('amount_net, template_name, settled_at, patient_name')
      .order('settled_at', { ascending: false })
      .limit(6);
    if (clinicId) {
      settlementsQuery = settlementsQuery.eq('clinic_id', clinicId);
    } else {
      settlementsQuery = settlementsQuery.eq('user_id', user.id);
    }
    const { data: settlements } = await settlementsQuery;

    if (clinicData) {
      const totalNet = settlements?.reduce((s, r) => s + parseFloat(r.amount_net), 0) ?? 0;
      context = `You are an AI assistant for ${clinicData.name}, an aesthetic medicine clinic.\n`;
      context += `Real financial data: ${settlements?.length ?? 0} Doctoralia settlements totaling €${totalNet.toFixed(2)}.\n`;
      if (settlements && settlements.length > 0) {
        context += `Recent settlements:\n${settlements.map(s =>
          `- ${s.patient_name}: €${s.amount_net} via ${s.template_name} (${s.settled_at?.split('T')[0] ?? ''})`
        ).join('\n')}\n`;
      }
      if (Object.keys(context_data).length > 0) {
        context += `\nAdditional context: ${JSON.stringify(context_data)}`;
      }
    }

    // Determine which AI to use
    let result: { text: string; model: string; tokens: number };
    const availableKey = ANTHROPIC_KEY ? 'anthropic' : OPENAI_KEY ? 'openai' : null;

    if (!availableKey) {
      // No API keys in secrets - persist a blocked record
      const { data: output } = await supabase.from('agent_outputs').insert({
        user_id:    user.id,
        agent_type,
        input_context: { prompt: prompt.slice(0, 500), agent_type, content_type },
        output_text: '',
        status: 'failed',
        error_message: 'No AI API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in Supabase Edge Function Secrets.',
        model_used: null,
        tokens_used: 0
      }).select().single();
      return json({
        success: false,
        message: 'AI API key not configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in Supabase Dashboard → Edge Functions → Secrets.',
        output_id: output?.id
      }, 503);
    }

    try {
      result = availableKey === 'anthropic'
        ? await callAnthropicAPI(prompt, context)
        : await callOpenAIAPI(prompt, context);
    } catch (err: any) {
      const { data: failOutput } = await supabase.from('agent_outputs').insert({
        user_id: user.id,
        agent_type,
        input_context: { prompt: prompt.slice(0, 500) },
        output_text: '',
        status: 'failed',
        error_message: err.message,
        model_used: availableKey,
        tokens_used: 0
      }).select().single();
      return json({ success: false, message: err.message, output_id: failOutput?.id }, 500);
    }

    // Persist successful output
    const { data: saved, error: saveError } = await supabase
      .from('agent_outputs')
      .insert({
        user_id:       user.id,
        agent_type,
        input_context: { prompt: prompt.slice(0, 500), agent_type, content_type },
        output_text:   result.text,
        output_data:   {},
        model_used:    result.model,
        tokens_used:   result.tokens,
        status:        'completed'
      })
      .select()
      .single();

    if (saveError) return json({ success: false, message: saveError.message }, 500);

    return json({
      success: true,
      output: {
        id:          saved.id,
        agent_type:  saved.agent_type,
        output_text: saved.output_text,
        model_used:  saved.model_used,
        tokens_used: saved.tokens_used,
        created_at:  saved.created_at
      }
    });
  }

  return json({ success: false, message: 'Method not allowed' }, 405);
});
