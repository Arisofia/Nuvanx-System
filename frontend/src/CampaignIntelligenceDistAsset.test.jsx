import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { describe, it, expect } from "vitest";
import * as CI from "../dist/assets/CampaignIntelligence-CPHA1FG4.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Campaign Intelligence dist asset", () => {
  it("is present in the dist build output and exports only the default component", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/CampaignIntelligence-CPHA1FG4.js");
    expect(fs.existsSync(assetPath)).toBe(true);

    expect(Object.keys(CI).sort()).toEqual(["default"]);
    expect(typeof CI.default).toBe("function");
  });

  it("creates the built React element signature without invoking the component", () => {
    const element = React.createElement(CI.default);

    expect(element).toEqual(
      expect.objectContaining({
        type: CI.default,
        props: expect.any(Object),
      })
    );
  });

  it("contains the real Campaign Intelligence placeholder in the generated bundle", () => {
    const assetPath = path.resolve(__dirname, "../dist/assets/CampaignIntelligence-CPHA1FG4.js");
    const source = fs.readFileSync(assetPath, "utf8");

    expect(source).toContain("export{n as default}");
    expect(source).toContain("Campaign Intelligence placeholder");
  });
});
