import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import CRM from "../.vercel/output/static/assets/CRM-D4KmuuO_.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("CRM built asset", () => {
  it("is available in the frontend build output and exports a component", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/CRM-D4KmuuO_.js");
    expect(fs.existsSync(assetPath)).toBe(true);
    expect(typeof CRM).toBe("function");
  });

  it("contains the expected CRM UI strings in the generated bundle", () => {
    const assetPath = path.resolve(__dirname, "../.vercel/output/static/assets/CRM-D4KmuuO_.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("CRM & Lead Pipeline");
    expect(source).toContain("Add Lead");
    expect(source).toContain("Search leads");
    expect(source).toContain("Name");
    expect(source).toContain("DNI");
    expect(source).toContain("Source");
    expect(source).toContain("Status");
    expect(source).toContain("Last Contact");
    expect(source).toContain("Value");
    expect(source).toContain("Actions");
    expect(source).toContain("Lead list is sourced from backend endpoint /api/leads.");
    expect(source).toContain("Contacted");
    expect(source).toContain("Appointment");
    expect(source).toContain("Converted");
  });
});
