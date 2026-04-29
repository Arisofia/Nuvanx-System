import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import Dashboard from "../.vercel/output/static/assets/Dashboard-DsPwh6hD.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Dashboard built asset", () => {
  it("is available in the frontend build output and exports a component", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/Dashboard-DsPwh6hD.js");
    expect(fs.existsSync(assetPath)).toBe(true);
    expect(typeof Dashboard).toBe("function");
  });

  it("contains the expected Dashboard UI labels in the generated bundle", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/Dashboard-DsPwh6hD.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("Live Control");
    expect(source).toContain("Frontend governed by GitHub + Supabase with daily auto-refresh and live Meta view.");
    expect(source).toContain("Adaptive Action Plan");
    expect(source).toContain("Active Agents");
    expect(source).toContain("Live Meta");
    expect(source).toContain("GitHub + Supabase Activity");
    expect(source).toContain("No recent events. Run a sync to populate the feed.");
    expect(source).toContain("api/dashboard/metrics");
    expect(source).toContain("api/integrations");
    expect(source).toContain("api/ai/status");
    expect(source).toContain("api/figma/events");
  });
});
