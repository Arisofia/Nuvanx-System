import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { classifyFailureDiagnostic } = require("../../../scripts/preflight-google-ads-runtime.js");
const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const runtimeScript = readFileSync(
  fileURLToPath(new URL("../../../scripts/preflight-google-ads-runtime.js", import.meta.url)),
  "utf8",
);

describe("Google Ads provider stage diagnostics", () => {
  it("tags each bounded provider boundary without exposing provider payloads", () => {
    expect(source).toContain('type FailureStage = "oauth_token" | "list_accessible_customers" | "gaql_908" | "gaql_820"');
    expect(source).toContain('const stage: FailureStage = "list_accessible_customers"');
    expect(source).toContain('if (customerId === "9084540447") return "gaql_908"');
    expect(source).toContain('if (customerId === "8201489748") return "gaql_820"');
    expect(source).toContain('throw normalizeFailure(error, "oauth_token")');
    expect(source).toContain('stage: failure.stage || "unknown"');
    expect(source).not.toContain("JSON.stringify(payload)");
  });

  it("preserves the provider diagnostic while surfacing only an allowlisted stage", () => {
    expect(classifyFailureDiagnostic({
      kind: "provider",
      stage: "list_accessible_customers",
      message: "Google Ads API 401 UNAUTHENTICATED",
    })).toEqual({
      kind: "provider",
      stage: "list_accessible_customers",
      diagnostic: "provider_unauthenticated",
    });

    expect(classifyFailureDiagnostic({
      kind: "provider",
      stage: "gaql_908",
      message: "Google Ads API 403 PERMISSION_DENIED",
    })).toEqual({
      kind: "provider",
      stage: "gaql_908",
      diagnostic: "provider_permission_denied",
    });
  });

  it("preserves stage across transport failures without exposing transport errors", () => {
    expect(source).toContain("async function fetchProvider(url: string, init: RequestInit, stage: FailureStage)");
    expect(source).toContain('"Google Ads API request failed before response"');
    expect(source).toContain("const response = await fetchProvider(");
    expect(classifyFailureDiagnostic({
      kind: "provider",
      stage: "gaql_820",
      message: "Google Ads API request failed before response",
    })).toEqual({
      kind: "provider",
      stage: "gaql_820",
      diagnostic: "provider_transport_failure",
    });
  });

  it("cannot echo an untrusted stage into runtime acceptance", () => {
    const secret = "sensitive-stage-value";
    const classified = classifyFailureDiagnostic({
      kind: "provider",
      stage: `gaql_${secret}`,
      message: "Google Ads API 401 UNAUTHENTICATED",
    });
    expect(classified).toEqual({
      kind: "provider",
      diagnostic: "provider_unauthenticated",
    });
    expect(JSON.stringify(classified)).not.toContain(secret);
    expect(runtimeScript).toContain("const SAFE_FAILURE_STAGES = new Set(['oauth_token', 'list_accessible_customers', 'gaql_908', 'gaql_820'])");
  });
});
