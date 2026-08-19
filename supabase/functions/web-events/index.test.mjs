import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("web-events P0 contract", () => {
  it("requires the shared secret exclusively from runtime configuration", () => {
    expect(source).toContain('Deno.env.get("NUVANX_WEB_EVENT_SECRET") || ""');
    expect(source).not.toMatch(/NUVANX_WEB_EVENT_SECRET[^\n]+\|\|\s*["'][^"']{16,}["']/);
    expect(source).toContain("if (!SHARED_SECRET)");
  });

  it("suppresses QA before Meta delivery", () => {
    expect(source).toContain("function isTestLead");
    expect(source).toContain('reason: "qa_lead"');
    const qaGuard = source.indexOf("if (isTestLead(body))");
    const metaResolution = source.indexOf("resolveOwnerAndMeta(admin)");
    expect(qaGuard).toBeGreaterThan(-1);
    expect(metaResolution).toBeGreaterThan(qaGuard);
  });

  it("does not propagate treatment or page-level clinical semantics", () => {
    const customDataStart = source.indexOf("function safeCustomData()");
    const sendStart = source.indexOf("async function sendMetaCapi");
    const customData = source.slice(customDataStart, sendStart);
    expect(customData).not.toMatch(/treatment|condition|procedure|diagnosis|body_area/i);
    expect(customData).not.toMatch(/page_url|page_title|click_target|event_type/i);
    expect(source).toContain('const CANONICAL_EVENT_SOURCE_URL = "https://nuvanx.com/"');
    expect(source).not.toContain("body.event_source_url");
    expect(source).not.toContain("body.page_url");
  });

  it("requires a caller-owned event_id and never creates a random fallback", () => {
    expect(source).toContain("function sanitizeEventId");
    expect(source).toContain('throw new Error("Valid event_id is required")');
    expect(source).not.toMatch(/eventId\s*=.*crypto\.randomUUID/);
  });

  it("does not allow the request body to select Meta test mode", () => {
    expect(source).toContain('Deno.env.get("META_TEST_EVENT_CODE")');
    expect(source).not.toContain("body.test_event_code");
    expect(source).not.toContain("body._meta?.test_event_code");
  });
});
