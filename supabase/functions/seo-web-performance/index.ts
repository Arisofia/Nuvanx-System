import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const PAGESPEED_API_KEY = (Deno.env.get("PAGESPEED_API_KEY") || "").trim();
const PAGESPEED_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const SOURCE = "pagespeed_insights_v5";
const BASE_URL = "https://nuvanx.com";
const REQUEST_TIMEOUT_MS = 45_000;
const CONCURRENCY = 6;

const TARGET_PATHS = [
  "/",
  "/endolift-facial-papada-mandibula/",
  "/endolaser-corporal-grasa-localizada/",
  "/medicina-estetica/",
  "/madrid/valoracion/",
  "/blog/",
] as const;
const DEVICES = ["mobile", "desktop"] as const;

type Device = (typeof DEVICES)[number];
type JsonRecord = Record<string, any>;

type TelemetryRow = {
  run_id: string;
  url: string;
  device: Device;
  source: string;
  performance_score: number | null;
  lcp_ms: number | null;
  cls: number | null;
  inp_ms: number | null;
  fcp_ms: number | null;
  tbt_ms: number | null;
  speed_index_ms: number | null;
  ttfb_ms: number | null;
  field_scope: "url" | "origin" | null;
  quality_status: "ok" | "partial" | "unavailable";
  error_code: string | null;
  error_message: string | null;
  provider_metadata: Record<string, unknown>;
  captured_at: string;
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function timingSafeTextMatch(received: string, expected: string): boolean {
  const a = String(received || "");
  const b = String(expected || "");
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundedAudit(payload: JsonRecord, auditId: string): number | null {
  const value = finiteNumber(payload?.lighthouseResult?.audits?.[auditId]?.numericValue);
  return value === null ? null : Math.max(0, Math.round(value));
}

function roundedCls(payload: JsonRecord): number | null {
  const value = finiteNumber(payload?.lighthouseResult?.audits?.["cumulative-layout-shift"]?.numericValue);
  return value === null ? null : Math.max(0, Math.round(value * 10_000) / 10_000);
}

function performanceScore(payload: JsonRecord): number | null {
  const value = finiteNumber(payload?.lighthouseResult?.categories?.performance?.score);
  if (value === null) return null;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function inpFieldData(payload: JsonRecord): { value: number | null; scope: "url" | "origin" | null } {
  const pageValue = finiteNumber(payload?.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT_MS?.percentile);
  if (pageValue !== null) return { value: Math.max(0, Math.round(pageValue)), scope: "url" };

  const originValue = finiteNumber(payload?.originLoadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT_MS?.percentile);
  if (originValue !== null) return { value: Math.max(0, Math.round(originValue)), scope: "origin" };

  return { value: null, scope: null };
}

function providerCapturedAt(payload: JsonRecord): string {
  const raw = String(payload?.lighthouseResult?.fetchTime || "").trim();
  if (raw) {
    const parsed = new Date(raw);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function errorRow(runId: string, url: string, device: Device, code: string, message: string): TelemetryRow {
  return {
    run_id: runId,
    url,
    device,
    source: SOURCE,
    performance_score: null,
    lcp_ms: null,
    cls: null,
    inp_ms: null,
    fcp_ms: null,
    tbt_ms: null,
    speed_index_ms: null,
    ttfb_ms: null,
    field_scope: null,
    quality_status: "unavailable",
    error_code: code,
    error_message: message.slice(0, 500),
    provider_metadata: {},
    captured_at: new Date().toISOString(),
  };
}

async function fetchPageSpeed(url: string, device: Device): Promise<JsonRecord> {
  const requestUrl = new URL(PAGESPEED_ENDPOINT);
  requestUrl.searchParams.set("url", url);
  requestUrl.searchParams.set("strategy", device);
  requestUrl.searchParams.set("category", "performance");
  if (PAGESPEED_API_KEY) requestUrl.searchParams.set("key", PAGESPEED_API_KEY);

  const response = await fetch(requestUrl.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body: JsonRecord = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: { message: text.slice(0, 500) } };
  }
  if (!response.ok) {
    const error = new Error(String(body?.error?.message || `PageSpeed HTTP ${response.status}`));
    Object.assign(error, { code: `pagespeed_http_${response.status}` });
    throw error;
  }
  return body;
}

async function runCell(runId: string, path: string, device: Device): Promise<TelemetryRow> {
  const url = new URL(path, BASE_URL).href;
  try {
    const payload = await fetchPageSpeed(url, device);
    const score = performanceScore(payload);
    const lcp = roundedAudit(payload, "largest-contentful-paint");
    const cls = roundedCls(payload);
    const inp = inpFieldData(payload);

    if (score === null || lcp === null || cls === null) {
      return errorRow(runId, url, device, "provider_contract_incomplete", "PageSpeed response omitted required Lighthouse performance fields");
    }

    return {
      run_id: runId,
      url,
      device,
      source: SOURCE,
      performance_score: score,
      lcp_ms: lcp,
      cls,
      inp_ms: inp.value,
      fcp_ms: roundedAudit(payload, "first-contentful-paint"),
      tbt_ms: roundedAudit(payload, "total-blocking-time"),
      speed_index_ms: roundedAudit(payload, "speed-index"),
      ttfb_ms: roundedAudit(payload, "server-response-time"),
      field_scope: inp.scope,
      quality_status: inp.value === null ? "partial" : "ok",
      error_code: null,
      error_message: null,
      provider_metadata: {
        lighthouse_version: String(payload?.lighthouseResult?.lighthouseVersion || "") || null,
        fetch_time: String(payload?.lighthouseResult?.fetchTime || "") || null,
        captcha_result: String(payload?.captchaResult || "") || null,
        field_data_available: inp.value !== null,
      },
      captured_at: providerCapturedAt(payload),
    };
  } catch (error: any) {
    const code = String(error?.code || (error?.name === "TimeoutError" ? "pagespeed_timeout" : "pagespeed_request_failed"));
    const message = String(error?.message || "PageSpeed request failed");
    return errorRow(runId, url, device, code, message);
  }
}

async function collectRun(runId: string): Promise<TelemetryRow[]> {
  const cells = TARGET_PATHS.flatMap((path) => DEVICES.map((device) => ({ path, device })));
  const rows: TelemetryRow[] = [];
  for (let offset = 0; offset < cells.length; offset += CONCURRENCY) {
    const batch = cells.slice(offset, offset + CONCURRENCY);
    rows.push(...await Promise.all(batch.map((cell) => runCell(runId, cell.path, cell.device))));
  }
  return rows;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return reply(500, { success: false, message: "Server configuration error" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const received = String(req.headers.get("x-nvx-internal-secret") || "");
    const { data: expected, error: secretError } = await admin.rpc("nvx_get_runtime_secret", { p_name: "REVOPS_INTERNAL_SECRET" });
    if (secretError) throw secretError;
    if (!timingSafeTextMatch(received, String(expected || ""))) return reply(401, { success: false, message: "Unauthorized" });

    const runId = crypto.randomUUID();
    const rows = await collectRun(runId);
    const { error: insertError } = await admin.from("seo_web_performance").insert(rows);
    if (insertError) throw insertError;

    const counts = rows.reduce((acc, row) => {
      acc[row.quality_status] += 1;
      return acc;
    }, { ok: 0, partial: 0, unavailable: 0 });
    const fullyAvailable = counts.unavailable === 0;

    console.log(`[seo-web-performance] run=${runId} ok=${counts.ok} partial=${counts.partial} unavailable=${counts.unavailable}`);
    return reply(fullyAvailable ? 200 : 502, {
      success: fullyAvailable,
      runId,
      source: SOURCE,
      cells: rows.length,
      ...counts,
    });
  } catch (error: any) {
    console.error("[seo-web-performance]", String(error?.message || error).slice(0, 500));
    return reply(502, { success: false, message: String(error?.message || "SEO web performance sync failed").slice(0, 300) });
  }
});
