import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import MetaIntelligence from "../../.vercel/output/static/assets/MetaIntelligence-CKK5dMtQ.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("MetaIntelligence built asset", () => {
  const assetPath = path.resolve(__dirname, "../../.vercel/output/static/assets/MetaIntelligence-CKK5dMtQ.js");

  it("is present in the frontend build output", () => {
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  it("exports a default React component function", () => {
    expect(typeof MetaIntelligence).toBe("function");
  });

  it("contains the expected marketing intelligence UI strings in the generated source", () => {
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("Marketing Intelligence");
    expect(source).toContain("KPIs reales · Campañas · Análisis IA");
    expect(source).toContain("/api/meta");
    expect(source).toContain("/api/google-ads");
    expect(source).toContain("/api/ai/analyze");
    expect(source).toContain("Meta Ads");
    expect(source).toContain("Google Ads");
    expect(source).toContain("Haz clic en \"Analizar Ahora\"");
    expect(source).toContain("Gasto Diario (€)");
    expect(source).toContain("Clics e Impresiones Diarias");
  });

  it("uses the actual MetaIntelligence generated asset path", () => {
    expect(assetPath).toContain("MetaIntelligence-CKK5dMtQ.js");
  });
});
