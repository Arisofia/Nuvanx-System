import fs from "fs";
import path from "path";
import CampaignIntelligence from "../../.vercel/output/static/assets/CampaignIntelligence-DO-O-lDi.js";

describe("Campaign Intelligence built asset", () => {
  const assetPath = path.resolve(process.cwd(), ".vercel/output/static/assets/CampaignIntelligence-DO-O-lDi.js");

  it("is present in frontend build output", () => {
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  it("exports a default React component function", () => {
    expect(typeof CampaignIntelligence).toBe("function");
  });

  it("contains the expected Revenue Intelligence UI labels in the built source", () => {
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("Revenue Intelligence");
    expect(source).toContain("Doctoralia Financials");
    expect(source).toContain("Campaign Performance");
    expect(source).toContain("WhatsApp Funnel");
    expect(source).toContain("Lead Traceability");
  });

  it("uses the actual Campaign Intelligence generated asset path", () => {
    expect(assetPath).toContain("CampaignIntelligence-DO-O-lDi.js");
  });
});
