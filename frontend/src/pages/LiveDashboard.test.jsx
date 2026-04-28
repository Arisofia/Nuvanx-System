import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import LiveDashboard from "../../.vercel/output/static/assets/LiveDashboard-Dvfsb-aw.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("LiveDashboard built asset", () => {
  const assetPath = path.resolve(__dirname, "../../.vercel/output/static/assets/LiveDashboard-Dvfsb-aw.js");

  it("is present in the frontend build output", () => {
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  it("exports a default React component function", () => {
    expect(typeof LiveDashboard).toBe("function");
  });

  it("contains the expected Live Dashboard page UI strings in the generated source", () => {
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("Live");
    expect(source).toContain("Metrics and activity feed refresh every 30s from backend APIs.");
    expect(source).toContain("Lead Flow — Last 24 Hours");
    expect(source).toContain("Activity Feed");
    expect(source).toContain("/api/dashboard/metrics");
    expect(source).toContain("/api/dashboard/lead-flow");
    expect(source).toContain("live-dashboard-leads");
    expect(source).toContain("postgres_changes");
    expect(source).toContain("setInterval");
    expect(source).toContain("Refresh");
  });

  it("uses the actual LiveDashboard generated asset path", () => {
    expect(assetPath).toContain("LiveDashboard-Dvfsb-aw.js");
  });
});
