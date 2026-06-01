const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') return json({ success: false, message: 'POST required' }, 405);

  const body = await req.json().catch(() => ({}));
  const { to, message } = body;

  if (!to || !message) return json({ success: false, message: 'to and message are required' }, 400);
  if (!/^\+?[1-9]\d{7,14}$/.test(to.replace(/\s/g, ''))) {
    return json({ success: false, message: 'to must be a valid phone number in E.164 format (+34XXXXXXXXX)' }, 400);
  }

  const accessToken   = Deno.env.get('WHATSAPP_ACCESS_TOKEN') ?? '';
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';

  if (!accessToken || !phoneNumberId) {
    return json({
      success: false,
      message: 'WhatsApp not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Supabase Edge Function secrets.'
    }, 503);
  }

  const waRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/\s/g, ''),
      type: 'text',
      text: { preview_url: false, body: message }
    })
  });

  const waData = await waRes.json();

  if (!waRes.ok) {
    const errMsg = waData?.error?.message ?? 'WhatsApp API error';
    return json({ success: false, message: errMsg, details: waData }, waRes.status);
  }

  return json({
    success: true,
    messageId: waData.messages?.[0]?.id ?? null,
    to
  });
});
