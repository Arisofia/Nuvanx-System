import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("dist index bundle asset", () => {
  it("exists in the dist build output", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/index-CY7xEKw-.js");
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  it("contains the real app entrypoint markers from the generated dist bundle", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/index-CY7xEKw-.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("document.getElementById(`root`)");
    expect(source).toContain("createRoot");
    expect(source).toContain("import{n as e}from\"./rolldown-runtime");
    expect(source).toContain("assets/Dashboard-Tlvp89XP.js");
    expect(source).toContain("assets/CRM-B4xUeavH.js");
    expect(source).toContain("assets/HealthCheck-C2YNqXdK.js");
    expect(source).toContain("assets/AILayer-7SRzzO3V.js");
    expect(source).toContain("assets/CampaignIntelligence-CPHA1FG4.js");
    expect(source).toContain("assets/VerifiedFinancials-CFEmsBhN.js");
    expect(source).toContain("assets/MetaIntelligence-BELchOVg.js");
  });
});
