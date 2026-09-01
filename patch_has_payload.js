const fs = require('fs');
let code = fs.readFileSync('supabase/functions/whatsapp-send/index.ts', 'utf8');

const oldCheck = `      let hasPayload = false;
      try {
        const { data: payloadRows, error: payloadError } = await auth.admin
          .from("whatsapp_outbound_payloads")
          .select("state")
          .eq("request_id", requestId)
          .limit(1);

        if (!payloadError) {
          hasPayload = Array.isArray(payloadRows) && payloadRows.length > 0;
        } else if (payloadError.code === "42P01" || payloadError.message?.includes("does not exist")) {
          // Table doesn't exist yet (fresh or pre-migration deployment)
          hasPayload = false;
        } else {
          return json({ success: false, message: \`Database error checking outbound payload: \${payloadError.message}\` }, 500);
        }
      } catch {
        hasPayload = false;
      }`;

const newCheck = `      let hasPayload = false;
      try {
        const { data: payloadRows, error: payloadError } = await auth.admin
          .from("whatsapp_outbound_payloads")
          .select("state")
          .eq("request_id", requestId)
          .limit(1);

        if (!payloadError) {
          hasPayload = Array.isArray(payloadRows) && payloadRows.length > 0;
        } else if (payloadError.code === "42P01" || payloadError.message?.includes("does not exist")) {
          // Table doesn't exist yet (fresh or pre-migration deployment)
          hasPayload = false;
        } else {
          return json({ success: false, message: \`Database error checking outbound payload: \${payloadError.message}\` }, 500);
        }
      } catch (error: any) {
        if (error?.code === "42P01" || error?.message?.includes("does not exist")) {
          hasPayload = false;
        } else {
          return json({ success: false, message: \`Unexpected error checking outbound payload\` }, 500);
        }
      }`;

code = code.replace(oldCheck, newCheck);
fs.writeFileSync('supabase/functions/whatsapp-send/index.ts', code);
