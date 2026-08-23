import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const EXPECTED_HUB_ID = "147416356";
const TOKEN_INFO_URL = "https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info";
const REQUIRED_SCOPES = new Set([
  "crm.objects.contacts.read",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
]);

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function bearer(req: Request): string {
  const auth = String(req.headers.get("Authorization") || "").trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = String(match?.[1] || "").trim();
  return token.length >= 20 && token.length <= 4096 ? token : "";
}

function safeErrorMessage(error: unknown): string {
  try {
    return error instanceof Error ? String(error.message) : String(error);
  } catch {
    return "error";
  }
}

async function inspectPrivateAppToken(token: string) {
  const response = await fetch(TOKEN_INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokenKey: token }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HubSpot token verification failed ${response.status}`);
  const hubId = String(payload?.hubId || "");
  const scopes = Array.isArray(payload?.scopes) ? payload.scopes.map((value: unknown) => String(value)) : [];
  return { hubId, scopes };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return reply(500, { success: false, message: "Server configuration error" });

  const length = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > 8192) return reply(413, { success: false, message: "Payload too large" });

  const token = bearer(req);
  if (!token) return reply(401, { success: false, message: "Unauthorized" });

  try {
    const verified = await inspectPrivateAppToken(token);
    if (verified.hubId !== EXPECTED_HUB_ID) return reply(403, { success: false, message: "Wrong HubSpot account" });

    const missingScopes = Array.from(REQUIRED_SCOPES).filter((scope) => !verified.scopes.includes(scope));
    if (missingScopes.length) {
      return reply(422, {
        success: false,
        message: "HubSpot token lacks required RevOps scopes",
        missing_scopes: missingScopes,
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const secretWrite = await admin.rpc("nvx_set_runtime_secret", {
      p_name: "HUBSPOT_ACCESS_TOKEN",
      p_value: token,
    });
    if (secretWrite.error || secretWrite.data !== true) throw new Error("Runtime secret persistence failed");

    // Persist only this Edge runtime's own project URL. Preview branches therefore
    // route to themselves if explicitly bootstrapped and never inherit production.
    const urlWrite = await admin.rpc("nvx_set_revops_project_url", {
      p_value: SUPABASE_URL,
    });
    if (urlWrite.error || urlWrite.data !== true) throw new Error("Runtime project URL persistence failed");

    return reply(200, {
      success: true,
      hub_id: EXPECTED_HUB_ID,
      scope_check: "pass",
      project_route: "environment_local",
    });
  } catch (error: unknown) {
    const message = safeErrorMessage(error);
    console.error("[runtime-bootstrap] verification/persistence failed", message.slice(0, 200));
    return reply(502, { success: false, message: "Runtime bootstrap failed" });
  }
});
