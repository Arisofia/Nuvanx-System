import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import Dashboard from "../.vercel/output/static/assets/Dashboard-DsPwh6hD.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Dashboard built asset", () => {
  it("is available in the frontend build output and exports a component", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/Dashboard-DsPwh6hD.js");
    expect(fs.existsSync(assetPath)).toBe(true);
    expect(typeof Dashboard).toBe("function");
  });

  it("renders the Dashboard page shell with the expected UI labels", () => {
    const html = renderToStaticMarkup(React.createElement(Dashboard));

    expect(html).toContain("Live Control");
    expect(html).toContain("Frontend governed by GitHub + Supabase with daily auto-refresh and live Meta view.");
    expect(html).toContain("Adaptive Action Plan");
    expect(html).toContain("Active Agents");
    expect(html).toContain("Live Meta");
    expect(html).toContain("GitHub + Supabase Activity");
    expect(html).toContain("No recent events. Run a sync to populate the feed.");
  });
});
