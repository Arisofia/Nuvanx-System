import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as NormalizeModule from "../.vercel/output/static/assets/normalizeDashboardMetrics-DNJpX4vg.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("normalizeDashboardMetrics built asset", () => {
  const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/normalizeDashboardMetrics-DNJpX4vg.js");

  it("is available in the frontend build output", () => {
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  it("exports the normalize function as the mangled bundle export", () => {
    expect(typeof NormalizeModule.t).toBe("function");
  });

  it("normalizes nested metric payloads and fallback field names", () => {
    const raw = {
      metrics: {
        total_leads: "42",
        total_revenue: "1234.5",
        conversions: "7",
        conversion_rate: "0.12",
        connected_integrations: "3",
        total_integrations: "5",
        by_stage: { appointment: 2 },
        by_source: { organic: 10 },
      },
    };

    const metrics = NormalizeModule.t(raw);

    expect(metrics.totalLeads).toBe(42);
    expect(metrics.totalRevenue).toBe(1234.5);
    expect(metrics.conversions).toBe(7);
    expect(metrics.conversionRate).toBe(0.12);
    expect(metrics.connectedIntegrations).toBe(3);
    expect(metrics.totalIntegrations).toBe(5);
    expect(metrics.byStage).toEqual({ appointment: 2 });
    expect(metrics.bySource).toEqual({ organic: 10 });
  });

  it("returns defaults for missing values and preserves object shape", () => {
    const raw = {
      conversions: 10,
    };

    const metrics = NormalizeModule.t(raw);

    expect(metrics.totalLeads).toBe(0);
    expect(metrics.totalRevenue).toBe(0);
    expect(metrics.conversions).toBe(10);
    expect(metrics.conversionRate).toBe(0);
    expect(metrics.connectedIntegrations).toBe(0);
    expect(metrics.totalIntegrations).toBe(0);
    expect(metrics.byStage).toEqual({});
    expect(metrics.bySource).toEqual({});
  });

  it("handles a raw object that is not a nested metrics container", () => {
    const raw = {
      totalLeads: 8,
      totalRevenue: 500,
      conversions: 2,
      conversionRate: 0.25,
      connectedIntegrations: 1,
      totalIntegrations: 2,
      byStage: { lead: 1 },
      bySource: { paid: 1 },
    };

    const metrics = NormalizeModule.t(raw);

    expect(metrics.totalLeads).toBe(8);
    expect(metrics.totalRevenue).toBe(500);
    expect(metrics.byStage).toEqual({ lead: 1 });
    expect(metrics.bySource).toEqual({ paid: 1 });
  });

  it("exposes the bundle source markers for the normalize implementation", () => {
    const source = fs.readFileSync(assetPath, "utf8");
    expect(source).toContain("totalLeads");
    expect(source).toContain("total_revenue");
    expect(source).toContain("conversion_rate");
    expect(source).toContain("connectedIntegrations");
    expect(source).toContain("by_stage");
    expect(source).toContain("by_source");
  });
});
