const fs = require('fs');
let code = fs.readFileSync('supabase/functions/whatsapp-send/index.ts', 'utf8');

const oldCheck = `  const { data: idempotencyRows, error: idempotencyError } = await auth.admin.rpc("nvx_prepare_whatsapp_send", {
    p_user_id: auth.userId,
    p_lead_id: leadId,
    p_normalized_phone: normalizedTo,
    p_idempotency_key: idempotencyKey,
    p_message_sha256: messageSha256,
  });

  if (!idempotencyError && Array.isArray(idempotencyRows) && idempotencyRows.length > 0) {
    const row = idempotencyRows[0];
    const decision = String(row.decision || "");
    const requestStatus = String(row.request_status || "");
    const requestId = String(row.request_id || "");
    const priorMessageId = String(row.provider_message_id || "") || null;`;

const newCheck = `  const { data: idempotencyRows, error: idempotencyError } = await auth.admin
    .from("whatsapp_send_requests")
    .select("id, status, provider_message_id")
    .eq("idempotency_key", idempotencyKey)
    .eq("lead_id", leadId)
    .limit(1);

  if (!idempotencyError && Array.isArray(idempotencyRows) && idempotencyRows.length > 0) {
    const row = idempotencyRows[0];
    const decision = "duplicate";
    const requestStatus = String(row.status || "");
    const requestId = String(row.id || "");
    const priorMessageId = String(row.provider_message_id || "") || null;`;

code = code.replace(oldCheck, newCheck);
fs.writeFileSync('supabase/functions/whatsapp-send/index.ts', code);
