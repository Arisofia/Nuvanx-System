import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import Integrations from "../../.vercel/output/static/assets/Integrations-DT36n1GU.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Integrations built asset", () => {
  const assetPath = path.resolve(__dirname, "../../.vercel/output/static/assets/Integrations-DT36n1GU.js");

  it("is present in the frontend build output", () => {
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  it("exports a default React component function", () => {
    expect(typeof Integrations).toBe("function");
  });

  it("contains the expected Integrations page UI strings in the generated source", () => {
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("Integration Center");
    expect(source).toContain("Secure connection to the Nuvanx data ecosystem. Credentials are encrypted and persisted in Supabase Cloud.");
    expect(source).toContain("Sync Vault");
    expect(source).toContain("Total Integrations");
    expect(source).toContain("Connected");
    expect(source).toContain("Errors");
    expect(source).toContain("/api/integrations");
    expect(source).toContain("/api/integrations/validate-all");
    expect(source).toContain("export{x as default}");
  });

  it("uses the actual Integrations generated asset path", () => {
    expect(assetPath).toContain("Integrations-DT36n1GU.js");
  });
});
