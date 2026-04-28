import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { describe, it, expect } from "vitest";
import * as VFModule from "../dist/assets/VerifiedFinancials-CFEmsBhN.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("VerifiedFinancials dist asset", () => {
  const assetPath = path.resolve(__dirname, "../dist/assets/VerifiedFinancials-CFEmsBhN.js");

  it("exists in the dist build output", () => {
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  it("exports only the default React component from the generated dist bundle", () => {
    expect(Object.keys(VFModule).sort()).toEqual(["default"]);
    expect(typeof VFModule.default).toBe("function");
  });

  it("renders a React element and contains the real placeholder source text", () => {
    const element = React.createElement(VFModule.default);
    expect(element).toEqual(
      expect.objectContaining({
        type: VFModule.default,
        props: expect.any(Object),
      })
    );

    const source = fs.readFileSync(assetPath, "utf8");
    expect(source).toContain("Verified Financials placeholder");
    expect(source).toContain("export{n as default}");
  });
});
