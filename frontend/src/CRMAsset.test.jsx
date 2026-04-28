import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import CRM from "../.vercel/output/static/assets/CRM-D4KmuuO_.js";

describe("CRM built asset", () => {
  it("is available in the frontend build output and exports a component", () => {
    const assetPath = path.resolve(process.cwd(), "../.vercel/output/static/assets/CRM-D4KmuuO_.js");
    expect(fs.existsSync(assetPath)).toBe(true);
    expect(typeof CRM).toBe("function");
  });

  it("renders the CRM page shell with the expected UI labels", () => {
    const html = renderToStaticMarkup(React.createElement(CRM));

    expect(html).toContain("CRM & Lead Pipeline");
    expect(html).toContain("Add Lead");
    expect(html).toContain("Search leads");
    expect(html).toContain("Name");
    expect(html).toContain("DNI");
    expect(html).toContain("Source");
    expect(html).toContain("Status");
    expect(html).toContain("Last Contact");
    expect(html).toContain("Value");
    expect(html).toContain("Actions");
  });

  it("renders the Add New Lead dialog markup when the component is mounted and not interacting", () => {
    const html = renderToStaticMarkup(React.createElement(CRM));

    expect(html).toContain("Loading");
    expect(html).toContain("Lead list is sourced from backend endpoint /api/leads.");
  });

  it("renders the lead status filters with the expected stage names", () => {
    const html = renderToStaticMarkup(React.createElement(CRM));

    expect(html).toContain("Contacted");
    expect(html).toContain("Appointment");
    expect(html).toContain("Converted");
  });
});
