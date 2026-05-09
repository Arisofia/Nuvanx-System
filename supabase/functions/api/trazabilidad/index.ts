import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { leadFrom, leadTo, valoracionFrom, valoracionTo, posteriorFrom, posteriorTo } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Build dynamic query
    let query = supabase
      .from('leads')
      .select(`
        id,
        created_at as "Fecha del Lead",
        source as "Fuente",
        stage as "Estado",
        converted_patient_id,
        financial_settlements!inner(
          settled_at as "Fecha Conversión",
          amount_net as "Revenue"
        )
      `)
      .or('source.is.null,source.neq.doctoralia')
      .order('created_at', { ascending: false });

    // Apply filters
    if (leadFrom) query = query.gte('created_at', leadFrom);
    if (leadTo) query = query.lte('created_at', leadTo);

    const { data: leads, error } = await query;

    if (error) throw error;

    // Enrich with doctoralia appointments for funnel dates
    const phoneList = leads.map(l => l.phone_normalized).filter(Boolean);

    const { data: appointments } = await supabase
      .from('doctoralia_appointments')
      .select('phone_normalized, fecha')
      .in('phone_normalized', phoneList)
      .order('fecha');

    // Group appointments
    const appMap = new Map();
    appointments?.forEach(app => {
      if (!appMap.has(app.phone_normalized)) appMap.set(app.phone_normalized, []);
      appMap.get(app.phone_normalized).push(app.fecha);
    });

    const result = leads.map(lead => {
      const dates = appMap.get(lead.phone_normalized) || [];
      return {
        ...lead,
        "Cita Valoración": dates[0] || null,
        "Cita Posterior": dates[1] || null,
      };
    });

    return new Response(JSON.stringify({ data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});